import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Booking, Customer, Room, RoomType, Service, recordRoomInventory } from './models.js';
import { adminOnly, checkVersion, HttpError, validId } from './http.js';
import { hotelDay, nightsBetween, validCalendarDate } from '../shared/dates.js';
import type { CustomerView, RoomTypeView, RoomView, ServiceView } from '../shared/types.js';
import { bookingView } from './booking-view.js';
import { lockRooms, lockTypes, transaction } from './scheduling.js';

const text = (max = 100) => z.string().trim().min(1, 'Vui lòng nhập trường này.').max(max, `Tối đa ${max} ký tự.`);
const optionalText = (max = 200) => z.string().trim().max(max).default('');
const money = z.number().int('Số tiền phải là số nguyên.').min(0, 'Số tiền không được âm.').max(1_000_000_000, 'Số tiền tối đa 1 tỷ đồng.');
const capacity = z.number().int().min(1, 'Cần ít nhất 1 khách.').max(100, 'Tối đa 100 khách/phòng.');
const id = z.string().regex(/^[a-f0-9]{24}$/i, 'Mã dữ liệu không hợp lệ.');
const version = z.number().int().min(0);
const status = z.enum(['active', 'inactive']);
const code = text(30).transform(s => s.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9_-]+$/, 'Mã chỉ gồm chữ, số, gạch ngang hoặc gạch dưới.'));
const paging = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(200).default(20), q: z.string().trim().max(100).default('') });
const catalogQuery = paging.extend({ status: z.enum(['active', 'inactive', 'all']).default('all') });
const regex = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const activeFilter = (s: string) => s === 'all' ? {} : s === 'active' ? { status: { $ne: 'inactive' } } : { status: 'inactive' };
const roomTypeInput = z.object({ code, name: text(), price: money, capacity, amenities: z.array(text(80)).max(30).default([]), description: optionalText(1000), status }).strict();
const serviceInput = z.object({ code, name: text(), price: money, category: optionalText(80), unit: text(30), status }).strict();
const roomInput = z.object({ number: text(20).transform(s => s.toUpperCase()), floor: z.number().int().min(-10).max(200), typeId: id, status: z.enum(['available', 'occupied', 'cleaning', 'maintenance']), active: z.boolean() }).strict();
export function normalizePhone(value: string) {
  const v = value.replace(/[\s().-]/g, '');
  return v.startsWith('+84') ? '0' + v.slice(3) : v.startsWith('0084') ? '0' + v.slice(4) : v;
}
const customerInput = z.object({
  fullName: text(), phone: text(30).transform(normalizePhone).pipe(z.string().regex(/^(0\d{9,10}|\+[1-9]\d{7,14})$/, 'Số điện thoại không hợp lệ. VD: 0901234567.')),
  idCard: text(40).transform(s => s.replace(/[\s.-]/g, '').toUpperCase()).pipe(z.string().regex(/^[A-Z0-9]{6,20}$/, 'Giấy tờ cần 6–20 ký tự chữ hoặc số.')),
  email: z.union([z.string().trim().email('Email không hợp lệ.').max(200), z.literal('')]).default(''), nationality: optionalText(80), status,
}).strict();
const date = z.string().refine(validCalendarDate, 'Ngày không hợp lệ; dùng định dạng YYYY-MM-DD.');
const dates = z.object({ checkIn: date, checkOut: date }).refine(d => d.checkOut > d.checkIn, { path: ['checkOut'], message: 'Ngày trả phải sau ngày nhận.' }).refine(d => nightsBetween(d.checkIn, d.checkOut) <= 365, { path: ['checkOut'], message: 'Một lượt lưu trú tối đa 365 đêm.' });
const draftInput = z.object({ customerId: id, checkIn: date, checkOut: date, rooms: z.array(z.object({ roomId: id, guestCount: capacity }).strict()).min(1, 'Hãy chọn ít nhất một phòng.').max(50), note: optionalText(1000) }).strict();
const roomTypeView = (d: InstanceType<typeof RoomType>): RoomTypeView => ({ id: String(d._id), code: d.type_code, name: d.name, price: d.base_price_per_night, capacity: d.max_occupancy, amenities: [...d.amenities], description: d.description || '', status: d.status as RoomTypeView['status'], version: d.version });
const serviceView = (d: InstanceType<typeof Service>): ServiceView => ({ id: String(d._id), code: d.service_code, name: d.name, category: d.category || '', unit: d.unit, price: d.unit_price, status: d.status as ServiceView['status'], version: d.version });
const customerView = (d: InstanceType<typeof Customer>): CustomerView => ({ id: String(d._id), fullName: d.full_name, phone: d.phone, idCard: d.id_card, email: d.email || '', nationality: d.nationality || '', status: d.status === 'inactive' ? 'inactive' : 'active', version: d.version });
function roomView(d: InstanceType<typeof Room>, type: InstanceType<typeof RoomType> | undefined): RoomView {
  return { id: String(d._id), number: d.room_number, floor: d.floor, typeId: String(d.room_type_id), typeName: type?.name || 'Chưa phân loại', price: type?.base_price_per_night || 0, capacity: type?.max_occupancy || 0, status: d.status as RoomView['status'], active: d.active, version: d.version };
}
function dateRange(checkIn: string, checkOut: string) {
  dates.parse({ checkIn, checkOut });
  return { start: new Date(checkIn + 'T00:00:00+07:00'), end: new Date(checkOut + 'T00:00:00+07:00') };
}
async function availableRooms(checkIn: string, checkOut: string, typeId?: string, guests = 1) {
  const { start, end } = dateRange(checkIn, checkOut);
  const blocked = await Booking.distinct('rooms_booked.room_id', { status: { $in: ['confirmed', 'checked_in'] }, check_in_plan: { $lt: end }, check_out_plan: { $gt: start } });
  const types = await RoomType.find({ status: 'active', max_occupancy: { $gte: guests }, ...(typeId ? { _id: typeId } : {}) });
  const rooms = await Room.find({ active: true, _id: { $nin: blocked }, room_type_id: { $in: types.map(t => t._id) }, status: { $ne: 'maintenance' },
    unavailable_periods: { $not: { $elemMatch: { start: { $lt: end }, $or: [{ end: null }, { end: { $gt: start } }] } } },
  }).sort({ floor: 1, room_number: 1 });
  const typeMap = new Map(types.map(t => [String(t._id), t]));
  return rooms.map(r => roomView(r, typeMap.get(String(r.room_type_id))));
}

export function operationsRouter() {
  const router = Router();
  router.get('/room-types', async (req, res) => {
    const { page, limit, q, status } = catalogQuery.parse(req.query);
    const filter = { ...activeFilter(status), ...(q ? { $or: [{ name: regex(q) }, { type_code: regex(q) }] } : {}) };
    const [items, total] = await Promise.all([RoomType.find(filter).sort({ type_code: 1 }).skip((page - 1) * limit).limit(limit), RoomType.countDocuments(filter)]);
    res.json({ items: items.map(roomTypeView), total, page, limit });
  });
  router.post('/room-types', adminOnly, async (req, res) => {
    const d = roomTypeInput.parse(req.body);
    const item = await RoomType.create({ type_code: d.code, name: d.name, base_price_per_night: d.price, max_occupancy: d.capacity, amenities: d.amenities, description: d.description, status: d.status });
    res.status(201).json({ item: roomTypeView(item) });
  });
  router.patch('/room-types/:id', adminOnly, async (req, res) => {
    const d = roomTypeInput.extend({ version }).parse(req.body);
    const typeId = validId(req.params.id);
    const result = await transaction(async session => {
      await lockTypes([typeId], session);
      const item = await RoomType.findById(typeId).session(session);
      if (!item) throw new HttpError(404, 'Không tìm thấy loại phòng.');
      checkVersion(item, d.version);
      if (d.status === 'inactive' && item.status === 'active') {
        const roomIds = await Room.find({ room_type_id: item._id }).distinct('_id').session(session);
        if (await Booking.exists({ 'rooms_booked.room_id': { $in: roomIds }, status: { $in: ['confirmed', 'checked_in'] } }).session(session)) throw new HttpError(409, 'Loại phòng còn lượt đã xác nhận hoặc đang lưu trú.');
      }
      const inventoryChanged = item.status !== d.status || item.name !== d.name;
      item.set({ type_code: d.code, name: d.name, base_price_per_night: d.price, max_occupancy: d.capacity, amenities: d.amenities, description: d.description, status: d.status });
      await item.save({ session });
      if (inventoryChanged) {
        const roomIds = await Room.find({ room_type_id: item._id }).distinct('_id').session(session);
        await lockRooms(roomIds.map(String), session);
        const at = new Date();
        for (const room of await Room.find({ _id: { $in: roomIds } }).session(session)) {
          recordRoomInventory(room, item, at); await room.save({ session });
        }
      }
      return roomTypeView(item);
    }); res.json({ item: result });
  });
  router.get('/services', async (req, res) => {
    const { page, limit, q, status } = catalogQuery.parse(req.query);
    const filter = { ...activeFilter(status), ...(q ? { $or: [{ name: regex(q) }, { service_code: regex(q) }, { category: regex(q) }] } : {}) };
    const [items, total] = await Promise.all([Service.find(filter).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit), Service.countDocuments(filter)]);
    res.json({ items: items.map(serviceView), total, page, limit });
  });
  router.post('/services', adminOnly, async (req, res) => {
    const d = serviceInput.parse(req.body);
    const item = await Service.create({ service_code: d.code, name: d.name, unit_price: d.price, category: d.category, unit: d.unit, status: d.status });
    res.status(201).json({ item: serviceView(item) });
  });
  router.patch('/services/:id', adminOnly, async (req, res) => {
    const d = serviceInput.extend({ version }).parse(req.body), item = await Service.findById(validId(req.params.id));
    if (!item) throw new HttpError(404, 'Không tìm thấy dịch vụ.');
    checkVersion(item, d.version);
    item.set({ service_code: d.code, name: d.name, unit_price: d.price, category: d.category, unit: d.unit, status: d.status });
    await item.save(); res.json({ item: serviceView(item) });
  });
  router.get('/rooms/availability', async (req, res) => {
    const d = paging.extend({ checkIn: date, checkOut: date, typeId: id.optional(), guests: z.coerce.number().int().min(1).max(100).default(1) }).parse(req.query);
    const all = (await availableRooms(d.checkIn, d.checkOut, d.typeId, d.guests)).filter(r => !d.q || regex(d.q).test(`${r.number} ${r.typeName}`));
    res.json({ items: all.slice((d.page - 1) * d.limit, d.page * d.limit), total: all.length, page: d.page, limit: d.limit, checkIn: d.checkIn, checkOut: d.checkOut, nights: nightsBetween(d.checkIn, d.checkOut) });
  });
  router.get('/rooms', async (req, res) => {
    const d = paging.extend({ active: z.enum(['true', 'false', 'all']).default('true'), typeId: id.optional(), floor: z.coerce.number().int().min(-10).max(200).optional(), status: z.enum(['available', 'occupied', 'cleaning', 'maintenance']).optional() }).parse(req.query);
    const matchingTypes = d.q ? await RoomType.find({ name: regex(d.q) }).distinct('_id') : [];
    const filter = { ...(d.active === 'all' ? {} : { active: d.active === 'true' }), ...(d.floor !== undefined ? { floor: d.floor } : {}), ...(d.typeId ? { room_type_id: d.typeId } : {}), ...(d.status ? { status: d.status } : {}), ...(d.q ? { $or: [{ room_number: regex(d.q) }, { room_type_id: { $in: matchingTypes } }] } : {}) };
    const [rooms, total] = await Promise.all([Room.find(filter).sort({ floor: 1, room_number: 1 }).skip((d.page - 1) * d.limit).limit(d.limit), Room.countDocuments(filter)]);
    const types = await RoomType.find({ _id: { $in: rooms.map(r => r.room_type_id) } });
    res.json({ items: rooms.map(r => roomView(r, types.find(t => t._id.equals(r.room_type_id)))), total, page: d.page, limit: d.limit });
  });
  router.post('/rooms', adminOnly, async (req, res) => {
    const d = roomInput.parse(req.body);
    if (d.status === 'occupied') throw new HttpError(400, 'Phòng có khách chỉ được ghi nhận qua check-in.');
    const result = await transaction(async session => {
      await lockTypes([d.typeId], session);
      const type = await RoomType.findOne({ _id: d.typeId, status: 'active' }).session(session);
      if (!type) throw new HttpError(400, 'Hãy chọn loại phòng đang hoạt động.');
      const [item] = await Room.create([{ room_number: d.number, floor: d.floor, room_type_id: d.typeId, status: d.status, active: d.active,
        unavailable_periods: d.status === 'maintenance' ? [{ start: new Date(), reason: 'Bảo trì' }] : [] }], { session });
      return roomView(item, type);
    }); res.status(201).json({ item: result });
  });
  router.patch('/rooms/:id', adminOnly, async (req, res) => {
    const d = roomInput.extend({ version }).parse(req.body), roomId = validId(req.params.id);
    const result = await transaction(async session => {
      const prior = await Room.findById(roomId).session(session);
      if (!prior) throw new HttpError(404, 'Không tìm thấy phòng.');
      await lockTypes([String(prior.room_type_id), d.typeId], session);
      await lockRooms([roomId], session);
      const item = await Room.findById(roomId).session(session);
      if (!item) throw new HttpError(404, 'Không tìm thấy phòng.');
      checkVersion(item, d.version);
      if (item.status === 'occupied' || item.current_booking_id) throw new HttpError(409, 'Phòng đang có khách; cần hoàn tất lượt lưu trú trước khi sửa.');
      if (d.status === 'occupied') throw new HttpError(400, 'Phòng có khách chỉ được ghi nhận qua check-in.');
      const type = await RoomType.findById(d.typeId).session(session);
      if (!type || (type.status !== 'active' && (String(item.room_type_id) !== d.typeId || d.active))) throw new HttpError(400, 'Hãy chọn loại phòng đang hoạt động.');
      const changesSchedule = d.typeId !== String(item.room_type_id) || d.number !== item.room_number || !d.active || d.status === 'maintenance';
      if (changesSchedule && await Booking.exists({ 'rooms_booked.room_id': item._id, status: { $in: ['confirmed', 'checked_in'] } }).session(session)) throw new HttpError(409, 'Phòng còn lịch đã xác nhận; chưa thể đổi loại, đổi số hoặc ngừng sử dụng.');
      if (item.status !== 'maintenance' && d.status === 'maintenance') item.unavailable_periods.push({ start: new Date(), reason: 'Bảo trì' });
      if (item.status === 'maintenance' && d.status !== 'maintenance') for (const period of item.unavailable_periods) if (!period.end) period.end = new Date();
      item.set({ room_number: d.number, floor: d.floor, room_type_id: d.typeId, status: d.status, active: d.active });
      await item.save({ session }); return roomView(item, type);
    }); res.json({ item: result });
  });
  router.post('/rooms/:id/mark-ready', adminOnly, async (req, res) => {
    const d = z.object({ version }).strict().parse(req.body), roomId = validId(req.params.id);
    const result = await transaction(async session => {
      await lockRooms([roomId], session);
      const item = await Room.findById(roomId).session(session);
      if (!item) throw new HttpError(404, 'Không tìm thấy phòng.');
      checkVersion(item, d.version);
      if (item.status !== 'cleaning' || item.current_booking_id) {
        throw new HttpError(409, 'Chỉ xác nhận dọn xong cho phòng đang ở trạng thái Đang dọn.');
      }
      const type = await RoomType.findById(item.room_type_id).session(session);
      item.status = 'available';
      await item.save({ session });
      return roomView(item, type || undefined);
    });
    res.json({ item: result });
  });
  router.get('/customers', async (req, res) => {
    const d = catalogQuery.parse(req.query);
    const filter = { ...activeFilter(d.status), ...(d.q ? { $or: [{ full_name: regex(d.q) }, { phone: regex(normalizePhone(d.q)) }, { id_card: regex(d.q.replace(/[\s.-]/g, '')) }] } : {}) };
    const [items, total] = await Promise.all([Customer.find(filter).sort({ created_at: -1, _id: -1 }).skip((d.page - 1) * d.limit).limit(d.limit), Customer.countDocuments(filter)]);
    res.json({ items: items.map(customerView), total, page: d.page, limit: d.limit });
  });
  router.post('/customers', async (req, res) => {
    const d = customerInput.parse(req.body);
    const item = await Customer.create({ full_name: d.fullName, phone: d.phone, id_card: d.idCard, email: d.email, nationality: d.nationality, status: d.status });
    res.status(201).json({ item: customerView(item) });
  });
  router.patch('/customers/:id', async (req, res) => {
    const d = customerInput.extend({ version }).parse(req.body), item = await Customer.findById(validId(req.params.id));
    if (!item) throw new HttpError(404, 'Không tìm thấy khách hàng.');
    checkVersion(item, d.version);
    item.set({ full_name: d.fullName, phone: d.phone, id_card: d.idCard, email: d.email, nationality: d.nationality, status: d.status });
    await item.save(); res.json({ item: customerView(item) });
  });
  router.get('/customers/:id/bookings', async (req, res) => {
    const customerId = validId(req.params.id), { page, limit } = paging.parse(req.query);
    if (!await Customer.exists({ _id: customerId })) throw new HttpError(404, 'Không tìm thấy khách hàng.');
    const [items, total] = await Promise.all([Booking.find({ customer_id: customerId }).sort({ created_at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Booking.countDocuments({ customer_id: customerId })]);
    res.json({ items: items.map(bookingView), total, page, limit });
  });
  router.get('/bookings', async (req, res) => {
    const d = paging.extend({ status: z.enum(['pending', 'confirmed', 'checked_in', 'completed', 'cancelled']).optional(), refund: z.enum(['pending']).optional() }).parse(req.query);
    const filter = { ...(d.status ? { status: d.status } : {}), ...(d.refund ? { refund_status: d.refund } : {}), ...(d.q ? { $or: [{ booking_code: regex(d.q) }, { 'customer_snapshot.full_name': regex(d.q) }, { 'customer_snapshot.phone': regex(normalizePhone(d.q)) }] } : {}) };
    const [items, total] = await Promise.all([Booking.find(filter).sort({ created_at: -1, _id: -1 }).skip((d.page - 1) * d.limit).limit(d.limit), Booking.countDocuments(filter)]);
    res.json({ items: items.map(bookingView), total, page: d.page, limit: d.limit });
  });
  router.get('/bookings/:id', async (req, res) => {
    const item = await Booking.findById(validId(req.params.id));
    if (!item) throw new HttpError(404, 'Không tìm thấy phiếu đặt phòng.');
    res.json({ item: bookingView(item) });
  });
  async function prepareDraft(d: z.infer<typeof draftInput>) {
    const { start, end } = dateRange(d.checkIn, d.checkOut);
    if (d.checkIn < hotelDay(new Date())) throw new HttpError(400, 'Không thể tạo hoặc đổi lịch đặt phòng trong quá khứ.');
    if (new Set(d.rooms.map(r => r.roomId)).size !== d.rooms.length) throw new HttpError(400, 'Không được chọn trùng phòng.');
    const customer = await Customer.findById(d.customerId);
    if (!customer || customer.status === 'inactive') throw new HttpError(400, 'Khách hàng không tồn tại hoặc đã ngừng sử dụng.');
    const available = await availableRooms(d.checkIn, d.checkOut);
    const rooms = d.rooms.map(line => {
      const r = available.find(r => r.id === line.roomId);
      if (!r) throw new HttpError(409, 'Một phòng không còn phù hợp với lịch này. Hãy tìm phòng lại.');
      if (line.guestCount > r.capacity) throw new HttpError(400, `Phòng ${r.number} chỉ nhận tối đa ${r.capacity} khách.`);
      return { room_id: r.id, room_number: r.number, room_type_id: r.typeId, room_type_name: r.typeName, price_per_night: r.price, guest_count: line.guestCount };
    });
    return { customer_id: customer._id, customer_snapshot: { full_name: customer.full_name, phone: customer.phone, id_card: customer.id_card }, check_in_plan: start, check_out_plan: end, rooms_booked: rooms, note: d.note };
  }
  router.post('/bookings', async (req, res) => {
    const d = draftInput.parse(req.body), prepared = await prepareDraft(d);
    const item = await Booking.create({ ...prepared, booking_code: `DP-${d.checkIn.replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`, status: 'pending', deposit_amount: 0, created_by: res.locals.user._id,
      history: [{ action: 'created', to: 'pending', at: new Date(), by: res.locals.user._id, by_name: res.locals.user.full_name, reason: 'Tạo phiếu nháp, chưa giữ phòng.' }] });
    res.status(201).json({ item: bookingView(item) });
  });
  router.patch('/bookings/:id', async (req, res) => {
    const d = draftInput.extend({ version }).parse(req.body), item = await Booking.findById(validId(req.params.id));
    if (!item) throw new HttpError(404, 'Không tìm thấy phiếu đặt phòng.');
    if (item.status !== 'pending') throw new HttpError(409, 'Chỉ được sửa phiếu còn ở trạng thái nháp.');
    checkVersion(item, d.version);
    item.set(await prepareDraft(d));
    item.history.push({ action: 'draft_updated', from: 'pending', to: 'pending', at: new Date(), by: res.locals.user._id, by_name: res.locals.user.full_name, reason: 'Cập nhật nháp và báo giá lại theo danh mục.' });
    await item.save(); res.json({ item: bookingView(item) });
  });
  return router;
}
