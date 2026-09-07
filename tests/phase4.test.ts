import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { createApp } from '../server/app.js';
import { Booking, Invoice, Promotion, Room } from '../server/models.js';
import { seedDemo } from '../server/seed.js';
import { DAY_MS, hotelDay } from '../shared/dates.js';
import type { BookingView, CheckoutQuote, InvoiceView, PromotionView, ServiceView } from '../shared/types.js';

let mongo: MongoMemoryReplSet, system: ReturnType<typeof createApp>;
let admin: Awaited<ReturnType<typeof login>>, staff: Awaited<ReturnType<typeof login>>, staff2: Awaited<ReturnType<typeof login>>;
let type: { id: string }, rooms: { id: string; number: string; version: number }[], customer: { id: string; fullName: string }, service: ServiceView;
let count = 0;
const origin = 'http://127.0.0.1:5173', today = hotelDay(new Date());
const day = (offset: number) => new Date(Date.parse(today + 'T00:00:00Z') + offset * DAY_MS).toISOString().slice(0, 10);
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.0.15', downloadDir: path.resolve('.local/mongodb-binaries') }, replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  const uri = mongo.getUri('hotel_phase4_tests');
  await mongoose.connect(uri); await seedDemo();
  system = createApp({ mongoUri: uri, secret: 'week4-test-secret-at-least-32-characters', origin, demo: true });
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
const command = (b: { version: number }) => ({ requestId: randomUUID(), version: b.version });
const detail = async (b: { id: string }): Promise<BookingView> => (await staff.agent.get('/api/v1/bookings/' + b.id).expect(200)).body.item;
const invoice = async (id: string): Promise<InvoiceView> => (await staff.agent.get('/api/v1/invoices/' + id).expect(200)).body.item;
const serviceBody = () => ({ code: service.code, name: service.name, category: service.category, unit: service.unit, price: service.price, status: service.status, version: service.version });
const promotionBody = (p: PromotionView) => ({ code: p.code, type: p.type, value: p.value, maxDiscount: p.maxDiscount, minAmount: p.minAmount, startsOn: p.startsOn, endsOn: p.endsOn, status: p.status, version: p.version });
async function promo(extra = {}): Promise<PromotionView> {
  return (await post(admin, '/promotions', { code: `W4_${count}_${randomUUID().slice(0, 6)}`, type: 'fixed', value: 200000, maxDiscount: 200000, minAmount: 0, startsOn: day(-1), endsOn: day(1), status: 'active', ...extra }).expect(201)).body.item;
}
async function draft(plannedNights = 1, selected = [0, 1]): Promise<BookingView> {
  return (await post(staff, '/bookings', { customerId: customer.id, checkIn: today, checkOut: day(plannedNights), rooms: selected.map(n => ({ roomId: rooms[n].id, guestCount: 1 })), note: 'Dữ liệu kiểm thử tuần 4' }).expect(201)).body.item;
}
async function stay(elapsed = 2, deposit = 500000, plannedNights = 1): Promise<BookingView> {
  let b = await draft(plannedNights);
  const q = (await staff.agent.get(`/api/v1/bookings/${b.id}/confirmation-quote`).expect(200)).body.quote;
  b = (await post(staff, `/bookings/${b.id}/confirm`, { ...command(b), amount: deposit, method: 'cash', quoteToken: q.token }).expect(200)).body.item;
  b = (await post(staff, `/bookings/${b.id}/check-in`, command(b)).expect(200)).body.item;
  // Only the isolated test database receives historical fixtures; never alter the application clock or Atlas.
  if (elapsed) await Booking.updateOne({ _id: b.id }, { $set: { actual_check_in: new Date(Date.now() - elapsed * DAY_MS), check_in_plan: new Date(day(-elapsed) + 'T00:00:00+07:00') } });
  return detail(b);
}
async function add(b: BookingView, extra = {}) {
  return (await post(staff, `/bookings/${b.id}/services`, { ...command(b), serviceId: service.id, serviceVersion: service.version, roomId: rooms[0].id, quantity: 1, ...extra }).expect(200)).body.item as BookingView;
}
async function preview(b: BookingView, promotionCode = ''): Promise<CheckoutQuote> { return (await post(staff, `/bookings/${b.id}/checkout-preview`, { promotionCode }).expect(200)).body.quote; }
async function checkoutData(b: BookingView, promotionCode = '') {
  const q = await preview(b, promotionCode);
  return { ...command(q), promotionCode, quoteToken: q.token, amount: q.toRefund || q.toCollect, method: 'cash', reference: 'TEST', verified: true };
}
async function settle(b: BookingView, promotionCode = '', client = staff) {
  const r = await post(client, `/bookings/${b.id}/checkout`, await checkoutData(b, promotionCode)).expect(200);
  return { b: r.body.item as BookingView, i: await invoice(r.body.item.invoiceId), receipt: r.body.receipt };
}
const adjustData = (i: InvoiceView, amount = 100000) => ({ ...command(i), amount, reason: 'Đối chiếu sai sót thử nghiệm', method: 'cash', reference: 'TEST-ADJUST', verified: true });
beforeEach(async () => {
  count++;
  type = (await post(admin, '/room-types', { code: `W4_${count}`, name: `Loại tuần 4 ${count}`, price: 600000, capacity: 2, amenities: [], description: '', status: 'active' }).expect(201)).body.item;
  rooms = [];
  for (let n = 0; n < 3; n++) rooms.push((await post(admin, '/rooms', { number: `W4-${count}-${n}`, floor: 4, typeId: type.id, status: 'available', active: true }).expect(201)).body.item);
  customer = (await post(staff, '/customers', { fullName: `Khách tuần 4 ${count}`, phone: '096' + String(count).padStart(7, '0'), idCard: `W4TEST${String(count).padStart(5, '0')}`, status: 'active' }).expect(201)).body.item;
  service = (await post(admin, '/services', { code: `W4_S${count}`, name: `Dịch vụ ${count}`, category: 'Thực hành', unit: 'Lượt', price: 100000, status: 'active' }).expect(201)).body.item;
});

describe('Week 4 real MongoDB billing and settlement', () => {
  it('enforces authentication, CSRF and catalogue/adjustment roles', async () => {
    await request(system.app).get('/api/v1/invoices').expect(401);
    await request(system.app).get('/api/v1/promotions').expect(401);
    await post(staff, '/promotions', {}).expect(403);
    await patch(staff, '/promotions/' + new mongoose.Types.ObjectId(), {}).expect(403);
    await post(staff, '/invoices/' + new mongoose.Types.ObjectId() + '/adjustments', {}).expect(403);
    const b = await stay();
    for (const action of ['services', 'checkout-preview', 'checkout']) await staff.agent.post(`/api/v1/bookings/${b.id}/${action}`).send({}).expect(403);
    const anonymous = request.agent(system.app), csrf = await anonymous.get('/api/v1/auth/csrf');
    await anonymous.post(`/api/v1/bookings/${b.id}/checkout`).set('X-CSRF-Token', csrf.body.csrfToken).send({}).expect(401);
  });
  it('validates and versions promotion CRUD, including inclusive one-day validity', async () => {
    const p = await promo({ code: ` lower_${count} `, startsOn: today, endsOn: today });
    expect(p).toMatchObject({ code: `LOWER_${count}`, startsOn: today, endsOn: today, version: 0 });
    await post(admin, '/promotions', { ...promotionBody(p), version: undefined }).expect(409);
    for (const extra of [{ type: 'percentage', value: 101 }, { maxDiscount: 0 }, { minAmount: -1 }, { endsOn: day(-1) }, { value: .5 }, { startsOn: '2026-02-30' }, { extra: 1 }]) await post(admin, '/promotions', { ...promotionBody(p), version: undefined, code: `NEW_${count}`, ...extra }).expect(400);
    const changed = await patch(admin, '/promotions/' + p.id, { ...promotionBody(p), status: 'inactive' }).expect(200);
    expect(changed.body.item.version).toBe(1);
    await patch(admin, '/promotions/' + p.id, promotionBody(p)).expect(409);
    const list = await staff.agent.get('/api/v1/promotions').query({ q: p.code.toLowerCase(), status: 'inactive', page: 1, limit: 1 }).expect(200);
    expect(list.body.total).toBe(1);
  });
  it('validates service ownership, quantities, active state and reviewed catalogue version', async () => {
    const b = await stay();
    const d = { ...command(b), roomId: rooms[0].id, serviceId: service.id, serviceVersion: service.version, quantity: 1 };
    for (const extra of [{ roomId: rooms[2].id }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 1001 }, { price: 1 }, { requestId: 'wrong' }]) await post(staff, `/bookings/${b.id}/services`, { ...d, ...extra }).expect(400);
    service = (await patch(admin, '/services/' + service.id, { ...serviceBody(), price: 200000 }).expect(200)).body.item;
    await post(staff, `/bookings/${b.id}/services`, d).expect(409);
    await patch(admin, '/services/' + service.id, { ...serviceBody(), status: 'inactive' }).expect(200);
    await post(staff, `/bookings/${b.id}/services`, { ...d, serviceVersion: service.version }).expect(409);
    expect((await detail(b)).services).toHaveLength(0);
  });
  it('preserves service snapshots, records corrections and keeps voided lines out of totals', async () => {
    let b = await add(await stay()); const first = b.services[0];
    service = (await patch(admin, '/services/' + service.id, { ...serviceBody(), price: 250000, name: 'Tên danh mục mới', unit: 'Bộ' }).expect(200)).body.item;
    b = await add(b); expect(b.services.map(s => s.price)).toEqual([100000, 250000]);
    const d = { ...command(b), quantity: 2, voided: false, reason: 'Sửa nhầm số lượng' };
    b = (await patch(staff, `/bookings/${b.id}/services/${first.id}`, d).expect(200)).body.item;
    expect(b.services[0]).toMatchObject({ price: 100000, quantity: 2, amount: 200000, unit: 'Lượt', name: first.name });
    expect(b.serviceTotal).toBe(450000);
    await patch(staff, `/bookings/${b.id}/services/${b.services[1].id}`, d).expect(409);
    b = (await patch(staff, `/bookings/${b.id}/services/${first.id}`, { ...command(b), quantity: 2, voided: true, reason: 'Hủy dòng bị nhập nhầm' }).expect(200)).body.item;
    expect(b.serviceTotal).toBe(250000); expect(b.services[0].voided).toBe(true);
    expect(b.history.at(-1)?.reason).toContain('Hủy dòng bị nhập nhầm');
    await patch(staff, `/bookings/${b.id}/services/${first.id}`, { ...command(b), quantity: 1, voided: false, reason: 'Thử khôi phục dòng' }).expect(409);
  });
  it('deduplicates simultaneous service commands and refuses competing stale versions', async () => {
    let b = await stay(); const d = { ...command(b), roomId: rooms[0].id, serviceId: service.id, serviceVersion: service.version, quantity: 1 };
    const repeated = await Promise.all([staff, staff2].map(c => post(c, `/bookings/${b.id}/services`, d)));
    expect(repeated.map(r => r.status)).toEqual([200, 200]); expect(repeated[0].body.receipt).toEqual(repeated[1].body.receipt);
    b = await detail(b); expect(b.services).toHaveLength(1);
    const competing = await Promise.all([staff, staff2].map(c => post(c, `/bookings/${b.id}/services`, { ...d, ...command(b) })));
    expect(competing.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await detail(b)).services).toHaveLength(2);
  });
  it('calculates the agreed example and atomically creates a frozen invoice with all rooms cleaning', async () => {
    const b = await add(await stay()), p = await promo(), q = await preview(b, p.code);
    expect(q).toMatchObject({ nights: 2, roomTotal: 2400000, serviceTotal: 100000, discount: 200000, total: 2300000, deposit: 500000, toCollect: 1800000, toRefund: 0 });
    expect((await detail(b)).version).toBe(b.version); expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(0);
    const completed = await settle(b, p.code);
    expect(completed.b).toMatchObject({ status: 'completed', deposit: 0, refundStatus: 'none' });
    expect(completed.b.actualCheckOut).toBeTruthy(); expect(completed.i).toMatchObject({ total: 2300000, effectiveTotal: 2300000, deposit: 500000, toCollect: 1800000, promotionCode: p.code, nights: 2 });
    const physical = await Room.find({ _id: { $in: rooms.slice(0, 2).map(r => r.id) } });
    expect(physical.every(r => r.status === 'cleaning' && !r.current_booking_id)).toBe(true);
    await patch(admin, '/services/' + service.id, { ...serviceBody(), price: 999999, name: 'Tên sau thanh toán' }).expect(200);
    await patch(admin, '/promotions/' + p.id, { ...promotionBody(p), value: 900000, maxDiscount: 900000 }).expect(200);
    expect(await invoice(completed.i.id)).toEqual(completed.i);
  });
  it('charges at least one actual night, handles early departure and requires admin for a refund', async () => {
    const b = await stay(0, 2000000, 3), q = await preview(b), d = await checkoutData(b);
    expect(q).toMatchObject({ nights: 1, roomTotal: 1200000, deposit: 2000000, toRefund: 800000, toCollect: 0 });
    await post(staff, `/bookings/${b.id}/checkout`, d).expect(403);
    expect((await detail(b)).status).toBe('checked_in'); expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(0);
    const r = await settle(b, '', admin);
    expect(r.i).toMatchObject({ toRefund: 800000, total: 1200000, toCollect: 0 });
    expect(r.b.payments.at(-1)).toMatchObject({ kind: 'refund', direction: 'out', amount: 800000 });
    expect(r.b.payments.reduce((n, p) => n + (p.direction === 'in' ? p.amount : -p.amount), 0)).toBe(1200000);
  });
  it('does not record a zero-value settlement when the deposit covers the entire bill', async () => {
    const r = await settle(await stay(0, 1200000));
    expect(r.i).toMatchObject({ total: 1200000, toCollect: 0, toRefund: 0 });
    expect(r.b.payments).toHaveLength(1); expect(r.b.payments[0].kind).toBe('deposit');
  });
  it('rejects unavailable promotions and totals below their minimum without writing data', async () => {
    const b = await stay();
    const invalid = [await promo({ endsOn: day(-1), startsOn: day(-2) }), await promo({ startsOn: day(1), endsOn: day(2) }), await promo({ status: 'inactive' }), await promo({ minAmount: 9000000 })];
    for (const code of [...invalid.map(p => p.code), 'NOT_FOUND']) await post(staff, `/bookings/${b.id}/checkout-preview`, { promotionCode: code }).expect(409);
    const p = await promo({ startsOn: today, endsOn: today });
    expect((await preview(b, p.code)).discount).toBe(200000);
    expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(0);
  });
  it('revalidates the quote when services, promotions or expiry change', async () => {
    let b = await stay(); const p = await promo(), old = await checkoutData(b, p.code);
    b = await add(b);
    await post(staff, `/bookings/${b.id}/checkout`, old).expect(409);
    const beforePromo = await checkoutData(b, p.code);
    await patch(admin, '/promotions/' + p.id, { ...promotionBody(p), value: 100000 }).expect(200);
    await post(staff, `/bookings/${b.id}/checkout`, beforePromo).expect(409);
    const beforeExpiry = await checkoutData(b, p.code);
    await Promotion.updateOne({ _id: p.id }, { $set: { end_date: new Date(Date.now() - 1000) } });
    await post(staff, `/bookings/${b.id}/checkout`, beforeExpiry).expect(409);
    expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(0);
  });
  it('rejects client totals, mismatched receipts and unverified settlement', async () => {
    const b = await stay(), d = await checkoutData(b);
    for (const extra of [{ total: 1 }, { amount: 1 }, { amount: -1 }, { amount: .5 }, { verified: false }, { quoteToken: 'bad' }]) await post(staff, `/bookings/${b.id}/checkout`, { ...d, ...extra }).expect(400);
    expect((await detail(b)).payments).toHaveLength(1);
  });
  it('deduplicates simultaneous checkouts and rejects a different request after completion', async () => {
    const b = await stay(), d = await checkoutData(b);
    const results = await Promise.all([staff, staff2].map(c => post(c, `/bookings/${b.id}/checkout`, d)));
    expect(results.map(r => r.status)).toEqual([200, 200]); expect(results[0].body.receipt).toEqual(results[1].body.receipt);
    expect(results[0].body.item.invoiceId).toBe(results[1].body.item.invoiceId);
    expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(1);
    expect((await detail(b)).payments.filter(p => p.kind === 'checkout')).toHaveLength(1);
    await post(staff, `/bookings/${b.id}/checkout`, { ...d, requestId: randomUUID() }).expect(409);
    await post(staff, `/bookings/${b.id}/checkout`, { ...d, reference: 'DIFFERENT' }).expect(409);
    await post(admin, `/bookings/${b.id}/checkout`, d).expect(409);
  });
  it('allows only one independent checkout command from concurrent staff', async () => {
    const b = await stay(), d = await checkoutData(b);
    const r = await Promise.all([staff, staff2].map(c => post(c, `/bookings/${b.id}/checkout`, { ...d, requestId: randomUUID() })));
    expect(r.map(r => r.status).sort()).toEqual([200, 409]); expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(1);
  });
  it('serializes a new service with checkout so no charge is silently lost', async () => {
    const b = await stay(), d = await checkoutData(b);
    const [checkout, added] = await Promise.all([post(staff, `/bookings/${b.id}/checkout`, d), post(staff2, `/bookings/${b.id}/services`, { ...command(b), roomId: rooms[0].id, serviceId: service.id, serviceVersion: service.version, quantity: 1 })]);
    expect([checkout.status, added.status].sort()).toEqual([200, 409]);
    if (checkout.status === 200) expect((await invoice(checkout.body.item.invoiceId)).serviceTotal).toBe(0);
    else { expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(0); expect((await preview(await detail(b))).serviceTotal).toBe(100000); }
  });
  it('serializes stay extension with checkout', async () => {
    const b = await stay(), d = await checkoutData(b);
    const results = await Promise.all([post(staff, `/bookings/${b.id}/checkout`, d), post(staff2, `/bookings/${b.id}/extend`, { ...command(b), checkOut: day(2), reason: 'Thử gia hạn đồng thời' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  });
  it.each(['invoice', 'booking'])('rolls back every write if saving the %s fails during checkout', async target => {
    const b = await stay(), p = await promo(), d = await checkoutData(b, p.code);
    const beforeRooms = await Room.find({ _id: { $in: rooms.slice(0, 2).map(r => r.id) } }).sort({ room_number: 1 }).lean();
    const model = target === 'invoice' ? Invoice : Booking;
    const fail = vi.spyOn(model.prototype, 'save').mockRejectedValueOnce(new Error('Simulated week4 persistence failure'));
    try { await post(staff, `/bookings/${b.id}/checkout`, d).expect(500); } finally { fail.mockRestore(); }
    expect(await detail(b)).toEqual(b); expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(0);
    const after = await Room.find({ _id: { $in: rooms.slice(0, 2).map(r => r.id) } }).sort({ room_number: 1 }).lean();
    expect(after).toEqual(beforeRooms); expect((await Promotion.findById(p.id))!.coordination_version).toBe(0);
    await post(staff, `/bookings/${b.id}/checkout`, d).expect(200);
  });
  it('refuses inconsistent physical rooms or ledger balances without partial checkout', async () => {
    const b = await stay(), d = await checkoutData(b);
    await Room.updateOne({ _id: rooms[1].id }, { $set: { status: 'cleaning' } });
    await post(staff, `/bookings/${b.id}/checkout`, d).expect(409);
    expect((await Room.findById(rooms[0].id))!.status).toBe('occupied');
    await Room.updateOne({ _id: rooms[1].id }, { $set: { status: 'occupied' } });
    await Booking.updateOne({ _id: b.id }, { $set: { deposit_amount: 600000 } });
    await post(staff, `/bookings/${b.id}/checkout`, await checkoutData(await detail(b))).expect(409);
    expect(await Invoice.countDocuments({ booking_id: b.id })).toBe(0);
  });
  it('protects completed booking lines and exposes invoice search and local-date filters', async () => {
    const b = await add(await stay()), done = await settle(b);
    await post(staff, `/bookings/${b.id}/services`, { ...command(done.b), roomId: rooms[0].id, serviceId: service.id, serviceVersion: service.version, quantity: 1 }).expect(409);
    await patch(staff, `/bookings/${b.id}/services/${b.services[0].id}`, { ...command(done.b), quantity: 2, voided: false, reason: 'Thử sửa sau hoàn tất' }).expect(409);
    await post(staff, `/bookings/${b.id}/checkout-preview`, {}).expect(409);
    const list = await staff.agent.get('/api/v1/invoices').query({ q: done.i.bookingCode, from: today, to: today, customerId: customer.id, limit: 1 }).expect(200);
    expect(list.body.total).toBe(1); expect(list.body.items[0].id).toBe(done.i.id);
    const excluded = await staff.agent.get('/api/v1/invoices').query({ customerId: customer.id, from: day(1) }).expect(200); expect(excluded.body.total).toBe(0);
    await staff.agent.get('/api/v1/invoices').query({ from: day(1), to: today }).expect(400);
    await staff.agent.get('/api/v1/invoices/bad').expect(400);
    await staff.agent.get('/api/v1/invoices/' + new mongoose.Types.ObjectId()).expect(404);
    await patch(admin, '/invoices/' + done.i.id, { invoice_total: 1 }).expect(404);
  });
  it('keeps original invoice values immutable while recording positive and negative adjustments', async () => {
    const b = await add(await stay()), p = await promo(), d = await checkoutData(b, p.code);
    const settled = await post(staff, `/bookings/${b.id}/checkout`, d).expect(200), original = await invoice(settled.body.item.invoiceId);
    const first = await post(admin, `/invoices/${original.id}/adjustments`, adjustData(original, 150000)).expect(200);
    const second = await post(admin, `/invoices/${original.id}/adjustments`, adjustData(first.body.item, -100000)).expect(200);
    const changed: InvoiceView = second.body.item;
    expect(changed).toMatchObject({ total: 2300000, adjustmentTotal: 50000, effectiveTotal: 2350000, version: 2 });
    for (const key of ['rooms', 'services', 'payments', 'paidAt', 'deposit', 'toCollect', 'discount', 'promotionCode'] as const) expect(changed[key]).toEqual(original[key]);
    const current = await detail(b);
    expect(current.payments.reduce((n, p) => n + (p.direction === 'in' ? p.amount : -p.amount), 0)).toBe(changed.effectiveTotal);
    expect(current.history.at(-1)?.action).toBe('invoice_adjusted');
    const replay = await post(staff, `/bookings/${b.id}/checkout`, d).expect(200);
    expect(replay.body.receipt).toEqual(settled.body.receipt); expect(replay.body.item.version).toBe(current.version);
  });
  it('requires admin, a nonzero bounded adjustment, an explanation and verified money', async () => {
    const { i } = await settle(await stay()), d = adjustData(i);
    await post(staff, `/invoices/${i.id}/adjustments`, d).expect(403);
    for (const extra of [{ amount: 0 }, { amount: .5 }, { amount: -i.total - 1 }, { reason: '' }, { verified: false }, { invoiceTotal: 0 }]) await post(admin, `/invoices/${i.id}/adjustments`, { ...d, ...extra }).expect(400);
    expect((await invoice(i.id)).adjustments).toHaveLength(0);
  });
  it('deduplicates concurrent adjustments and preserves old receipts after later adjustments', async () => {
    const { i } = await settle(await stay()), d = adjustData(i);
    const both = await Promise.all([1, 2].map(() => post(admin, `/invoices/${i.id}/adjustments`, d)));
    expect(both.map(r => r.status)).toEqual([200, 200]); expect(both[0].body.receipt).toEqual(both[1].body.receipt);
    let current = await invoice(i.id); expect(current.adjustments).toHaveLength(1);
    await post(admin, `/invoices/${i.id}/adjustments`, adjustData(current, -50000)).expect(200);
    const retry = await post(admin, `/invoices/${i.id}/adjustments`, d).expect(200);
    expect(retry.body.receipt).toEqual(both[0].body.receipt); expect(retry.body.item.adjustments).toHaveLength(2);
    await post(admin, `/invoices/${i.id}/adjustments`, { ...d, amount: 200000 }).expect(409);
    current = await invoice(i.id);
    const competition = await Promise.all([1, 2].map(() => post(admin, `/invoices/${i.id}/adjustments`, adjustData(current))));
    expect(competition.map(r => r.status).sort()).toEqual([200, 409]);
  });
  it('rolls back adjustment cash and booking history if invoice persistence fails', async () => {
    const { i, b } = await settle(await stay()), d = adjustData(i);
    const fail = vi.spyOn(Invoice.prototype, 'save').mockRejectedValueOnce(new Error('Simulated adjustment failure'));
    try { await post(admin, `/invoices/${i.id}/adjustments`, d).expect(500); } finally { fail.mockRestore(); }
    expect(await invoice(i.id)).toEqual(i); expect(await detail(b)).toEqual(b);
    await post(admin, `/invoices/${i.id}/adjustments`, d).expect(200);
  });
  it('finishes an overdue stay even with a later reservation and still requires cleaning', async () => {
    const old = await stay();
    await Booking.updateOne({ _id: old.id }, { $set: { check_out_plan: new Date(day(-1) + 'T00:00:00+07:00') } });
    let upcoming = await draft(1, [0]);
    const q = (await staff.agent.get(`/api/v1/bookings/${upcoming.id}/confirmation-quote`).expect(200)).body.quote;
    upcoming = (await post(staff, `/bookings/${upcoming.id}/confirm`, { ...command(upcoming), quoteToken: q.token, amount: q.minimumDeposit, method: 'cash' }).expect(200)).body.item;
    const done = await settle(await detail(old)); expect(done.i.nights).toBe(2);
    await post(staff, `/bookings/${upcoming.id}/check-in`, command(upcoming)).expect(409);
    const room = (await staff.agent.get('/api/v1/rooms').query({ q: rooms[0].number }).expect(200)).body.items.find((r: { id: string }) => r.id === rooms[0].id);
    await patch(admin, '/rooms/' + room.id, { number: room.number, floor: room.floor, typeId: room.typeId, status: 'available', active: true, version: room.version }).expect(200);
    await post(staff, `/bookings/${upcoming.id}/check-in`, command(upcoming)).expect(200);
  });
});
