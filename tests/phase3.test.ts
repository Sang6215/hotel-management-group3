import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { createApp } from '../server/app.js';
import { Booking, Customer, Room, RoomType } from '../server/models.js';
import { seedDemo } from '../server/seed.js';
import { hotelDay, nextDay } from '../shared/dates.js';
import type { BookingView, ConfirmationQuote, CustomerView, RoomTypeView, RoomView } from '../shared/types.js';

let mongo: MongoMemoryReplSet, system: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof login>>, staff: Awaited<ReturnType<typeof login>>, staff2: Awaited<ReturnType<typeof login>>;
let type: RoomTypeView, rooms: RoomView[], customer: CustomerView;
const origin = 'http://127.0.0.1:5173', today = hotelDay(new Date()), tomorrow = nextDay(today), day2 = nextDay(tomorrow), day3 = nextDay(day2), day4 = nextDay(day3);
let count = 0;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.0.15', downloadDir: path.resolve('.local/mongodb-binaries') }, replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  const uri = mongo.getUri('hotel_phase3_tests');
  await mongoose.connect(uri); await seedDemo();
  system = createApp({ mongoUri: uri, secret: 'phase3-test-secret-at-least-32-characters', origin, demo: true });
  admin = await login('admin', 'AdminDemo2026!'); staff = await login('letan', 'LetanDemo2026!'); staff2 = await login('letan', 'LetanDemo2026!');
});
afterAll(async () => { await system?.sessionStore.close(); await mongoose.disconnect(); await mongo?.stop(); });
async function login(username: string, password: string) {
  const agent = request.agent(system.app), pre = await agent.get('/api/v1/auth/csrf');
  const r = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', pre.body.csrfToken).send({ username, password }).expect(200);
  return { agent, csrf: r.body.csrfToken as string };
}
function post(client: typeof admin, url: string, body: object) { return client.agent.post('/api/v1' + url).set('X-CSRF-Token', client.csrf).set('Origin', origin).send(body); }
function patch(client: typeof admin, url: string, body: object) { return client.agent.patch('/api/v1' + url).set('X-CSRF-Token', client.csrf).set('Origin', origin).send(body); }
const command = (b: BookingView) => ({ requestId: randomUUID(), version: b.version });
const roomInput = (r: RoomView) => ({ number: r.number, floor: r.floor, typeId: r.typeId, status: r.status, active: r.active, version: r.version });
const typeInput = () => ({ code: type.code, name: type.name, price: type.price, capacity: type.capacity, amenities: type.amenities, description: type.description, status: type.status, version: type.version });
async function draft(indices = [0], checkIn = today, checkOut = day2) {
  return (await post(staff, '/bookings', { customerId: customer.id, checkIn, checkOut, rooms: indices.map(i => ({ roomId: rooms[i].id, guestCount: 2 })), note: 'Kiểm thử tuần 3' }).expect(201)).body.item as BookingView;
}
async function quote(b: BookingView) { return (await staff.agent.get(`/api/v1/bookings/${b.id}/confirmation-quote`).expect(200)).body.quote as ConfirmationQuote; }
async function confirmation(b: BookingView) {
  const q = await quote(b); return { ...command(b), amount: q.minimumDeposit, method: 'cash', reference: '', quoteToken: q.token };
}
async function confirm(b: BookingView) { return (await post(staff, `/bookings/${b.id}/confirm`, await confirmation(b)).expect(200)).body.item as BookingView; }
async function detail(b: BookingView) { return (await staff.agent.get(`/api/v1/bookings/${b.id}`).expect(200)).body.item as BookingView; }
async function available(checkIn = today, checkOut = day2) { return (await staff.agent.get('/api/v1/rooms/availability').query({ checkIn, checkOut, typeId: type.id, limit: 200 }).expect(200)).body.items.map((r: RoomView) => r.id); }
beforeEach(async () => {
  count++;
  type = (await post(admin, '/room-types', { code: `W3_${count}`, name: `Loại tuần 3 ${count}`, price: 600000, capacity: 2, amenities: [], description: '', status: 'active' }).expect(201)).body.item;
  rooms = [];
  for (let i = 0; i < 3; i++) rooms.push((await post(admin, '/rooms', { number: `W3-${count}-${i}`, floor: 3, typeId: type.id, status: 'available', active: true }).expect(201)).body.item);
  customer = (await post(staff, '/customers', { fullName: `Khách tuần 3 ${count}`, phone: '097' + String(count).padStart(7, '0'), idCard: `TESTW3${String(count).padStart(4, '0')}`, status: 'active' }).expect(201)).body.item;
});

describe('Week 3: real MongoDB transactions and hotel lifecycle', () => {
  it('protects command endpoints with authentication, CSRF and refund role checks', async () => {
    const b = await draft();
    for (const action of ['confirm', 'deposits', 'check-in', 'extend', 'cancel', 'refunds', 'reschedule']) {
      const pre = request.agent(system.app), token = await pre.get('/api/v1/auth/csrf');
      await pre.post(`/api/v1/bookings/${b.id}/${action}`).set('X-CSRF-Token', token.body.csrfToken).send({}).expect(401);
      await staff.agent.post(`/api/v1/bookings/${b.id}/${action}`).send({}).expect(403);
    }
    await post(staff, `/bookings/${b.id}/refunds`, {}).expect(403);
  });
  it('requires a reviewed fresh quote and refreshes both price and customer snapshot', async () => {
    let b = await draft([0, 1]); const old = await confirmation(b);
    await patch(admin, '/room-types/' + type.id, { ...typeInput(), price: 750000 }).expect(200);
    await patch(staff, '/customers/' + customer.id, { fullName: 'Tên mới xác nhận', phone: customer.phone, idCard: customer.idCard, status: 'active', version: customer.version }).expect(200);
    await post(staff, `/bookings/${b.id}/confirm`, old).expect(409);
    expect((await detail(b)).payments).toHaveLength(0);
    b = await confirm(b);
    expect(b).toMatchObject({ status: 'confirmed', estimatedTotal: 3000000, deposit: 900000, version: 1, customer: { fullName: 'Tên mới xác nhận' } });
    expect(b.rooms.map(r => r.price)).toEqual([750000, 750000]);
    expect(b.history.at(-1)).toMatchObject({ action: 'confirmed', by: 'Nhân viên lễ tân' });
    expect(b.confirmedAt).toBeTruthy();
    expect(await available()).not.toContain(rooms[0].id);
    expect(await available(day2, day3)).toContain(rooms[0].id);
  });
  it('only lets one of two staff reserve overlapping rooms, without a losing deposit', async () => {
    const a = await draft([0, 1]), b = await draft([1, 2]);
    const da = await confirmation(a), db = await confirmation(b);
    const results = await Promise.all([post(staff, `/bookings/${a.id}/confirm`, da), post(staff2, `/bookings/${b.id}/confirm`, db)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const states = await Promise.all([detail(a), detail(b)]);
    expect(states.map(b => b.status).sort()).toEqual(['confirmed', 'pending']);
    expect(states.find(b => b.status === 'pending')!.payments).toHaveLength(0);
    expect(states.find(b => b.status === 'pending')!.deposit).toBe(0);
    expect(await Booking.countDocuments({ _id: { $in: [a.id, b.id] }, status: 'confirmed' })).toBe(1);
  });
  it('deduplicates simultaneous retries and preserves the original receipt after later commands', async () => {
    const b = await draft(), d = await confirmation(b);
    const results = await Promise.all([post(staff, `/bookings/${b.id}/confirm`, d), post(staff2, `/bookings/${b.id}/confirm`, d)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(results[0].body.receipt).toEqual(results[1].body.receipt);
    const current = await detail(b);
    await post(staff, `/bookings/${b.id}/deposits`, { ...command(current), amount: 100000, method: 'cash' }).expect(200);
    const retry = await post(staff, `/bookings/${b.id}/confirm`, d).expect(200);
    expect(retry.body.receipt).toEqual(results[0].body.receipt);
    expect(retry.body.item.payments).toHaveLength(2);
    await post(staff, `/bookings/${b.id}/confirm`, { ...d, amount: d.amount + 1 }).expect(409);
    await post(admin, `/bookings/${b.id}/confirm`, d).expect(409);
  });
  it('validates deposit bounds, unknown fields and stale versions without changing balances', async () => {
    let b = await draft(); const d = await confirmation(b);
    for (const extra of [{ amount: 0 }, { amount: -1 }, { amount: 0.5 }, { amount: 1200001 }, { requestId: 'invalid' }, { total: 1 }]) await post(staff, `/bookings/${b.id}/confirm`, { ...d, ...extra }).expect(400);
    await post(staff, `/bookings/${b.id}/deposits`, { ...command(b), amount: 100, method: 'cash' }).expect(409);
    b = await confirm(b);
    const additions = await Promise.all([staff, staff2].map(c => post(c, `/bookings/${b.id}/deposits`, { ...command(b), amount: 500000, method: 'transfer', reference: 'TEST-ONLY' })));
    expect(additions.map(r => r.status).sort()).toEqual([200, 409]);
    b = await detail(b); expect(b.deposit).toBe(860000);
    await post(staff, `/bookings/${b.id}/deposits`, { ...command(b), amount: 400000, method: 'cash' }).expect(400);
  });
  it('rolls back the reservation, history, money and schedule locks when saving fails', async () => {
    const b = await draft([0, 1]), d = await confirmation(b);
    const versions = await Room.find({ _id: { $in: rooms.map(r => r.id) } }).sort({ room_number: 1 }).lean();
    const fail = vi.spyOn(Booking.prototype, 'save').mockRejectedValueOnce(new Error('Simulated payment persistence failure'));
    try { await post(staff, `/bookings/${b.id}/confirm`, d).expect(500); } finally { fail.mockRestore(); }
    expect(await detail(b)).toEqual(b);
    const after = await Room.find({ _id: { $in: rooms.map(r => r.id) } }).sort({ room_number: 1 }).lean();
    expect(after.map(r => r.schedule_version)).toEqual(versions.map(r => r.schedule_version));
    await post(staff, `/bookings/${b.id}/confirm`, d).expect(200);
  });
  it('serializes maintenance and confirmation on the same room', async () => {
    const b = await draft(), d = await confirmation(b);
    const results = await Promise.all([post(staff, `/bookings/${b.id}/confirm`, d), patch(admin, '/rooms/' + rooms[0].id, { ...roomInput(rooms[0]), status: 'maintenance' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const stored = await detail(b), r = await Room.findById(rooms[0].id);
    expect(stored.status === 'confirmed' && r!.status === 'maintenance').toBe(false);
  });
  it('serializes type deactivation and confirmation on a shared type guard', async () => {
    const b = await draft(), d = await confirmation(b);
    const results = await Promise.all([post(staff, `/bookings/${b.id}/confirm`, d), patch(admin, '/room-types/' + type.id, { ...typeInput(), status: 'inactive' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await detail(b)).status === 'confirmed' && (await RoomType.findById(type.id))!.status === 'inactive').toBe(false);
  });
  it('cancels with a reason, releases rooms and requires an administrator to refund exactly once', async () => {
    let b = await confirm(await draft([0, 1]));
    await post(staff, `/bookings/${b.id}/cancel`, { ...command(b), reason: '' }).expect(400);
    const d = { ...command(b), reason: 'Khách thay đổi kế hoạch' };
    b = (await post(staff, `/bookings/${b.id}/cancel`, d).expect(200)).body.item;
    expect(b).toMatchObject({ status: 'cancelled', refundStatus: 'pending', deposit: 720000 });
    expect(await available()).toContain(rooms[0].id); expect(await available()).toContain(rooms[1].id);
    const list = await staff.agent.get('/api/v1/bookings?refund=pending').expect(200);
    expect(list.body.items.some((x: BookingView) => x.id === b.id)).toBe(true);
    const refund = { ...command(b), method: 'transfer', reference: 'REFUND-TEST', reason: 'Đã hoàn đủ cho khách' };
    await post(staff, `/bookings/${b.id}/refunds`, refund).expect(403);
    const results = await Promise.all([post(admin, `/bookings/${b.id}/refunds`, refund), post(admin, `/bookings/${b.id}/refunds`, refund)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    b = await detail(b);
    expect(b).toMatchObject({ refundStatus: 'refunded', refundedTotal: 720000, deposit: 0 });
    expect(b.payments.filter(p => p.kind === 'refund')).toHaveLength(1);
    await post(admin, `/bookings/${b.id}/refunds`, { ...refund, ...command(b) }).expect(409);
    await post(staff, `/bookings/${b.id}/check-in`, command(b)).expect(409);
  });
  it('cancels a pending draft without creating a refund or payment', async () => {
    const b = await draft();
    const r = await post(staff, `/bookings/${b.id}/cancel`, { ...command(b), reason: 'Không còn nhu cầu' }).expect(200);
    expect(r.body.item).toMatchObject({ status: 'cancelled', refundStatus: 'none', deposit: 0, payments: [] });
  });
  it('checks in every room together, requires readiness and rolls back room updates on failure', async () => {
    let b = await draft([0, 1]);
    await post(staff, `/bookings/${b.id}/check-in`, command(b)).expect(409);
    b = await confirm(b);
    rooms[1] = (await patch(admin, '/rooms/' + rooms[1].id, { ...roomInput(rooms[1]), status: 'cleaning' }).expect(200)).body.item;
    await post(staff, `/bookings/${b.id}/check-in`, command(b)).expect(409);
    expect((await Room.findById(rooms[0].id))!.status).toBe('available');
    rooms[1] = (await patch(admin, '/rooms/' + rooms[1].id, { ...roomInput(rooms[1]), status: 'available' }).expect(200)).body.item;
    const d = command(b), fail = vi.spyOn(Booking.prototype, 'save').mockRejectedValueOnce(new Error('Simulated check-in save failure'));
    try { await post(staff, `/bookings/${b.id}/check-in`, d).expect(500); } finally { fail.mockRestore(); }
    expect(await Room.countDocuments({ _id: { $in: roomIdsOf(b) }, status: 'occupied' })).toBe(0);
    b = (await post(staff, `/bookings/${b.id}/check-in`, d).expect(200)).body.item;
    expect(b.status).toBe('checked_in'); expect(b.actualCheckIn).toBeTruthy();
    expect(await Room.countDocuments({ _id: { $in: roomIdsOf(b) }, status: 'occupied', current_booking_id: b.id })).toBe(2);
    await post(staff, `/bookings/${b.id}/check-in`, d).expect(200);
    await post(staff, `/bookings/${b.id}/cancel`, { ...command(b), reason: 'Đang ở không được hủy' }).expect(409);
  });
  it('rejects check-in on a different day and when an earlier overdue guest still occupies the room', async () => {
    const future = await confirm(await draft([0], tomorrow, day3));
    await post(staff, `/bookings/${future.id}/check-in`, command(future)).expect(409);
    const now = await confirm(await draft([1]));
    await Room.updateOne({ _id: rooms[1].id }, { $set: { status: 'occupied', current_booking_id: new mongoose.Types.ObjectId() } });
    await post(staff, `/bookings/${now.id}/check-in`, command(now)).expect(409);
    expect((await detail(now)).status).toBe('confirmed');
  });
  it('extends all rooms with frozen rates, rejects overlaps and serializes competing extensions', async () => {
    let b = await confirm(await draft([0, 1]));
    b = (await post(staff, `/bookings/${b.id}/check-in`, command(b)).expect(200)).body.item;
    const following = await confirm(await draft([1], day3, day4));
    await patch(admin, '/room-types/' + type.id, { ...typeInput(), price: 990000 }).expect(200);
    await post(staff, `/bookings/${b.id}/extend`, { ...command(b), checkOut: day4, reason: 'Trùng lịch kế tiếp' }).expect(409);
    const requests = await Promise.all([staff, staff2].map(c => post(c, `/bookings/${b.id}/extend`, { ...command(b), checkOut: day3, reason: 'Khách ở thêm một đêm' })));
    expect(requests.map(r => r.status).sort()).toEqual([200, 409]);
    b = await detail(b); expect(b).toMatchObject({ checkOut: day3, estimatedTotal: 3600000, deposit: 720000 });
    expect(b.rooms.map(r => r.price)).toEqual([600000, 600000]);
    expect((await detail(following)).checkIn).toBe(day3);
    await post(staff, `/bookings/${b.id}/extend`, { ...command(b), checkOut: day2, reason: 'Rút ngắn không phải gia hạn' }).expect(400);
  });
  it('serializes extension versus a new reservation for the added night', async () => {
    let b = await confirm(await draft([0]));
    b = (await post(staff, `/bookings/${b.id}/check-in`, command(b)).expect(200)).body.item;
    const other = await draft([0], day2, day3), d = await confirmation(other);
    const results = await Promise.all([post(staff, `/bookings/${b.id}/extend`, { ...command(b), checkOut: day3, reason: 'Thêm một đêm' }), post(staff2, `/bookings/${other.id}/confirm`, d)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  });
  it('reschedules confirmed rooms atomically with frozen prices and releases the old dates', async () => {
    let b = await confirm(await draft([0]));
    b = (await post(staff, `/bookings/${b.id}/reschedule`, { ...command(b), checkIn: day2, checkOut: day4, reason: 'Khách lùi ngày đến' }).expect(200)).body.item;
    expect(b).toMatchObject({ status: 'confirmed', checkIn: day2, checkOut: day4, deposit: 360000 });
    expect(await available(today, day2)).toContain(rooms[0].id);
    expect(await available(day2, day4)).not.toContain(rooms[0].id);
    await post(staff, `/bookings/${b.id}/reschedule`, { ...command(b), checkIn: today, checkOut: day4, reason: 'Cọc không đủ lịch dài hơn' }).expect(409);
  });
  it('rechecks deactivated customers, capacity, maintenance periods and historical drafts before confirmation', async () => {
    const b = await draft(), d = await confirmation(b);
    await Customer.updateOne({ _id: customer.id }, { $set: { status: 'inactive' } });
    await post(staff, `/bookings/${b.id}/confirm`, d).expect(409);
    await Customer.updateOne({ _id: customer.id }, { $set: { status: 'active' } });
    await RoomType.updateOne({ _id: type.id }, { $set: { max_occupancy: 1 } });
    await post(staff, `/bookings/${b.id}/confirm`, d).expect(409);
    await RoomType.updateOne({ _id: type.id }, { $set: { max_occupancy: 2 } });
    await Room.updateOne({ _id: rooms[0].id }, { $push: { unavailable_periods: { start: new Date(today + 'T00:00:00+07:00'), end: new Date(tomorrow + 'T00:00:00+07:00') } } });
    await post(staff, `/bookings/${b.id}/confirm`, d).expect(409);
    const old = await draft([2]);
    await Booking.updateOne({ _id: old.id }, { $set: { check_in_plan: new Date('2020-01-01'), check_out_plan: new Date('2020-01-02') } });
    await staff.agent.get(`/api/v1/bookings/${old.id}/confirmation-quote`).expect(400);
  });
});
const roomIdsOf = (b: BookingView) => b.rooms.map(r => r.roomId);
