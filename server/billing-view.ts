import type { ClientSession } from 'mongoose';
import { Booking, Invoice, Promotion } from './models.js';
import { bookingView, serviceUsageView } from './booking-view.js';
import { hash, requireStatus, type BookingDoc } from './booking-commands.js';
import { calculateBill } from './billing-math.js';
import { HttpError } from './http.js';
import { hotelDay, nightsBetween } from '../shared/dates.js';
import type { CheckoutQuote, InvoiceView, PromotionView } from '../shared/types.js';

export const promotionView = (p: InstanceType<typeof Promotion>): PromotionView => ({ id: String(p._id), code: p.code, type: p.discount_type, value: p.discount_value, maxDiscount: p.max_discount_amount, minAmount: p.min_booking_amount, startsOn: hotelDay(p.start_date), endsOn: hotelDay(new Date(p.end_date.getTime() - 1)), status: p.status as PromotionView['status'], version: p.version });

export async function checkoutQuote(b: BookingDoc, code: string, at: Date, session: ClientSession, lockPromotion = false) {
  requireStatus(b, ['checked_in']);
  if (!b.actual_check_in || b.actual_check_in > at) throw new HttpError(409, 'Thời điểm nhận phòng không hợp lệ. Liên hệ quản trị viên.');
  if (lockPromotion && code) await Promotion.updateOne({ code }, { $inc: { coordination_version: 1 } }, { session });
  const p = code ? await Promotion.findOne({ code }).session(session) : null;
  if (code && (!p || p.status !== 'active' || at < p.start_date || at >= p.end_date)) throw new HttpError(409, 'Mã khuyến mãi không tồn tại, chưa có hiệu lực, đã hết hạn hoặc ngừng sử dụng.');
  const checkIn = hotelDay(b.actual_check_in), checkOut = hotelDay(at), nights = Math.max(1, nightsBetween(checkIn, checkOut));
  const totals = calculateBill(b.rooms_booked.map(r => r.price_per_night), nights, b.services_used.filter(r => !r.voided).map(r => r.amount), b.deposit_amount,
    p ? { type: p.discount_type, value: p.discount_value, minimum: p.min_booking_amount, cap: p.max_discount_amount } : undefined);
  const view = bookingView(b);
  const data = { ...totals, version: b.version, checkIn, checkOut, nights, promotionCode: code, rooms: view.rooms, services: view.services.filter(s => !s.voided) };
  const quote: CheckoutQuote = { ...data, token: hash({ id: String(b._id), ...data, promotion: p ? { ...promotionView(p), starts: p.start_date.toISOString(), ends: p.end_date.toISOString() } : null }) };
  return { quote, promotion: p };
}

export function invoiceView(i: InstanceType<typeof Invoice>): InvoiceView {
  const adjustmentTotal = i.adjustments.reduce((n, a) => n + (a.amount || 0), 0);
  return { id: String(i._id), code: i.invoice_code, bookingId: String(i.booking_id), bookingCode: i.booking_code || '', customerId: String(i.customer_id),
    customer: { fullName: i.customer_name, phone: i.customer_phone || '', idCard: i.customer_id_card || '' },
    checkIn: i.actual_check_in ? hotelDay(i.actual_check_in) : '', checkOut: i.actual_check_out ? hotelDay(i.actual_check_out) : '', nights: i.nights || 1,
    roomTotal: i.total_room_charge, serviceTotal: i.total_service_charge, subtotal: i.total_room_charge + i.total_service_charge, discount: i.discount_amount,
    total: i.invoice_total, deposit: i.deposit_deducted, toCollect: i.balance_collected, toRefund: i.refund_amount,
    paidAt: i.paid_at.toISOString(), by: i.created_by_name || String(i.created_by), version: i.version, promotionCode: i.promotion_snapshot?.code || '',
    rooms: i.rooms_snapshot.map(r => ({ roomId: String(r.room_id), number: r.room_number, typeId: String(r.room_type_id), typeName: r.room_type_name, price: r.price_per_night, guestCount: r.guest_count })),
    services: i.services_snapshot.map(serviceUsageView),
    payments: i.payments_snapshot.map(p => ({ id: String(p._id), kind: p.kind, amount: p.amount, direction: p.direction, method: p.method, reference: p.reference || '', at: p.recorded_at.toISOString(), by: p.recorded_by_name || String(p.recorded_by), reason: p.reason || '' })),
    adjustmentTotal, effectiveTotal: i.invoice_total + adjustmentTotal,
    adjustments: i.adjustments.map(a => ({ id: String(a._id), amount: a.amount || 0, reason: a.reason || '', at: a.approved_at?.toISOString() || '', by: a.approved_by_name || String(a.approved_by), method: a.method || 'cash', reference: a.reference || '' })),
  };
}
