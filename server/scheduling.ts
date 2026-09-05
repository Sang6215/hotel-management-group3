import mongoose, { type ClientSession } from 'mongoose';
import { Booking, Room, RoomType } from './models.js';
import { HttpError } from './http.js';

export async function transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(work, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000 });
}

// Every writer of a room's calendar or type uses these same documents. A snapshot
// read alone would allow two different bookings to reserve the same room.
export async function lockTypes(ids: string[], session: ClientSession) {
  for (const id of [...new Set(ids)].sort()) {
    await RoomType.updateOne({ _id: id }, { $inc: { coordination_version: 1 } }, { session });
  }
}
export async function lockRooms(ids: string[], session: ClientSession) {
  for (const id of [...new Set(ids)].sort()) {
    const r = await Room.updateOne({ _id: id }, { $inc: { schedule_version: 1 } }, { session });
    if (!r.matchedCount) throw new HttpError(409, 'Phòng không còn tồn tại. Vui lòng tải lại phiếu.');
  }
}
export async function assertCalendar(roomIds: string[], start: Date, end: Date, exclude: string, session?: ClientSession) {
  const blocked = await Booking.exists({ _id: { $ne: exclude }, 'rooms_booked.room_id': { $in: roomIds }, status: { $in: ['confirmed', 'checked_in'] }, check_in_plan: { $lt: end }, check_out_plan: { $gt: start } }).session(session || null);
  if (blocked) throw new HttpError(409, 'Phòng đã có lượt đặt trùng lịch. Vui lòng chọn phòng hoặc ngày khác.');
  const rooms = await Room.find({ _id: { $in: roomIds } }).session(session || null);
  if (rooms.length !== roomIds.length || rooms.some(r => !r.active || r.status === 'maintenance' || r.unavailable_periods.some(p => p.start < end && (!p.end || p.end > start)))) {
    throw new HttpError(409, 'Phòng ngừng phục vụ hoặc có lịch bảo trì trong khoảng đã chọn.');
  }
  return rooms;
}
