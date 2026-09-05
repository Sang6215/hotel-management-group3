import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { createApp } from '../server/app.js';
import { Booking, Customer, Room, RoomType, Service, User } from '../server/models.js';
import { seedDemo } from '../server/seed.js';
import { hotelDay, nightsBetween, validCalendarDate } from '../shared/dates.js';
import { bootstrapProductionAdmin } from '../server/bootstrap.js';
import type { BookingView, CustomerView, RoomTypeView, RoomView, ServiceView } from '../shared/types.js';

let mongo: MongoMemoryReplSet;
let system: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof login>>, staff: Awaited<ReturnType<typeof login>>;
let type: RoomTypeView, room: RoomView, other: RoomView, customer: CustomerView, service: ServiceView, draft: BookingView;
const origin = 'http://127.0.0.1:5173';
const checkIn = '2090-09-10', checkOut = '2090-09-12';
const typeData = { code: 'FAMILY', name: 'Phòng gia đình', price: 1200000, capacity: 4, amenities: ['Wi-Fi'], description: 'Phòng kiểm thử', status: 'active' };
const customerData = { fullName: 'Khách kiểm thử', phone: '+84 912-345-678', idCard: ' ab-123456 ', email: 'guest@example.test', nationality: 'Việt Nam', status: 'active' };
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.0.15', downloadDir: path.resolve('.local/mongodb-binaries') }, replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  const uri = mongo.getUri('hotel_phase2_tests');
  await mongoose.connect(uri); await seedDemo();
  system = createApp({ mongoUri: uri, secret: 'phase2-test-secret-at-least-32-characters', origin, demo: true });
  admin = await login('admin', 'AdminDemo2026!'); staff = await login('letan', 'LetanDemo2026!');
});
afterAll(async () => { await system?.sessionStore.close(); await mongoose.disconnect(); await mongo?.stop(); });
async function login(username: string, password: string) {
  const agent = request.agent(system.app), pre = await agent.get('/api/v1/auth/csrf');
  const r = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', pre.body.csrfToken).send({ username, password }).expect(200);
  return { agent, csrf: r.body.csrfToken as string };
}
function post(client: typeof admin, url: string, body: object) { return client.agent.post('/api/v1' + url).set('X-CSRF-Token', client.csrf).set('Origin', origin).send(body); }
function patch(client: typeof admin, url: string, body: object) { return client.agent.patch('/api/v1' + url).set('X-CSRF-Token', client.csrf).set('Origin', origin).send(body); }
function inputOf<T extends { id: string }>(item: T) { const { id: _id, ...data } = item; return data; }
const roomInput = (r: RoomView) => ({ number: r.number, floor: r.floor, typeId: r.typeId, active: r.active, status: r.status, version: r.version });
const body = () => ({ customerId: customer.id, checkIn, checkOut, rooms: [{ roomId: room.id, guestCount: 2 }, { roomId: other.id, guestCount: 1 }], note: 'Cần hai phòng gần nhau.' });
async function availability(start = checkIn, end = checkOut) {
  return (await staff.agent.get('/api/v1/rooms/availability').query({ checkIn: start, checkOut: end, limit: 200 }).expect(200)).body;
}

describe('Week 2: catalogs, customer records and booking drafts', () => {
  it('enforces authentication, catalog permissions and CSRF for the new APIs', async () => {
    for (const url of ['/room-types', '/customers', '/services', '/rooms/availability', '/bookings']) await request(system.app).get('/api/v1' + url).expect(401);
    for (const url of ['/room-types', '/services', '/rooms']) { await post(staff, url, {}).expect(403); await patch(staff, url + '/000000000000000000000001', {}).expect(403); }
    await admin.agent.post('/api/v1/customers').send(customerData).expect(403);
  });
  it('creates and reads room types, rejects invalid money/capacity and duplicate codes', async () => {
    type = (await post(admin, '/room-types', typeData).expect(201)).body.item;
    expect(type.version).toBe(0);
    await post(admin, '/room-types', { ...typeData, code: 'family' }).expect(409);
    for (const changes of [{ price: -1 }, { price: 1.5 }, { capacity: 0 }, { capacity: 2.1 }, { unexpected: true }]) await post(admin, '/room-types', { ...typeData, ...changes }).expect(400);
    const r = await staff.agent.get('/api/v1/room-types?q=FAMILY').expect(200);
    expect(r.body.items[0]).toMatchObject({ id: type.id, price: 1200000, capacity: 4 });
  });
  it('creates rooms, rejects missing types, duplicate numbers and fabricated occupied status', async () => {
    const data = { number: 'F401', floor: 4, typeId: type.id, status: 'available', active: true };
    room = (await post(admin, '/rooms', data).expect(201)).body.item;
    other = (await post(admin, '/rooms', { ...data, number: 'F402' }).expect(201)).body.item;
    await post(admin, '/rooms', data).expect(409);
    await post(admin, '/rooms', { ...data, number: 'NO_TYPE', typeId: new mongoose.Types.ObjectId().toString() }).expect(400);
    await post(admin, '/rooms', { ...data, number: 'OCC', status: 'occupied' }).expect(400);
    const r = await staff.agent.get('/api/v1/rooms?floor=4&q=F4&limit=1').expect(200);
    expect(r.body.total).toBe(2); expect(r.body.items).toHaveLength(1);
  });
  it('normalizes customer identity and reports duplicate phone or document clearly', async () => {
    customer = (await post(staff, '/customers', customerData).expect(201)).body.item;
    expect(customer).toMatchObject({ phone: '0912345678', idCard: 'AB123456', version: 0 });
    const phone = await post(staff, '/customers', { ...customerData, idCard: 'OTHER123', phone: '0912.345.678' }).expect(409);
    expect(phone.body.message).toContain('Số điện thoại');
    const card = await post(staff, '/customers', { ...customerData, phone: '0987654321', idCard: 'ab 123456' }).expect(409);
    expect(card.body.message).toContain('Số giấy tờ');
    await post(staff, '/customers', { ...customerData, phone: 'abc' }).expect(400);
    await post(staff, '/customers', { ...customerData, email: 'not-an-email' }).expect(400);
    const found = await staff.agent.get('/api/v1/customers').query({ q: '+84 912345678' }).expect(200);
    expect(found.body.items[0].id).toBe(customer.id);
  });
  it('creates, updates and deactivates services without deleting their identity', async () => {
    const data = { code: 'DINNER', name: 'Bữa tối', category: 'Ăn uống', unit: 'Suất', price: 150000, status: 'active' };
    service = (await post(admin, '/services', data).expect(201)).body.item;
    await post(admin, '/services', data).expect(409);
    await post(admin, '/services', { ...data, code: 'NEGATIVE', price: -1 }).expect(400);
    service = (await patch(admin, `/services/${service.id}`, { ...inputOf(service), price: 160000, status: 'inactive' }).expect(200)).body.item;
    expect(service.version).toBe(1);
    expect(await Service.exists({ _id: service.id })).toBeTruthy();
    const active = await staff.agent.get('/api/v1/services?status=active&q=DINNER').expect(200);
    expect(active.body.total).toBe(0);
  });
  it('rejects impossible dates and computes nights on Vietnam calendar boundaries', async () => {
    expect(validCalendarDate('2090-02-29')).toBe(false); expect(validCalendarDate('2088-02-29')).toBe(true);
    expect(nightsBetween('2088-02-28', '2088-03-01')).toBe(2);
    expect(hotelDay('2090-09-09T18:00:00Z')).toBe('2090-09-10');
    for (const dates of [{ checkIn: '2090-02-30', checkOut }, { checkIn, checkOut: checkIn }, { checkIn, checkOut: '2090-09-09' }, { checkIn: '2090-01-01', checkOut: '2092-01-01' }, { checkIn: '10/09/2090', checkOut }]) await staff.agent.get('/api/v1/rooms/availability').query(dates).expect(400);
    expect((await availability()).nights).toBe(2);
  });
  it('persists multi-room drafts with server-side pricing and no reservation or payment', async () => {
    draft = (await post(staff, '/bookings', body()).expect(201)).body.item;
    expect(draft).toMatchObject({ status: 'pending', deposit: 0, nights: 2, totalGuests: 3, estimatedTotal: 4800000, version: 0, checkIn, checkOut });
    const stored = await Booking.findById(draft.id);
    expect(stored!.check_in_plan.toISOString()).toBe('2090-09-09T17:00:00.000Z');
    expect(stored!.payments).toHaveLength(0);
    expect(stored!.created_by.toString()).toBe((await User.findOne({ username: 'letan' }))!._id.toString());
    expect((await availability()).items.map((r: RoomView) => r.id)).toContain(room.id);
    await post(staff, '/bookings', { ...body(), estimatedTotal: 1 }).expect(400);
    await post(staff, '/bookings', { ...body(), status: 'confirmed' }).expect(400);
  });
  it('rejects missing customers, duplicate rooms, excessive guests and historical drafts', async () => {
    for (const changes of [
      { customerId: new mongoose.Types.ObjectId().toString() }, { rooms: [] },
      { rooms: [{ roomId: room.id, guestCount: 1 }, { roomId: room.id, guestCount: 1 }] },
      { rooms: [{ roomId: room.id, guestCount: 5 }] }, { rooms: [{ roomId: room.id, guestCount: 0 }] },
      { rooms: [{ roomId: room.id, guestCount: 1.5 }] }, { checkIn: '2020-01-01', checkOut: '2020-01-02' },
    ]) await post(staff, '/bookings', { ...body(), ...changes }).expect(400);
    await post(staff, '/bookings', { ...body(), rooms: [{ roomId: new mongoose.Types.ObjectId().toString(), guestCount: 1 }] }).expect(409);
    expect(await Booking.countDocuments()).toBe(1);
  });
  it('reopening a saved draft and customer history return persisted records', async () => {
    const newSession = await login('letan', 'LetanDemo2026!');
    const detail = await newSession.agent.get('/api/v1/bookings/' + draft.id).expect(200);
    expect(detail.body.item).toEqual(draft);
    const history = await staff.agent.get(`/api/v1/customers/${customer.id}/bookings?limit=1`).expect(200);
    expect(history.body.items[0].id).toBe(draft.id); expect(history.body.total).toBe(1);
  });
  it('preserves saved snapshots when catalogs change, then re-quotes edited drafts', async () => {
    type = (await patch(admin, '/room-types/' + type.id, { ...inputOf(type), price: 1500000 }).expect(200)).body.item;
    customer = (await patch(staff, '/customers/' + customer.id, { ...inputOf(customer), fullName: 'Tên khách cập nhật' }).expect(200)).body.item;
    const old = (await staff.agent.get('/api/v1/bookings/' + draft.id)).body.item;
    expect(old.customer.fullName).toBe('Khách kiểm thử'); expect(old.estimatedTotal).toBe(4800000);
    const previousVersion = draft.version;
    draft = (await patch(staff, '/bookings/' + draft.id, { ...body(), version: draft.version }).expect(200)).body.item;
    expect(draft).toMatchObject({ version: 1, estimatedTotal: 6000000, customer: { fullName: 'Tên khách cập nhật' } });
    expect(draft.history).toHaveLength(2);
    await patch(staff, '/bookings/' + draft.id, { ...body(), version: previousVersion }).expect(409);
  });
  it('rejects stale concurrent edits of one customer rather than silently overwriting', async () => {
    const result = await Promise.all(['Tên A', 'Tên B'].map(fullName => patch(staff, '/customers/' + customer.id, { ...inputOf(customer), fullName })));
    expect(result.map(r => r.status).sort()).toEqual([200, 409]);
    customer = result.find(r => r.status === 200)!.body.item;
  });
  it('checks half-open overlap for confirmed/checked-in bookings and permits adjacent dates', async () => {
    const saved = await Booking.findById(draft.id); saved!.status = 'confirmed'; await saved!.save();
    const find = async (a: string, b: string) => (await availability(a, b)).items.map((r: RoomView) => r.id);
    expect(await find('2090-09-09', '2090-09-10')).toContain(room.id);
    expect(await find('2090-09-12', '2090-09-13')).toContain(room.id);
    for (const [a, b] of [['2090-09-09', '2090-09-11'], ['2090-09-10', '2090-09-12'], ['2090-09-11', '2090-09-13'], ['2090-09-09', '2090-09-13']]) expect(await find(a, b)).not.toContain(room.id);
    await post(staff, '/bookings', body()).expect(409);
    await patch(staff, '/bookings/' + draft.id, { ...body(), version: saved!.version }).expect(409);
    saved!.status = 'checked_in'; await saved!.save();
    await Room.updateOne({ _id: room.id }, { $set: { status: 'occupied', current_booking_id: saved!._id } });
    expect(await find(checkIn, checkOut)).not.toContain(room.id);
    expect(await find('2090-09-13', '2090-09-15')).toContain(room.id);
    await patch(admin, '/rooms/' + room.id, roomInput(room)).expect(409);
    await patch(admin, '/room-types/' + type.id, { ...inputOf(type), status: 'inactive' }).expect(409);
    await patch(admin, '/rooms/' + other.id, { ...roomInput(other), active: false }).expect(409);
    saved!.status = 'cancelled'; await saved!.save();
    await Room.updateOne({ _id: room.id }, { $set: { status: 'available' }, $unset: { current_booking_id: 1 } });
    expect(await find(checkIn, checkOut)).toContain(room.id);
    saved!.status = 'completed'; await saved!.save();
    expect(await find(checkIn, checkOut)).toContain(room.id);
  });
  it('excludes maintenance periods and inactive rooms/types from search and new drafts', async () => {
    const ids = async () => (await availability()).items.map((r: RoomView) => r.id);
    room = (await patch(admin, '/rooms/' + room.id, { ...roomInput(room), status: 'maintenance' }).expect(200)).body.item;
    expect(await ids()).not.toContain(room.id); await post(staff, '/bookings', body()).expect(409);
    room = (await patch(admin, '/rooms/' + room.id, { ...roomInput(room), status: 'available' }).expect(200)).body.item;
    expect(await ids()).toContain(room.id);
    await Room.updateOne({ _id: room.id }, { $push: { unavailable_periods: { start: new Date('2090-09-10T00:00:00+07:00'), end: new Date('2090-09-11T00:00:00+07:00'), reason: 'Bảo trì theo lịch' } } });
    expect(await ids()).not.toContain(room.id);
    expect((await availability('2090-09-11', '2090-09-12')).items.map((r: RoomView) => r.id)).toContain(room.id);
    room = (await patch(admin, '/rooms/' + room.id, { ...roomInput(room), active: false }).expect(200)).body.item;
    expect(await ids()).not.toContain(room.id);
    type = (await patch(admin, '/room-types/' + type.id, { ...inputOf(type), status: 'inactive' }).expect(200)).body.item;
    expect(await ids()).not.toContain(other.id);
  });
  it('deactivating customers preserves their history and prevents new drafts', async () => {
    customer = (await patch(staff, '/customers/' + customer.id, { ...inputOf(customer), status: 'inactive' }).expect(200)).body.item;
    await post(staff, '/bookings', body()).expect(400);
    const history = await staff.agent.get(`/api/v1/customers/${customer.id}/bookings`).expect(200);
    expect(history.body.items[0].id).toBe(draft.id);
    expect(await Customer.exists({ _id: customer.id })).toBeTruthy();
  });
  it('search is literal, pagination is bounded and unknown IDs return useful errors', async () => {
    for (const url of ['/rooms', '/room-types', '/customers', '/services', '/bookings']) {
      const r = await staff.agent.get('/api/v1' + url).query({ q: '.*', limit: 1 }).expect(200);
      expect(r.body.total).toBe(0);
      await staff.agent.get('/api/v1' + url + '?limit=201').expect(400);
      await staff.agent.get('/api/v1' + url + '?page=0').expect(400);
    }
    await staff.agent.get('/api/v1/bookings/bad').expect(400);
    await staff.agent.get('/api/v1/bookings/' + new mongoose.Types.ObjectId()).expect(404);
  });
  it('restarting demo seeding preserves renamed and inactive catalogs', async () => {
    const count = await Room.countDocuments();
    await Room.updateOne({ room_number: '101' }, { $set: { room_number: '101A', active: false } });
    await RoomType.updateOne({ type_code: 'STANDARD' }, { $set: { type_code: 'STANDARD_A', status: 'inactive' } });
    await Service.updateOne({ service_code: 'WATER' }, { $set: { service_code: 'WATER_A', status: 'inactive' } });
    await seedDemo();
    expect(await Room.countDocuments()).toBe(count);
    expect(await Room.exists({ room_number: '101' })).toBeNull();
    expect(await RoomType.exists({ type_code: 'STANDARD' })).toBeNull();
    expect(await Service.exists({ service_code: 'WATER' })).toBeNull();
    expect((await Room.findOne({ room_number: '101A' }))!.active).toBe(false);
  });
  it('creates the first production administrator once without exposing its password', async () => {
    await User.deleteMany({});
    const previous = { username: process.env.BOOTSTRAP_ADMIN_USERNAME, name: process.env.BOOTSTRAP_ADMIN_FULL_NAME, password: process.env.BOOTSTRAP_ADMIN_PASSWORD };
    process.env.BOOTSTRAP_ADMIN_USERNAME = 'online_admin';
    process.env.BOOTSTRAP_ADMIN_FULL_NAME = 'Quản trị trực tuyến';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'StrongOnlinePassword2026!';
    try {
      expect(await bootstrapProductionAdmin()).toBe(true);
      expect(await bootstrapProductionAdmin()).toBe(false);
      const user = await User.findOne({ username: 'online_admin' }).select('+password_hash');
      expect(await User.countDocuments()).toBe(1);
      expect(user).toMatchObject({ full_name: 'Quản trị trực tuyến', role: 'admin', status: 'active' });
      expect(user!.password_hash).not.toContain('StrongOnlinePassword2026!');
    } finally {
      for (const [key, value] of [['BOOTSTRAP_ADMIN_USERNAME', previous.username], ['BOOTSTRAP_ADMIN_FULL_NAME', previous.name], ['BOOTSTRAP_ADMIN_PASSWORD', previous.password]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
