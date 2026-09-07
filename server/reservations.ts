import { Router } from 'express';
import { type ClientSession } from 'mongoose';
import { z } from 'zod';
import { Booking, Customer, Room, RoomType, User } from './models.js';
import { HttpError, validId } from './http.js';
import { bookingView } from './booking-view.js';
import { assertCalendar } from './scheduling.js';
import { command, reason, payment, hash, roomIds, requireStatus, runCommand, lockBookingRooms, type BookingDoc, type Actor } from './booking-commands.js';
import { hotelDay, nightsBetween, validCalendarDate } from '../shared/dates.js';
import { config } from './config.js';
import type { ConfirmationQuote } from '../shared/types.js';

const calendarDate = z.string().refine(validCalendarDate, 'Ngày không hợp lệ.');
const startOfDay = (s: string) => new Date(s + 'T00:00:00+07:00');
function validateDates(checkIn: string, checkOut: string, future = true) {
  if (!validCalendarDate(checkIn) || !validCalendarDate(checkOut) || checkOut <= checkIn || nightsBetween(checkIn, checkOut) > 365) throw new HttpError(400, 'Ngày trả phải sau ngày nhận; tối đa 365 đêm.');
  if (future && checkIn < hotelDay(new Date())) throw new HttpError(400, 'Ngày nhận không được ở quá khứ. Hãy đổi lịch trước.');
}
async function quote(b: BookingDoc, session?: ClientSession): Promise<ConfirmationQuote> {
  requireStatus(b, ['pending']);
  const checkIn = hotelDay(b.check_in_plan), checkOut = hotelDay(b.check_out_plan);
  validateDates(checkIn, checkOut);
  const customer = await Customer.findById(b.customer_id).session(session || null);
  if (!customer || customer.status === 'inactive') throw new HttpError(409, 'Khách hàng đã ngừng sử dụng hoặc không tồn tại.');
  const available = await assertCalendar(roomIds(b), b.check_in_plan, b.check_out_plan, String(b._id), session);
  const types = await RoomType.find({ _id: { $in: available.map(r => r.room_type_id) }, status: 'active' }).session(session || null);
  const rooms = b.rooms_booked.map(line => {
    const r = available.find(r => r._id.equals(line.room_id))!;
    const t = types.find(t => t._id.equals(r.room_type_id));
    if (!t || line.guest_count > t.max_occupancy) throw new HttpError(409, `Loại phòng hoặc sức chứa phòng ${r.room_number} đã thay đổi. Hãy sửa phiếu nháp.`);
    return { roomId: String(r._id), number: r.room_number, typeId: String(t._id), typeName: t.name, price: t.base_price_per_night, guestCount: line.guest_count };
  });
  const nights = nightsBetween(checkIn, checkOut), total = rooms.reduce((n, r) => n + r.price * nights, 0);
  const data = { rooms, customer: { fullName: customer.full_name, phone: customer.phone, idCard: customer.id_card }, total, minimumDeposit: Math.ceil(total * config.depositPercent / 100), depositPercent: config.depositPercent, nights };
  return { ...data, token: hash({ id: String(b._id), version: b.version, checkIn, checkOut, ...data }) };
}
function addPayment(b: BookingDoc, actor: Actor, requestId: string, data: { method: 'cash' | 'transfer' | 'card'; reference: string }, amount: number, kind: 'deposit' | 'refund', at: Date, note: string) {
  if (amount === 0) return;
  b.payments.push({ request_id: requestId, kind, amount, direction: kind === 'refund' ? 'out' : 'in', method: data.method as 'cash' | 'transfer' | 'card', reference: String(data.reference || ''), recorded_at: at, recorded_by: actor._id, recorded_by_name: actor.full_name, reason: note });
  b.deposit_amount += kind === 'refund' ? -amount : amount;
}
export function reservationsRouter() {
  const router = Router();
  router.get('/bookings/:id/confirmation-quote', async (req, res) => {
    const b = await Booking.findById(validId(req.params.id));
    if (!b) throw new HttpError(404, 'Không tìm thấy phiếu đặt phòng.');
    res.json({ quote: await quote(b) });
  });
  router.post('/bookings/:id/confirm', async (req, res) => {
    const d = command.extend({ ...payment, quoteToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body), actor: Actor = res.locals.user;
    res.json(await runCommand(validId(req.params.id), 'confirmed', d, actor, async (b, session, at) => {
      requireStatus(b, ['pending']);
      await Customer.updateOne({ _id: b.customer_id }, { $inc: { coordination_version: 1 } }, { session });
      await lockBookingRooms(b, session);
      const current = await quote(b, session);
      if (current.token !== d.quoteToken) throw new HttpError(409, 'Báo giá hoặc thông tin khách vừa thay đổi. Đóng biểu mẫu và xem lại báo giá trước khi thu cọc.');
      if (d.amount < current.minimumDeposit || d.amount > current.total) throw new HttpError(400, `Cọc cần từ ${current.minimumDeposit.toLocaleString('vi-VN')} đến ${current.total.toLocaleString('vi-VN')} đồng.`);
      b.set({ customer_snapshot: { full_name: current.customer.fullName, phone: current.customer.phone, id_card: current.customer.idCard }, rooms_booked: current.rooms.map(r => ({ room_id: r.roomId, room_number: r.number, room_type_id: r.typeId, room_type_name: r.typeName, price_per_night: r.price, guest_count: r.guestCount })) });
      b.status = 'confirmed'; b.confirmed_at = at;
      addPayment(b, actor, d.requestId, d, d.amount, 'deposit', at, 'Cọc khi xác nhận đặt phòng');
      return { reason: 'Chốt giá, giữ lịch toàn bộ phòng và ghi nhận cọc.', amount: d.amount };
    }));
  });
  router.post('/bookings/:id/deposits', async (req, res) => {
    const d = command.extend(payment).strict().parse(req.body), actor: Actor = res.locals.user;
    res.json(await runCommand(validId(req.params.id), 'deposit_received', d, actor, async (b, _session, at) => {
      requireStatus(b, ['confirmed']);
      if (d.amount <= 0 || b.deposit_amount + d.amount > bookingView(b).estimatedTotal) throw new HttpError(400, 'Cọc bổ sung phải dương và tổng cọc không vượt tiền phòng.');
      addPayment(b, actor, d.requestId, d, d.amount, 'deposit', at, 'Thu thêm tiền cọc');
      return { reason: 'Ghi nhận cọc bổ sung.', amount: d.amount };
    }));
  });
  router.post('/bookings/:id/cancel', async (req, res) => {
    const d = command.extend({ reason }).strict().parse(req.body);
    res.json(await runCommand(validId(req.params.id), 'cancelled', d, res.locals.user, async (b, session) => {
      requireStatus(b, ['pending', 'confirmed']);
      if (b.status === 'confirmed') await lockBookingRooms(b, session);
      b.status = 'cancelled'; b.refund_status = b.deposit_amount > 0 ? 'pending' : 'none';
      return { reason: d.reason + (b.deposit_amount ? ' — Chờ quản trị viên xác nhận hoàn toàn bộ cọc.' : '') };
    }));
  });
  router.post('/bookings/:id/refunds', async (req, res) => {
    const actor: Actor = res.locals.user;
    if (actor.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên được duyệt và ghi nhận hoàn cọc.');
    const d = command.extend({ method: payment.method, reference: payment.reference, reason }).strict().parse(req.body);
    res.json(await runCommand(validId(req.params.id), 'refunded', d, actor, async (b, _session, at) => {
      requireStatus(b, ['cancelled']);
      if (b.refund_status !== 'pending' || b.deposit_amount <= 0) throw new HttpError(409, 'Phiếu không còn khoản cọc chờ hoàn.');
      const amount = b.deposit_amount;
      addPayment(b, actor, d.requestId, d, amount, 'refund', at, d.reason);
      b.refund_status = 'refunded';
      return { reason: d.reason, amount };
    }));
  });
  router.post('/bookings/:id/check-in', async (req, res) => {
    const d = command.strict().parse(req.body);
    res.json(await runCommand(validId(req.params.id), 'checked_in', d, res.locals.user, async (b, session, at) => {
      requireStatus(b, ['confirmed']);
      if (hotelDay(at) !== hotelDay(b.check_in_plan)) throw new HttpError(409, 'Chỉ nhận phòng trong đúng ngày nhận dự kiến. Hãy đổi lịch trước nếu khách đến ngày khác.');
      await lockBookingRooms(b, session);
      const rooms = await assertCalendar(roomIds(b), b.check_in_plan, b.check_out_plan, String(b._id), session);
      if (rooms.some(r => r.status !== 'available' || r.current_booking_id)) throw new HttpError(409, 'Tất cả phòng phải sẵn sàng, đã dọn xong và không còn khách cũ.');
      await Room.updateMany({ _id: { $in: roomIds(b) } }, { $set: { status: 'occupied', current_booking_id: b._id }, $inc: { version: 1 } }, { session });
      b.status = 'checked_in'; b.actual_check_in = at;
      return { reason: 'Đã kiểm tra khách và giao đồng thời toàn bộ phòng.' };
    }));
  });
  router.post('/bookings/:id/extend', async (req, res) => {
    const d = command.extend({ checkOut: calendarDate, reason }).strict().parse(req.body);
    res.json(await runCommand(validId(req.params.id), 'extended', d, res.locals.user, async (b, session) => {
      requireStatus(b, ['checked_in']);
      validateDates(hotelDay(b.check_in_plan), d.checkOut, false);
      if (d.checkOut <= hotelDay(b.check_out_plan) || d.checkOut <= hotelDay(new Date())) throw new HttpError(400, 'Ngày trả mới phải sau ngày trả cũ và sau hôm nay.');
      await lockBookingRooms(b, session);
      const rooms = await assertCalendar(roomIds(b), b.check_in_plan, startOfDay(d.checkOut), String(b._id), session);
      if (rooms.some(r => r.status !== 'occupied' || String(r.current_booking_id) !== String(b._id))) throw new HttpError(409, 'Trạng thái phòng không khớp lượt lưu trú. Liên hệ quản trị viên.');
      const before = hotelDay(b.check_out_plan); b.check_out_plan = startOfDay(d.checkOut);
      return { reason: `${before} → ${d.checkOut}. ${d.reason}. Giữ đơn giá đã chốt.` };
    }));
  });
  router.post('/bookings/:id/reschedule', async (req, res) => {
    const d = command.extend({ checkIn: calendarDate, checkOut: calendarDate, reason }).strict().parse(req.body);
    res.json(await runCommand(validId(req.params.id), 'rescheduled', d, res.locals.user, async (b, session) => {
      requireStatus(b, ['confirmed']); validateDates(d.checkIn, d.checkOut);
      const total = b.rooms_booked.reduce((n, r) => n + r.price_per_night * nightsBetween(d.checkIn, d.checkOut), 0);
      if (b.deposit_amount > total) throw new HttpError(409, 'Cọc vượt tiền phòng của lịch mới. Hãy xử lý hủy/hoàn và lập phiếu mới.');
      if (b.deposit_amount < Math.ceil(total * config.depositPercent / 100)) throw new HttpError(409, 'Cọc chưa đủ cho lịch mới. Thu cọc bổ sung trước hoặc lập phiếu mới.');
      if (d.checkIn === hotelDay(b.check_in_plan) && d.checkOut === hotelDay(b.check_out_plan)) throw new HttpError(400, 'Lịch mới không thay đổi.');
      await lockBookingRooms(b, session);
      await assertCalendar(roomIds(b), startOfDay(d.checkIn), startOfDay(d.checkOut), String(b._id), session);
      const before = `${hotelDay(b.check_in_plan)} → ${hotelDay(b.check_out_plan)}`;
      b.check_in_plan = startOfDay(d.checkIn); b.check_out_plan = startOfDay(d.checkOut);
      return { reason: `${before} thành ${d.checkIn} → ${d.checkOut}. ${d.reason}. Giữ đơn giá đã chốt.` };
    }));
  });
  return router;
}
