import mongoose, { Schema } from 'mongoose';

const options = { timestamps: { createdAt: 'created_at' as const, updatedAt: 'updated_at' as const }, optimisticConcurrency: true, versionKey: 'version' };
const money = { type: Number, required: true, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger };
const oid = Schema.Types.ObjectId;
const status = { type: String, enum: ['active', 'inactive'], default: 'active' };
const positiveInt = { type: Number, required: true, min: 1, max: 1000, validate: Number.isSafeInteger };

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 40 },
  full_name: { type: String, required: true, trim: true, maxlength: 100 },
  password_hash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'staff'], required: true },
  status: { type: String, enum: ['active', 'locked'], default: 'active' },
  session_version: { type: Number, default: 0 },
}, options);

const roomTypeSchema = new Schema({
  coordination_version: { type: Number, default: 0 },
  version: { type: Number, default: 0 },
  type_code: { type: String, required: true, unique: true }, name: { type: String, required: true },
  base_price_per_night: money, max_occupancy: positiveInt, amenities: [String], description: String, status,
}, options);
const roomSchema = new Schema({
  version: { type: Number, default: 0 },
  room_number: { type: String, required: true, unique: true }, floor: { type: Number, required: true },
  room_type_id: { type: oid, ref: 'RoomType', required: true },
  status: { type: String, enum: ['available', 'occupied', 'cleaning', 'maintenance'], default: 'available' },
  active: { type: Boolean, default: true }, current_booking_id: { type: oid, ref: 'Booking' },
  schedule_version: { type: Number, default: 0 },
  unavailable_periods: [{ start: { type: Date, required: true }, end: Date, reason: String }],
  inventory_history: [{ at: { type: Date, required: true }, type_id: { type: oid, required: true }, type_name: { type: String, required: true }, enabled: { type: Boolean, required: true } }],
}, options);
roomSchema.index({ active: 1, room_type_id: 1, status: 1 });
roomSchema.pre('save', async function () {
  if (!this.inventory_history.length || this.isModified('active') || this.isModified('status') || this.isModified('room_type_id')) {
    const type = await RoomType.findById(this.room_type_id).session(this.$session() || null);
    recordRoomInventory(this, type, new Date());
  }
});

const customerSchema = new Schema({
  coordination_version: { type: Number, default: 0 },
  version: { type: Number, default: 0 },
  full_name: { type: String, required: true }, id_card: { type: String, required: true, unique: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true }, email: String, nationality: String, status,
}, options);
const serviceSchema = new Schema({
  coordination_version: { type: Number, default: 0 },
  version: { type: Number, default: 0 },
  service_code: { type: String, required: true, unique: true }, name: { type: String, required: true },
  category: String, unit: { type: String, required: true }, unit_price: money, status,
}, options);
const roomLine = new Schema({
  room_id: { type: oid, ref: 'Room', required: true }, room_number: { type: String, required: true },
  room_type_id: { type: oid, ref: 'RoomType', required: true }, room_type_name: { type: String, required: true },
  price_per_night: money, guest_count: positiveInt,
}, { _id: false });
const serviceLine = new Schema({
  service_id: { type: oid, ref: 'Service', required: true }, room_id: { type: oid, ref: 'Room', required: true },
  service_code: String, unit: String, room_number: String, created_by_name: String,
  service_name: { type: String, required: true }, quantity: positiveInt, unit_price: money, amount: money,
  used_at: { type: Date, required: true }, created_by: { type: oid, ref: 'User', required: true },
  voided: { type: Boolean, default: false }, void_reason: String,
});
const paymentLine = new Schema({
  request_id: { type: String, required: true }, kind: { type: String, enum: ['deposit', 'checkout', 'refund', 'adjustment'], required: true },
  amount: money, direction: { type: String, enum: ['in', 'out'], required: true },
  method: { type: String, enum: ['cash', 'transfer', 'card'], required: true }, reference: String,
  recorded_at: { type: Date, required: true }, recorded_by: { type: oid, ref: 'User', required: true }, reason: String,
  recorded_by_name: String,
});
const bookingSchema = new Schema({
  version: { type: Number, default: 0 },
  booking_code: { type: String, required: true, unique: true }, customer_id: { type: oid, ref: 'Customer', required: true },
  customer_snapshot: { full_name: { type: String, required: true }, phone: { type: String, required: true }, id_card: { type: String, required: true } },
  rooms_booked: { type: [roomLine], validate: { validator: (v: unknown[]) => v.length > 0 && v.length <= 50, message: 'Booking needs 1–50 rooms.' } },
  check_in_plan: { type: Date, required: true }, check_out_plan: { type: Date, required: true }, actual_check_in: Date, actual_check_out: Date,
  services_used: [serviceLine], payments: [paymentLine],
  deposit_amount: { ...money, default: 0 },
  confirmed_at: Date,
  invoice_id: { type: oid, ref: 'Invoice' },
  refund_status: { type: String, enum: ['none', 'pending', 'refunded'], default: 'none' },
  commands: [{ request_id: { type: String, required: true }, payload_hash: { type: String, required: true }, action: String, at: Date, resulting_version: Number, amount: Number }],
  status: { type: String, enum: ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled'], default: 'pending' },
  created_by: { type: oid, ref: 'User', required: true }, note: { type: String, maxlength: 1000, default: '' },
  history: [{ action: String, from: String, to: String, reason: String, at: Date, by: { type: oid, ref: 'User' }, by_name: String }],
}, options);
bookingSchema.pre('validate', function () {
  if (this.check_in_plan && this.check_out_plan && this.check_out_plan <= this.check_in_plan) this.invalidate('check_out_plan', 'Ngày trả phải sau ngày nhận.');
  const ids = this.rooms_booked.map(r => String(r.room_id));
  if (new Set(ids).size !== ids.length) this.invalidate('rooms_booked', 'Phòng trong booking không được trùng.');
});
bookingSchema.index({ 'rooms_booked.room_id': 1, status: 1, check_in_plan: 1, check_out_plan: 1 });
bookingSchema.index({ customer_id: 1, created_at: -1 });
bookingSchema.index({ 'payments.recorded_at': 1 });
bookingSchema.index({ 'payments.recorded_by': 1, 'payments.recorded_at': 1 });
bookingSchema.index({ status: 1, actual_check_in: 1 });
bookingSchema.index({ status: 1, 'services_used.used_at': 1 });

const promotionSchema = new Schema({
  version: { type: Number, default: 0 }, coordination_version: { type: Number, default: 0 },
  code: { type: String, required: true, uppercase: true, trim: true, unique: true },
  discount_type: { type: String, enum: ['percentage', 'fixed'], required: true },
  discount_value: money, max_discount_amount: money, min_booking_amount: money,
  start_date: { type: Date, required: true }, end_date: { type: Date, required: true }, status,
}, options);
promotionSchema.pre('validate', function () {
  if (this.end_date <= this.start_date) this.invalidate('end_date', 'Hiệu lực không hợp lệ.');
  if (this.discount_type === 'percentage' && this.discount_value > 100) this.invalidate('discount_value', 'Phần trăm tối đa 100.');
});
const invoiceSchema = new Schema({
  version: { type: Number, default: 0 },
  invoice_code: { type: String, required: true, unique: true }, booking_id: { type: oid, ref: 'Booking', required: true, unique: true },
  booking_code: String, customer_phone: String, customer_id_card: String,
  actual_check_in: Date, actual_check_out: Date, nights: Number, created_by_name: String,
  customer_id: { type: oid, ref: 'Customer', required: true }, customer_name: { type: String, required: true },
  rooms_snapshot: [roomLine], services_snapshot: [serviceLine],
  total_room_charge: money, total_service_charge: money, discount_amount: money, deposit_deducted: money,
  invoice_total: money, balance_collected: money, refund_amount: { ...money, default: 0 },
  promotion_snapshot: { code: String, discount_type: String, discount_value: Number, min_booking_amount: Number, max_discount_amount: Number, start_date: Date, end_date: Date },
  payments_snapshot: [paymentLine],
  payment_status: { type: String, enum: ['paid'], default: 'paid' }, paid_at: { type: Date, required: true },
  created_by: { type: oid, ref: 'User', required: true },
  adjustments: [{ reason: String, amount: Number, approved_at: Date, approved_by: { type: oid, ref: 'User' }, approved_by_name: String, request_id: String, payload_hash: String, resulting_version: Number, method: { type: String, enum: ['cash', 'transfer', 'card'] }, reference: String }],
}, options);
invoiceSchema.index({ payment_status: 1, paid_at: -1 });
invoiceSchema.index({ customer_id: 1, paid_at: -1 });
invoiceSchema.index({ payment_status: 1, 'adjustments.approved_at': 1 });

export const User = mongoose.model('User', userSchema, 'users');
export const RoomType = mongoose.model('RoomType', roomTypeSchema, 'room_types');
export const Room = mongoose.model('Room', roomSchema, 'rooms');
export const Customer = mongoose.model('Customer', customerSchema, 'customers');
export const Service = mongoose.model('Service', serviceSchema, 'services');
export const Booking = mongoose.model('Booking', bookingSchema, 'bookings');
export const Promotion = mongoose.model('Promotion', promotionSchema, 'promotions');
export const Invoice = mongoose.model('Invoice', invoiceSchema, 'invoices');

export function recordRoomInventory(room: InstanceType<typeof Room>, type: InstanceType<typeof RoomType> | null, at: Date) {
  const state = { at, type_id: room.room_type_id, type_name: type?.name || 'Loại phòng không còn tồn tại', enabled: room.active && room.status !== 'maintenance' && type?.status === 'active' };
  const last = room.inventory_history.at(-1);
  if (last && last.enabled === state.enabled && String(last.type_id) === String(state.type_id) && last.type_name === state.type_name) return;
  if (room.inventory_history.length >= 10000) throw new Error('Room inventory history limit reached');
  room.inventory_history.push(state);
}

// Establish a known baseline, never invent pre-upgrade history or change business data.
async function initializeRoomHistory() {
  const ids = await Room.find({ 'inventory_history.0': { $exists: false } }).distinct('_id');
  for (const id of ids) await mongoose.connection.transaction(async session => {
    const prior = await Room.findById(id).session(session);
    if (!prior || prior.inventory_history.length) return;
    await RoomType.updateOne({ _id: prior.room_type_id }, { $inc: { coordination_version: 1 } }, { session });
    await Room.updateOne({ _id: id }, { $inc: { schedule_version: 1 } }, { session });
    const room = await Room.findById(id).session(session);
    if (room && !room.inventory_history.length) {
      recordRoomInventory(room, await RoomType.findById(room.room_type_id).session(session), new Date());
      await room.save({ session });
    }
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
}

export async function initializeModels() {
  // All collections exist before any transaction uses them. This only adds declared indexes.
  for (const model of [User, RoomType, Room, Customer, Service, Booking, Promotion, Invoice]) {
    await model.createCollection();
    await model.createIndexes();
  }
  await initializeRoomHistory();
}
