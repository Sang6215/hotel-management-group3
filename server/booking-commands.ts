import { createHash } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import { Booking, Room, User } from './models.js';
import { checkVersion, HttpError } from './http.js';
import { bookingView } from './booking-view.js';
import { lockRooms, lockTypes, transaction } from './scheduling.js';

export type BookingDoc = InstanceType<typeof Booking>;
export type Actor = InstanceType<typeof User>;
export const command = z.object({ requestId: z.string().uuid('Mã yêu cầu không hợp lệ.'), version: z.number().int().min(0) });
export const reason = z.string().trim().min(3, 'Nhập lý do ít nhất 3 ký tự.').max(500);
export const payment = { amount: z.number().int().min(0).max(20_000_000_000_000), method: z.enum(['cash', 'transfer', 'card']), reference: z.string().trim().max(100).default('') };
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const roomIds = (b: BookingDoc) => b.rooms_booked.map(r => String(r.room_id));
export function requireStatus(b: BookingDoc, statuses: string[]) {
  if (!statuses.includes(b.status)) throw new HttpError(409, 'Trạng thái phiếu không cho phép thao tác này. Hãy tải lại phiếu.');
}
export async function lockBookingRooms(b: BookingDoc, session: ClientSession) {
  const rooms = await Room.find({ _id: { $in: roomIds(b) } }).session(session);
  await lockTypes(rooms.map(r => String(r.room_type_id)), session);
  await lockRooms(roomIds(b), session);
}

// The booking is the shared write point for every service, stay and settlement command.
// Retry receipts remain immutable even when the returned booking has moved on.
export async function runCommand<T extends z.infer<typeof command>>(id: string, action: string, data: T, actor: Actor, work: (b: BookingDoc, session: ClientSession, at: Date) => Promise<{ reason: string; amount?: number }>) {
  const payloadHash = hash({ action, data, actor: String(actor._id) });
  return transaction(async session => {
    const b = await Booking.findById(id).session(session);
    if (!b) throw new HttpError(404, 'Không tìm thấy phiếu đặt phòng.');
    const old = b.commands.find(c => c.request_id === data.requestId);
    if (old) {
      if (old.payload_hash !== payloadHash) throw new HttpError(409, 'Mã yêu cầu đã dùng cho nội dung khác. Hãy tải lại phiếu.');
      return { item: bookingView(b), receipt: { requestId: old.request_id, action: old.action, at: old.at!.toISOString(), version: old.resulting_version, amount: old.amount || 0 } };
    }
    checkVersion(b, data.version);
    if (b.commands.length >= 1000) throw new HttpError(409, 'Phiếu đã đạt giới hạn 1.000 thao tác; liên hệ quản trị viên.');
    const from = b.status, at = new Date();
    const result = await work(b, session, at);
    b.history.push({ action, from, to: b.status, reason: result.reason, at, by: actor._id, by_name: actor.full_name });
    b.commands.push({ request_id: data.requestId, payload_hash: payloadHash, action, at, resulting_version: b.version + 1, amount: result.amount || 0 });
    await b.save({ session });
    return { item: bookingView(b), receipt: { requestId: data.requestId, action, at: at.toISOString(), version: b.version, amount: result.amount || 0 } };
  });
}
