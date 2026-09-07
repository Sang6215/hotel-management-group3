import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Booking, Invoice, Promotion, Room, Service } from './models.js';
import { adminOnly, checkVersion, HttpError, validId } from './http.js';
import { command, hash, lockBookingRooms, payment, reason, requireStatus, roomIds, runCommand, type Actor, type BookingDoc } from './booking-commands.js';
import { checkedMoney, MAX_MONEY } from './billing-math.js';
import { checkoutQuote, invoiceView, promotionView } from './billing-view.js';
import { transaction } from './scheduling.js';
import { hotelDay, nextDay, validCalendarDate } from '../shared/dates.js';
import type { PaymentMethod } from '../shared/types.js';

const id = z.string().regex(/^[a-f0-9]{24}$/i, 'Mã dữ liệu không hợp lệ.');
const version = z.number().int().min(0);
const quantity = z.number().int().min(1).max(1000);
const date = z.string().refine(validCalendarDate, 'Ngày không hợp lệ.');
const code = z.string().trim().toUpperCase().min(1).max(30).regex(/^[A-Z0-9_-]+$/, 'Mã chỉ gồm chữ, số, gạch ngang hoặc gạch dưới.');
const promoCode = z.union([code, z.literal('')]).default('');
const amount = z.number().int().min(0).max(MAX_MONEY);
const promotionInput = z.object({ code, type: z.enum(['percentage', 'fixed']), value: amount.min(1), maxDiscount: amount.min(1), minAmount: amount, startsOn: date, endsOn: date, status: z.enum(['active', 'inactive']) }).strict();
const paging = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(200).default(20), q: z.string().trim().max(100).default('') });
const escapeSearch = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
function promotionData(d: z.infer<typeof promotionInput>) {
  if (d.endsOn < d.startsOn) throw new HttpError(400, 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  if (d.type === 'percentage' && d.value > 100) throw new HttpError(400, 'Phần trăm giảm không vượt 100.');
  return { code: d.code, discount_type: d.type, discount_value: d.value, max_discount_amount: d.maxDiscount, min_booking_amount: d.minAmount, start_date: new Date(d.startsOn + 'T00:00:00+07:00'), end_date: new Date(nextDay(d.endsOn) + 'T00:00:00+07:00'), status: d.status };
}
function requireAdmin(actor: Actor) {
  if (actor.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên được xác nhận hoàn tiền hoặc điều chỉnh hóa đơn.');
}
function recordSettlement(b: BookingDoc, actor: Actor, requestId: string, signedAmount: number, kind: 'checkout' | 'refund' | 'adjustment', d: { method: PaymentMethod; reference: string }, at: Date, note: string) {
  if (!signedAmount) return;
  checkedMoney(Math.abs(signedAmount));
  b.payments.push({ request_id: requestId, kind, amount: Math.abs(signedAmount), direction: signedAmount < 0 ? 'out' : 'in', method: d.method, reference: d.reference, recorded_at: at, recorded_by: actor._id, recorded_by_name: actor.full_name, reason: note });
}

export function billingRouter() {
  const router = Router();
  router.get('/promotions', async (req, res) => {
    const d = paging.extend({ status: z.enum(['active', 'inactive', 'all']).default('all') }).parse(req.query);
    const filter = { ...(d.q ? { code: escapeSearch(d.q) } : {}), ...(d.status !== 'all' ? { status: d.status } : {}) };
    const [items, total] = await Promise.all([Promotion.find(filter).sort({ created_at: -1, _id: -1 }).skip((d.page - 1) * d.limit).limit(d.limit), Promotion.countDocuments(filter)]);
    res.json({ items: items.map(promotionView), total, page: d.page, limit: d.limit });
  });
  router.post('/promotions', adminOnly, async (req, res) => {
    const item = await Promotion.create(promotionData(promotionInput.parse(req.body)));
    res.status(201).json({ item: promotionView(item) });
  });
  router.patch('/promotions/:id', adminOnly, async (req, res) => {
    const d = promotionInput.extend({ version }).parse(req.body), pid = validId(req.params.id);
    const item = await Promotion.findById(pid);
    if (!item) throw new HttpError(404, 'Không tìm thấy khuyến mãi.');
    checkVersion(item, d.version); item.set(promotionData(d));
    await item.save(); res.json({ item: promotionView(item) });
  });

  router.post('/bookings/:id/services', async (req, res) => {
    const d = command.extend({ roomId: id, serviceId: id, serviceVersion: version, quantity }).strict().parse(req.body), actor: Actor = res.locals.user;
    res.json(await runCommand(validId(req.params.id), 'service_added', d, actor, async (b, session, at) => {
      requireStatus(b, ['checked_in']);
      if (b.services_used.length >= 500) throw new HttpError(409, 'Phiếu đã đạt giới hạn 500 dòng dịch vụ.');
      const room = b.rooms_booked.find(r => String(r.room_id) === d.roomId);
      if (!room) throw new HttpError(400, 'Phòng phải thuộc lượt lưu trú này.');
      await Service.updateOne({ _id: d.serviceId }, { $inc: { coordination_version: 1 } }, { session });
      const s = await Service.findById(d.serviceId).session(session);
      if (!s || s.status !== 'active') throw new HttpError(409, 'Dịch vụ không tồn tại hoặc đã ngừng sử dụng.');
      checkVersion(s, d.serviceVersion);
      const charge = checkedMoney(s.unit_price * d.quantity);
      checkedMoney(b.services_used.filter(r => !r.voided).reduce((n, r) => n + r.amount, charge));
      b.services_used.push({ service_id: s._id, room_id: room.room_id, room_number: room.room_number, service_name: s.name, service_code: s.service_code, unit: s.unit, quantity: d.quantity, unit_price: s.unit_price, amount: charge, used_at: at, created_by: actor._id, created_by_name: actor.full_name, voided: false });
      return { reason: `Phòng ${room.room_number}: ${s.name}, ${d.quantity} ${s.unit}, đơn giá ${s.unit_price.toLocaleString('vi-VN')}đ.`, amount: charge };
    }));
  });
  router.patch('/bookings/:id/services/:lineId', async (req, res) => {
    const lineId = validId(req.params.lineId), d = command.extend({ quantity, voided: z.boolean(), reason }).strict().parse(req.body);
    // Bind the route line ID into the idempotency fingerprint as well as the body.
    res.json(await runCommand(validId(req.params.id), 'service_corrected', { ...d, lineId }, res.locals.user, async b => {
      requireStatus(b, ['checked_in']);
      const line = b.services_used.id(lineId);
      if (!line) throw new HttpError(404, 'Không tìm thấy dòng dịch vụ.');
      if (line.voided) throw new HttpError(409, 'Dòng dịch vụ đã hủy; hãy tạo dòng mới nếu khách sử dụng lại.');
      if (!d.voided && d.quantity === line.quantity) throw new HttpError(400, 'Số lượng không thay đổi.');
      const before = line.quantity;
      const nextAmount = checkedMoney(line.unit_price * d.quantity);
      checkedMoney(b.services_used.filter(r => !r.voided && String(r._id) !== lineId).reduce((n, r) => n + r.amount, d.voided ? 0 : nextAmount));
      if (!d.voided) { line.quantity = d.quantity; line.amount = nextAmount; }
      line.voided = d.voided; line.void_reason = d.reason;
      return { reason: `Phòng ${line.room_number || ''}, ${line.service_name}: ${d.voided ? `hủy dòng ${before} ${line.unit || ''}` : `số lượng ${before} → ${d.quantity}, giữ đơn giá`}. ${d.reason}` };
    }));
  });

  router.post('/bookings/:id/checkout-preview', async (req, res) => {
    const d = z.object({ promotionCode: promoCode }).strict().parse(req.body), bid = validId(req.params.id);
    res.json(await transaction(async session => {
      const b = await Booking.findById(bid).session(session);
      if (!b) throw new HttpError(404, 'Không tìm thấy phiếu đặt phòng.');
      return { quote: (await checkoutQuote(b, d.promotionCode, new Date(), session)).quote };
    }));
  });
  router.post('/bookings/:id/checkout', async (req, res) => {
    const d = command.extend({ promotionCode: promoCode, quoteToken: z.string().regex(/^[a-f0-9]{64}$/), ...payment, verified: z.literal(true) }).strict().parse(req.body), actor: Actor = res.locals.user;
    res.json(await runCommand(validId(req.params.id), 'checked_out', d, actor, async (b, session, at) => {
      requireStatus(b, ['checked_in']);
      await lockBookingRooms(b, session);
      const { quote: q, promotion: p } = await checkoutQuote(b, d.promotionCode, at, session, true);
      if (q.token !== d.quoteToken) throw new HttpError(409, 'Bảng tính phí đã thay đổi. Hãy xem lại trước khi xác nhận thu hoặc hoàn tiền.');
      if (q.toRefund) requireAdmin(actor);
      if (d.amount !== Math.max(q.toCollect, q.toRefund)) throw new HttpError(400, 'Số tiền xác nhận không khớp khoản cần thu hoặc hoàn trên bảng tính phí.');
      const rooms = await Room.find({ _id: { $in: roomIds(b) } }).session(session);
      if (rooms.some(r => r.status !== 'occupied' || String(r.current_booking_id) !== String(b._id))) throw new HttpError(409, 'Trạng thái phòng không khớp lượt lưu trú. Liên hệ quản trị viên.');
      const signed = q.toCollect - q.toRefund;
      recordSettlement(b, actor, d.requestId, signed, q.toRefund ? 'refund' : 'checkout', d, at, q.toRefund ? 'Hoàn tiền dư khi trả phòng' : 'Thu tiền còn lại khi trả phòng');
      const net = b.payments.reduce((n, r) => n + (r.direction === 'in' ? r.amount : -r.amount), 0);
      if (net !== q.total) throw new HttpError(409, 'Sổ thu/hoàn không khớp số tiền hóa đơn. Cần kiểm tra dữ liệu trước khi hoàn tất.');
      const invoice = new Invoice({ invoice_code: `HD-${hotelDay(at).replaceAll('-', '')}-${randomUUID().slice(0, 12).toUpperCase()}`, booking_id: b._id, booking_code: b.booking_code,
        customer_id: b.customer_id, customer_name: b.customer_snapshot!.full_name, customer_phone: b.customer_snapshot!.phone, customer_id_card: b.customer_snapshot!.id_card,
        actual_check_in: b.actual_check_in, actual_check_out: at, nights: q.nights, rooms_snapshot: b.rooms_booked.map(r => r.toObject()), services_snapshot: b.services_used.filter(r => !r.voided).map(r => r.toObject()),
        total_room_charge: q.roomTotal, total_service_charge: q.serviceTotal, discount_amount: q.discount, deposit_deducted: q.deposit, invoice_total: q.total, balance_collected: q.toCollect, refund_amount: q.toRefund,
        promotion_snapshot: p ? { code: p.code, discount_type: p.discount_type, discount_value: p.discount_value, min_booking_amount: p.min_booking_amount, max_discount_amount: p.max_discount_amount, start_date: p.start_date, end_date: p.end_date } : undefined,
        paid_at: at, created_by: actor._id, created_by_name: actor.full_name, payments_snapshot: b.payments.map(r => r.toObject()), adjustments: [] });
      await invoice.save({ session });
      await Room.updateMany({ _id: { $in: roomIds(b) } }, { $set: { status: 'cleaning' }, $unset: { current_booking_id: 1 }, $inc: { version: 1 } }, { session });
      b.status = 'completed'; b.actual_check_out = at; b.invoice_id = invoice._id; b.deposit_amount = 0; b.refund_status = 'none';
      return { reason: `Hoàn tất ${q.nights} đêm; hóa đơn ${invoice.invoice_code}, tổng ${q.total.toLocaleString('vi-VN')}đ. Chuyển toàn bộ phòng sang đang dọn.`, amount: signed };
    }));
  });

  router.get('/invoices', async (req, res) => {
    const d = paging.extend({ from: date.optional(), to: date.optional(), customerId: id.optional() }).parse(req.query);
    if (d.from && d.to && d.to < d.from) throw new HttpError(400, 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
    const filter = { ...(d.q ? { $or: [{ invoice_code: escapeSearch(d.q) }, { customer_name: escapeSearch(d.q) }, { booking_code: escapeSearch(d.q) }] } : {}), ...(d.customerId ? { customer_id: d.customerId } : {}),
      ...(d.from || d.to ? { paid_at: { ...(d.from ? { $gte: new Date(d.from + 'T00:00:00+07:00') } : {}), ...(d.to ? { $lt: new Date(nextDay(d.to) + 'T00:00:00+07:00') } : {}) } } : {}) };
    const [items, total] = await Promise.all([Invoice.find(filter).sort({ paid_at: -1, _id: -1 }).skip((d.page - 1) * d.limit).limit(d.limit), Invoice.countDocuments(filter)]);
    res.json({ items: items.map(invoiceView), total, page: d.page, limit: d.limit });
  });
  router.get('/invoices/:id', async (req, res) => {
    const i = await Invoice.findById(validId(req.params.id));
    if (!i) throw new HttpError(404, 'Không tìm thấy hóa đơn.');
    res.json({ item: invoiceView(i) });
  });
  router.post('/invoices/:id/adjustments', async (req, res) => {
    const actor: Actor = res.locals.user; requireAdmin(actor);
    const iid = validId(req.params.id), d = command.extend({ amount: z.number().int().min(-MAX_MONEY).max(MAX_MONEY).refine(n => n !== 0, 'Chênh lệch phải khác 0.'), method: payment.method, reference: payment.reference, reason, verified: z.literal(true) }).strict().parse(req.body);
    const payloadHash = hash({ invoiceId: iid, data: d, actor: String(actor._id) });
    res.json(await transaction(async session => {
      const i = await Invoice.findById(iid).session(session);
      if (!i) throw new HttpError(404, 'Không tìm thấy hóa đơn.');
      const old = i.adjustments.find(a => a.request_id === d.requestId);
      if (old) {
        if (old.payload_hash !== payloadHash) throw new HttpError(409, 'Mã yêu cầu đã dùng cho nội dung khác.');
        return { item: invoiceView(i), receipt: { requestId: d.requestId, action: 'invoice_adjusted', amount: old.amount, at: old.approved_at!.toISOString(), version: old.resulting_version } };
      }
      checkVersion(i, d.version);
      if (i.adjustments.length >= 500) throw new HttpError(409, 'Hóa đơn đã đạt giới hạn 500 điều chỉnh.');
      const effectiveTotal = checkedMoney(invoiceView(i).effectiveTotal + d.amount);
      const b = await Booking.findById(i.booking_id).session(session);
      if (!b || b.status !== 'completed' || String(b.invoice_id) !== iid) throw new HttpError(409, 'Hóa đơn không khớp phiếu đã hoàn tất.');
      const at = new Date();
      recordSettlement(b, actor, d.requestId, d.amount, 'adjustment', d, at, d.reason);
      const net = b.payments.reduce((n, r) => n + (r.direction === 'in' ? r.amount : -r.amount), 0);
      if (net !== effectiveTotal) throw new HttpError(409, 'Sổ thu/hoàn không khớp giá trị hóa đơn.');
      i.adjustments.push({ request_id: d.requestId, payload_hash: payloadHash, resulting_version: i.version + 1, amount: d.amount, reason: d.reason, approved_at: at, approved_by: actor._id, approved_by_name: actor.full_name, method: d.method, reference: d.reference });
      b.history.push({ action: 'invoice_adjusted', from: b.status, to: b.status, reason: `${i.invoice_code}: ${d.amount > 0 ? '+' : ''}${d.amount.toLocaleString('vi-VN')}đ. ${d.reason}`, at, by: actor._id, by_name: actor.full_name });
      await b.save({ session }); await i.save({ session });
      return { item: invoiceView(i), receipt: { requestId: d.requestId, action: 'invoice_adjusted', amount: d.amount, at: at.toISOString(), version: i.version } };
    }));
  });
  return router;
}
