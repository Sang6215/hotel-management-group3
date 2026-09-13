import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { createApp } from '../server/app.js';
import { Booking, Customer, Invoice, Room, RoomType, User, initializeModels } from '../server/models.js';
import { seedDemo } from '../server/seed.js';

let mongo: MongoMemoryReplSet, system: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof login>>, staff: Awaited<ReturnType<typeof login>>;
let adminId: mongoose.Types.ObjectId, staffId: mongoose.Types.ObjectId;
const oid = () => new mongoose.Types.ObjectId();
const origin = 'http://127.0.0.1:5173';
const feb = { from: '2026-02-01', to: '2026-02-28' }, jan = { from: '2026-01-01', to: '2026-01-31' }, mar = { from: '2026-03-01', to: '2026-03-31' };
const at = (s: string) => new Date(s + '+07:00');
const customerId = oid(), serviceId = oid(), roomId = oid(), typeId = oid();
const roomLine = () => ({ room_id: roomId, room_number: '101', room_type_id: typeId, room_type_name: 'Standard', price_per_night: 600000, guest_count: 1 });
const serviceLine = (extra = {}) => ({ service_id: serviceId, room_id: roomId, service_name: 'Giặt ủi', unit: 'Lượt', unit_price: 100000, quantity: 1, amount: 100000, used_at: at('2026-01-31T23:00:00'), created_by: staffId, voided: false, ...extra });
const payment = (extra = {}) => ({ request_id: randomUUID(), kind: 'deposit', direction: 'in', amount: 500000, method: 'cash', recorded_at: at('2026-01-31T23:30:00'), recorded_by: staffId, recorded_by_name: 'Lễ tân thử', ...extra });
async function booking(extra = {}) {
  return Booking.create({ booking_code: 'W5-' + randomUUID(), customer_id: customerId, customer_snapshot: { full_name: 'Khách trùng tên', phone: 'TESTPHONE', id_card: 'PRIVATE-ID-NOT-IN-REPORT' }, rooms_booked: [roomLine()], check_in_plan: at('2026-01-30T14:00:00'), check_out_plan: at('2026-02-01T12:00:00'), actual_check_in: at('2026-01-30T14:00:00'), actual_check_out: at('2026-02-01T00:00:00'), status: 'completed', created_by: staffId, payments: [payment(), payment({ kind: 'checkout', amount: 1800000, recorded_at: at('2026-02-01T00:00:00') }), payment({ kind: 'refund', direction: 'out', amount: 100000, recorded_at: at('2026-03-01T00:00:00'), recorded_by: adminId, recorded_by_name: 'Quản trị thử' })], services_used: [serviceLine()], ...extra });
}
async function invoice(extra = {}) {
  return Invoice.create({ invoice_code: 'HD-W5-' + randomUUID(), booking_id: oid(), customer_id: customerId, customer_name: 'Khách trùng tên', rooms_snapshot: [roomLine(), { ...roomLine(), room_id: oid(), room_number: '102' }], services_snapshot: [serviceLine()], total_room_charge: 2400000, total_service_charge: 100000, discount_amount: 200000, deposit_deducted: 500000, invoice_total: 2300000, balance_collected: 1800000, payment_status: 'paid', paid_at: at('2026-02-01T00:00:00'), created_by: staffId, adjustments: [{ amount: -100000, approved_at: at('2026-03-01T00:00:00'), approved_by: adminId, reason: 'Điều chỉnh thử' }], ...extra });
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.0.15', downloadDir: path.resolve('.local/mongodb-binaries') }, replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  const uri = mongo.getUri('hotel_phase5_tests'); await mongoose.connect(uri); await seedDemo();
  system = createApp({ mongoUri: uri, secret: 'week5-isolated-test-secret-32-characters', origin, demo: true });
  admin = await login('admin', 'AdminDemo2026!'); staff = await login('letan', 'LetanDemo2026!');
  adminId = (await User.findOne({ username: 'admin' }))!._id; staffId = (await User.findOne({ username: 'letan' }))!._id;
});
afterAll(async () => { await system?.sessionStore.close(); await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Booking.deleteMany({}); await Invoice.deleteMany({}); await Room.deleteMany({}); await RoomType.deleteMany({}); });
async function login(username: string, password: string) {
  const agent = request.agent(system.app), pre = await agent.get('/api/v1/auth/csrf');
  const r = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', pre.body.csrfToken).send({ username, password }).expect(200);
  return { agent, csrf: r.body.csrfToken as string };
}
const report = (name: string, query: object = feb, client = admin) => client.agent.get('/api/v1/reports/' + name).query(query);
const post = (url: string, data: object) => admin.agent.post('/api/v1' + url).set('Origin', origin).set('X-CSRF-Token', admin.csrf).send(data);
const patch = (url: string, data: object) => admin.agent.patch('/api/v1' + url).set('Origin', origin).set('X-CSRF-Token', admin.csrf).send(data);

describe('Week 5 real MongoDB reporting', () => {
  it('requires login and restricts hotel-wide reports to administrators', async () => {
    for (const name of ['revenue', 'cash-flow', 'occupancy', 'top-services', 'top-customers', 'my-receipts']) await request(system.app).get('/api/v1/reports/' + name).expect(401);
    for (const name of ['revenue', 'cash-flow', 'occupancy', 'top-services', 'top-customers']) await report(name, feb, staff).expect(403);
    await report('my-receipts', feb, staff).expect(200);
  });
  it('separates a prior-month deposit, multi-room invoice and later adjustment', async () => {
    await booking(); await invoice();
    expect((await report('revenue', jan).expect(200)).body.totals).toMatchObject({ invoiceCount: 0, revenue: 0, cashIn: 500000, netCash: 500000 });
    const r = (await report('revenue').expect(200)).body;
    expect(r.totals).toMatchObject({ invoiceCount: 1, roomTotal: 2400000, serviceTotal: 100000, discount: 200000, invoiceTotal: 2300000, adjustments: 0, revenue: 2300000, cashIn: 1800000, cashOut: 0 });
    expect(r.items).toHaveLength(28); expect(r.items[0].revenue).toBe(2300000); expect(r.items[27].revenue).toBe(0);
    expect((await report('revenue', mar).expect(200)).body.totals).toMatchObject({ invoiceCount: 0, adjustments: -100000, revenue: -100000, cashOut: 100000, netCash: -100000 });
  });
  it('groups by Vietnam calendar month and includes the final instant before midnight', async () => {
    await invoice({ paid_at: at('2026-02-28T23:59:59.999'), adjustments: [] });
    await invoice({ paid_at: at('2026-03-01T00:00:00'), adjustments: [] });
    expect((await report('revenue').expect(200)).body.totals.invoiceCount).toBe(1);
    const r = (await report('revenue', { from: jan.from, to: mar.to, groupBy: 'month' }).expect(200)).body;
    expect(r.items.map((i: { period: string; invoiceCount: number }) => [i.period, i.invoiceCount])).toEqual([['2026-01', 0], ['2026-02', 1], ['2026-03', 1]]);
  });
  it('returns explicit empty results and rejects malformed or oversized filters', async () => {
    expect((await report('revenue').expect(200)).body.totals.revenue).toBe(0);
    for (const name of ['cash-flow', 'top-services', 'top-customers']) expect((await report(name).expect(200)).body.items).toEqual([]);
    expect((await report('occupancy').expect(200)).body.totals.occupancy).toBeNull();
    for (const q of [{ from: '2026-02-30' }, { ...feb, to: '2026-01-01' }, { from: '2025-01-01', to: '2026-01-02' }, { ...feb, groupBy: 'year' }, { ...feb, injected: true }]) await report('revenue', q).expect(400);
    await report('cash-flow', { ...feb, employeeId: 'bad' }).expect(400);
    await report('my-receipts', { ...feb, employeeId: String(adminId) }, staff).expect(400);
    await report('cash-flow', { ...feb, limit: 101 }).expect(400);
  });
  it('filters personal receipts by the same payment element, never another employee', async () => {
    await booking({ payments: [payment(), payment({ recorded_at: at('2026-02-02T12:00:00'), recorded_by: adminId, recorded_by_name: 'PRIVATE-OTHER-EMPLOYEE' })] });
    expect((await report('my-receipts', feb, staff).expect(200)).body.total).toBe(0);
    await booking();
    const r = (await report('my-receipts', feb, staff).expect(200)).body;
    expect(r.total).toBe(1); expect(r.items[0].byId).toBe(String(staffId)); expect(r.totals.netCash).toBe(1800000);
    expect(r.byEmployee).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/PRIVATE|password|payload_hash|customer_snapshot/);
  });
  it('paginates stable receipt rows while totals cover the full filtered period', async () => {
    await booking({ payments: [payment({ recorded_at: at('2026-02-02T12:00:00') }), payment({ recorded_at: at('2026-02-02T12:00:00'), amount: 200000, method: 'card', recorded_by: adminId }), payment({ recorded_at: at('2026-02-02T12:00:00'), amount: 100000, kind: 'refund', direction: 'out' })] });
    const a = (await report('cash-flow', { ...feb, limit: 1 }).expect(200)).body;
    const b = (await report('cash-flow', { ...feb, limit: 1, page: 2 }).expect(200)).body;
    expect(a.totals).toEqual({ count: 3, cashIn: 700000, cashOut: 100000, netCash: 600000 }); expect(b.totals).toEqual(a.totals);
    expect(a.items[0].id).not.toBe(b.items[0].id);
    expect(a.byEmployee).toHaveLength(2); expect(a.byMethod).toHaveLength(2);
    expect((await report('cash-flow', { ...feb, employeeId: String(adminId), method: 'cash' }).expect(200)).body.total).toBe(0);
    expect((await report('cash-flow', { ...feb, kind: 'refund' }).expect(200)).body.totals.netCash).toBe(-100000);
  });
  it('distinguishes service usage time from paid snapshot time and excludes voids', async () => {
    const lines = [serviceLine(), serviceLine({ unit: 'Kg', quantity: 2, unit_price: 50000 }), serviceLine({ voided: true, amount: 999999 })];
    await booking({ services_used: lines }); await booking({ status: 'cancelled', services_used: lines, payments: [] });
    await invoice({ services_snapshot: lines });
    expect((await report('top-services', { ...feb, mode: 'usage' }).expect(200)).body.items).toEqual([]);
    const used = (await report('top-services', { ...jan, mode: 'usage' }).expect(200)).body;
    expect(used.total).toBe(2); expect(used.items[0]).toMatchObject({ unit: 'Kg', quantity: 2, amount: 100000 });
    const paid = (await report('top-services', { ...feb, mode: 'invoice', limit: 1 }).expect(200)).body;
    expect(paid.total).toBe(2); expect(paid.items).toHaveLength(1); expect(paid.items[0].name).toBe('Giặt ủi');
  });
  it('ranks customer identities separately and records adjustment-only activity in its own month', async () => {
    await invoice(); const other = oid(); await invoice({ customer_id: other, invoice_total: 900000, adjustments: [] });
    const r = (await report('top-customers').expect(200)).body;
    expect(r.total).toBe(2); expect(r.items.map((i: { id: string }) => i.id)).toEqual([String(customerId), String(other)]);
    expect(r.items.map((i: { revenue: number }) => i.revenue)).toEqual([2300000, 900000]);
    const later = (await report('top-customers', mar).expect(200)).body;
    expect(later.items[0]).toMatchObject({ id: String(customerId), invoiceCount: 0, invoiceTotal: 0, adjustments: -100000, revenue: -100000 });
    expect((await report('top-customers', { ...feb, limit: 1 }).expect(200)).body.items).toHaveLength(1);
  });
  it('rejects unsafe aggregated monetary amounts instead of returning rounded money', async () => {
    await invoice({ invoice_total: Number.MAX_SAFE_INTEGER, total_room_charge: Number.MAX_SAFE_INTEGER, adjustments: [] });
    await invoice({ adjustments: [] });
    await report('revenue').expect(409); await report('top-customers').expect(409);
  });
  it('rejects unsafe cancelling adjustments even when the resulting net is small', async () => {
    await invoice({ adjustments: [{ amount: Number.MAX_SAFE_INTEGER, approved_at: at('2026-03-01T12:00:00') }, { amount: -Number.MAX_SAFE_INTEGER, approved_at: at('2026-03-01T12:00:00') }] });
    await report('revenue', mar).expect(409); await report('top-customers', mar).expect(409);
  });
  it('shows lifetime spending for the exact customer identity to both roles', async () => {
    await Customer.create({ _id: customerId, full_name: 'Khách trùng tên', phone: 'W5-PHONE', id_card: 'W5-ID' });
    await invoice(); await invoice({ customer_id: oid(), invoice_total: 900000, adjustments: [] });
    await request(system.app).get(`/api/v1/customers/${customerId}/spending`).expect(401);
    for (const client of [admin, staff]) expect((await client.agent.get(`/api/v1/customers/${customerId}/spending`).expect(200)).body).toMatchObject({ invoiceCount: 1, invoiceTotal: 2300000, adjustments: -100000, total: 2200000 });
    await staff.agent.get(`/api/v1/customers/${oid()}/spending`).expect(404);
    await staff.agent.get('/api/v1/customers/bad/spending').expect(400);
  });
  it('computes occupancy from recorded history through the API', async () => {
    await Room.collection.insertOne({ _id: roomId, room_number: 'W5-HISTORY', room_type_id: typeId, floor: 1, active: false, status: 'maintenance', created_at: at('2026-01-01T00:00:00'), inventory_history: [{ at: at('2026-01-01T00:00:00'), type_id: typeId, type_name: 'Historical Standard', enabled: true }], unavailable_periods: [] });
    await booking({ actual_check_in: at('2026-01-31T14:00:00'), actual_check_out: at('2026-02-03T12:00:00') });
    expect((await report('occupancy', { from: feb.from, to: '2026-02-03' }).expect(200)).body.totals).toMatchObject({ usedRoomNights: 2, availableRoomNights: 3, occupancy: 66.67 });
  });
  it('records new room history and propagates room-type activation changes without changing prices', async () => {
    let type = (await post('/room-types', { code: 'W5-TYPE', name: 'Standard', price: 600000, capacity: 2, amenities: [], description: '', status: 'active' }).expect(201)).body.item;
    let r = (await post('/rooms', { number: 'W5-101', floor: 1, typeId: type.id, active: true, status: 'available' }).expect(201)).body.item;
    expect((await Room.findById(r.id))!.inventory_history).toHaveLength(1);
    r = (await patch('/rooms/' + r.id, { number: r.number, floor: r.floor, typeId: type.id, active: true, status: 'maintenance', version: r.version }).expect(200)).body.item;
    expect((await Room.findById(r.id))!.inventory_history.at(-1)!.enabled).toBe(false);
    r = (await patch('/rooms/' + r.id, { number: r.number, floor: r.floor, typeId: type.id, active: true, status: 'available', version: r.version }).expect(200)).body.item;
    type = (await patch('/room-types/' + type.id, { code: type.code, name: type.name, price: type.price, capacity: type.capacity, amenities: [], description: '', status: 'inactive', version: type.version }).expect(200)).body.item;
    const physical = (await Room.findById(r.id))!;
    expect(physical.active).toBe(true); expect(physical.status).toBe('available'); expect(physical.inventory_history.at(-1)!.enabled).toBe(false);
    expect((await RoomType.findById(type.id))!.base_price_per_night).toBe(600000);
    await patch('/room-types/' + type.id, { code: type.code, name: type.name, price: type.price, capacity: type.capacity, amenities: [], description: '', status: 'active', version: type.version }).expect(200);
    expect((await Room.findById(r.id))!.inventory_history.at(-1)!.enabled).toBe(true);
  });
  it('migrates legacy rooms once, without inventing past capacity or changing their business state', async () => {
    await RoomType.create({ _id: typeId, type_code: 'W5-OLD', name: 'Old', base_price_per_night: 600000, max_occupancy: 2, status: 'active' });
    await Room.collection.insertOne({ _id: roomId, room_number: 'W5-OLD', room_type_id: typeId, floor: 1, active: false, status: 'maintenance', created_at: at('2026-01-01T00:00:00'), version: 0 });
    const before = Date.now(); await initializeModels();
    const first = (await Room.findById(roomId))!; expect(first.inventory_history).toHaveLength(1); expect(first.inventory_history[0].at.getTime()).toBeGreaterThanOrEqual(before);
    expect(first.toObject()).toMatchObject({ active: false, status: 'maintenance', floor: 1 });
    await initializeModels(); const second = (await Room.findById(roomId))!;
    expect(second.version).toBe(first.version); expect(second.inventory_history).toHaveLength(1);
    expect((await report('occupancy').expect(200)).body.totals).toMatchObject({ unknownRoomNights: 28, availableRoomNights: 0, occupancy: null });
  });
});
