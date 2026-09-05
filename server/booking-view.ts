import { Booking } from './models.js';
import { config } from './config.js';
import { hotelDay, nightsBetween } from '../shared/dates.js';
import type { BookingView } from '../shared/types.js';

export function bookingView(d: InstanceType<typeof Booking>): BookingView {
  const checkIn = hotelDay(d.check_in_plan), checkOut = hotelDay(d.check_out_plan), nights = nightsBetween(checkIn, checkOut);
  return { id: String(d._id), code: d.booking_code, customerId: String(d.customer_id), customer: { fullName: d.customer_snapshot!.full_name, phone: d.customer_snapshot!.phone, idCard: d.customer_snapshot!.id_card },
    rooms: d.rooms_booked.map(r => ({ roomId: String(r.room_id), number: r.room_number, typeId: String(r.room_type_id), typeName: r.room_type_name, price: r.price_per_night, guestCount: r.guest_count })),
    checkIn, checkOut, nights, totalGuests: d.rooms_booked.reduce((n, r) => n + r.guest_count, 0), estimatedTotal: d.rooms_booked.reduce((n, r) => n + r.price_per_night * nights, 0),
    deposit: d.deposit_amount, depositPercent: config.depositPercent, refundedTotal: d.payments.filter(p => p.kind === 'refund').reduce((n, p) => n + p.amount, 0),
    refundStatus: d.refund_status || 'none', actualCheckIn: d.actual_check_in?.toISOString() || '', confirmedAt: d.confirmed_at?.toISOString() || '',
    status: d.status as BookingView['status'], note: d.note || '', version: d.version, createdAt: d.created_at.toISOString(),
    payments: d.payments.map(p => ({ id: String(p._id), kind: p.kind, amount: p.amount, direction: p.direction, method: p.method, reference: p.reference || '', at: p.recorded_at.toISOString(), by: p.recorded_by_name || String(p.recorded_by), reason: p.reason || '' })),
    history: d.history.map(h => ({ action: h.action || '', at: h.at?.toISOString() || '', reason: h.reason || '', by: h.by_name || (h.by ? String(h.by) : '') })) };
}
