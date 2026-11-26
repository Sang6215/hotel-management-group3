import { createHash } from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Booking, Customer, Invoice, Promotion, Room, RoomType, Service, User } from './models.js';
import { adminOnly, HttpError } from './http.js';
import { transaction } from './scheduling.js';
import { normalizePhone } from './operations.js';
import { hotelDay, nextDay, validCalendarDate } from '../shared/dates.js';
import type { DataCollectionName, DataImportResult } from '../shared/types.js';

const { EJSON } = mongoose.mongo.BSON;

type BusinessCollectionName = 'room_types' | 'rooms' | 'customers' | 'services' | 'promotions' | 'bookings' | 'invoices';
type GenericModel = mongoose.Model<Record<string, unknown>>;
const asGeneric = (model: unknown) => model as GenericModel;

const BUSINESS_MODELS: Record<BusinessCollectionName, GenericModel> = {
  room_types: asGeneric(RoomType),
  rooms: asGeneric(Room),
  customers: asGeneric(Customer),
  services: asGeneric(Service),
  promotions: asGeneric(Promotion),
  bookings: asGeneric(Booking),
  invoices: asGeneric(Invoice),
};

const EXPORT_MODELS: Record<DataCollectionName, GenericModel> = { ...BUSINESS_MODELS, users: asGeneric(User) };
const BUSINESS_KEYS = Object.keys(BUSINESS_MODELS) as BusinessCollectionName[];
const EXPORT_KEYS = Object.keys(EXPORT_MODELS) as DataCollectionName[];

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function safeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const raw = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(EJSON.serialize(value)) : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + guarded.replaceAll('"', '""') + '"';
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '\uFEFF';
  const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const lines = [headers.map(h => safeCsvValue(h)).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => safeCsvValue(row[h])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

const backupSchema = z.object({
  backup: z.object({
    format: z.literal('hotel-desk-backup-v1'),
    version: z.literal(1),
    exportedAt: z.string().min(1).max(64),
    exportedBy: z.string().max(100).optional(),
    counts: z.record(z.string(), z.number().int().min(0)),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    collections: z.object({
      room_types: z.array(z.unknown()),
      rooms: z.array(z.unknown()),
      customers: z.array(z.unknown()),
      services: z.array(z.unknown()),
      promotions: z.array(z.unknown()),
      bookings: z.array(z.unknown()),
      invoices: z.array(z.unknown()),
    }).strict(),
  }).strict(),
  confirm: z.literal('RESTORE'),
}).strict();

const importSchema = z.object({
  collection: z.enum(['room_types', 'rooms', 'services', 'customers', 'promotions']),
  items: z.array(z.record(z.string(), z.unknown())).min(1, 'Cần ít nhất 1 bản ghi để nhập.').max(500, 'Tối đa 500 bản ghi mỗi lần nhập.'),
}).strict();

const importSchemas = {
  room_types: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/),
    name: z.string().trim().min(1).max(100),
    price: z.number().int().min(0).max(1_000_000_000),
    capacity: z.number().int().min(1).max(100),
    amenities: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    description: z.string().trim().max(1000).default(''),
    status: z.enum(['active', 'inactive']).default('active'),
  }).strict(),
  rooms: z.object({
    number: z.string().trim().toUpperCase().min(1).max(20),
    floor: z.number().int().min(-10).max(200),
    typeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/),
    status: z.enum(['available', 'cleaning', 'maintenance']).default('available'),
    active: z.boolean().default(true),
  }).strict(),
  services: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/),
    name: z.string().trim().min(1).max(100),
    category: z.string().trim().max(80).default(''),
    unit: z.string().trim().min(1).max(30),
    price: z.number().int().min(0).max(1_000_000_000),
    status: z.enum(['active', 'inactive']).default('active'),
  }).strict(),
  customers: z.object({
    fullName: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(1).max(30).transform(normalizePhone).pipe(z.string().regex(/^(0\d{9,10}|\+[1-9]\d{7,14})$/)),
    idCard: z.string().trim().min(1).max(40).transform(s => s.replace(/[\s.-]/g, '').toUpperCase()).pipe(z.string().regex(/^[A-Z0-9]{6,20}$/)),
    email: z.union([z.string().trim().email().max(200), z.literal('')]).default(''),
    nationality: z.string().trim().max(80).default(''),
    status: z.enum(['active', 'inactive']).default('active'),
  }).strict(),
  promotions: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/),
    type: z.enum(['percentage', 'fixed']),
    value: z.number().int().min(1).max(20_000_000_000_000),
    maxDiscount: z.number().int().min(1).max(20_000_000_000_000),
    minAmount: z.number().int().min(0).max(20_000_000_000_000),
    startsOn: z.string().refine(validCalendarDate),
    endsOn: z.string().refine(validCalendarDate),
    status: z.enum(['active', 'inactive']).default('active'),
  }).strict().refine(d => d.endsOn >= d.startsOn && (d.type !== 'percentage' || d.value <= 100), 'Dữ liệu khuyến mãi không hợp lệ.'),
};

export function dataToolsRouter() {
  const router = Router();
  router.use('/data', adminOnly);

  router.get('/data/summary', async (_req, res) => {
    const entries = await Promise.all(
      EXPORT_KEYS.map(async key => [key, await EXPORT_MODELS[key].countDocuments()] as const),
    );
    res.json({ asOf: new Date().toISOString(), counts: Object.fromEntries(entries) });
  });

  router.get('/data/export', async (req, res) => {
    const query = z.object({
      collection: z.enum(EXPORT_KEYS as [DataCollectionName, ...DataCollectionName[]]),
      format: z.enum(['json', 'csv']).default('json'),
    }).strict().parse(req.query);

    const docs = await transaction(async session => {
      const q = EXPORT_MODELS[query.collection].find({}).sort({ _id: 1 }).session(session);
      if (query.collection === 'users') q.select('-password_hash -session_version');
      return q.lean();
    });

    const day = hotelDay(new Date());
    if (query.format === 'csv') {
      const normalized = docs.map(doc => {
        const record = { ...(doc as Record<string, unknown>) };
        if ('_id' in record) record._id = String(record._id);
        return record;
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="hotel-${query.collection}-${day}.csv"`);
      res.send(toCsv(normalized));
      return;
    }

    const serialized = EJSON.serialize(docs);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hotel-${query.collection}-${day}.json"`);
    res.send(JSON.stringify(serialized, null, 2));
  });

  router.get('/data/backup', async (_req, res) => {
    const snapshot = await transaction(async session => {
      const out: Record<string, unknown[]> = {};
      for (const key of BUSINESS_KEYS) {
        out[key] = await BUSINESS_MODELS[key].find({}).sort({ _id: 1 }).session(session).lean();
      }
      return out;
    });

    const collections = EJSON.serialize(snapshot) as Record<string, unknown[]>;
    const counts = Object.fromEntries(BUSINESS_KEYS.map(k => [k, collections[k].length]));
    const payload = {
      format: 'hotel-desk-backup-v1' as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      exportedBy: res.locals.user.username as string,
      counts,
      checksum: sha256(collections),
      collections,
    };

    const day = hotelDay(new Date());
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hotel-desk-backup-${day}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  router.post('/data/restore', async (req, res) => {
    const { backup } = backupSchema.parse(req.body);
    if (sha256(backup.collections) !== backup.checksum) {
      throw new HttpError(400, 'Mã kiểm tra (checksum) bản sao lưu không khớp. Tệp có thể đã bị sửa hoặc hỏng.');
    }
    for (const key of BUSINESS_KEYS) {
      if (backup.counts[key] !== backup.collections[key].length) {
        throw new HttpError(400, `Số lượng bản ghi collection ${key} không khớp metadata sao lưu.`);
      }
    }

    let deserialized: Record<keyof typeof BUSINESS_MODELS, Record<string, unknown>[]>;
    try {
      deserialized = EJSON.deserialize(backup.collections) as typeof deserialized;
    } catch {
      throw new HttpError(400, 'Định dạng BSON/Extended JSON trong bản sao lưu không hợp lệ.');
    }

    for (const key of BUSINESS_KEYS) {
      const Model = BUSINESS_MODELS[key];
      for (const rawDoc of deserialized[key]) {
        try {
          await new Model(rawDoc).validate();
        } catch {
          throw new HttpError(400, `Dữ liệu không hợp lệ trong collection ${key}; hủy khôi phục để bảo toàn dữ liệu hiện tại.`);
        }
      }
    }

    await transaction(async session => {
      for (const key of BUSINESS_KEYS) {
        const Model = BUSINESS_MODELS[key];
        await Model.deleteMany({}, { session });
        if (deserialized[key].length) {
          await Model.collection.insertMany(deserialized[key], { session });
        }
      }
    });

    res.json({ message: 'Đã khôi phục toàn bộ dữ liệu nghiệp vụ từ bản sao lưu.', counts: backup.counts });
  });

  router.post('/data/import', async (req, res) => {
    const { collection, items } = importSchema.parse(req.body);
    let inserted = 0;
    let skipped = 0;
    const errors: DataImportResult['errors'] = [];

    for (const [index, raw] of items.entries()) {
      const parsed = importSchemas[collection].safeParse(raw);
      if (!parsed.success) {
        errors.push({ index, message: parsed.error.issues[0]?.message || 'Dữ liệu không hợp lệ.' });
        continue;
      }

      try {
        if (collection === 'room_types') {
          const d = parsed.data as z.infer<typeof importSchemas.room_types>;
          if (await RoomType.exists({ type_code: d.code })) { skipped++; continue; }
          await RoomType.create({ type_code: d.code, name: d.name, base_price_per_night: d.price, max_occupancy: d.capacity, amenities: d.amenities, description: d.description, status: d.status });
        } else if (collection === 'services') {
          const d = parsed.data as z.infer<typeof importSchemas.services>;
          if (await Service.exists({ service_code: d.code })) { skipped++; continue; }
          await Service.create({ service_code: d.code, name: d.name, category: d.category, unit: d.unit, unit_price: d.price, status: d.status });
        } else if (collection === 'customers') {
          const d = parsed.data as z.infer<typeof importSchemas.customers>;
          if (await Customer.exists({ $or: [{ phone: d.phone }, { id_card: d.idCard }] })) { skipped++; continue; }
          await Customer.create({ full_name: d.fullName, phone: d.phone, id_card: d.idCard, email: d.email, nationality: d.nationality, status: d.status });
        } else if (collection === 'promotions') {
          const d = parsed.data as z.infer<typeof importSchemas.promotions>;
          if (await Promotion.exists({ code: d.code })) { skipped++; continue; }
          await Promotion.create({ code: d.code, discount_type: d.type, discount_value: d.value, max_discount_amount: d.maxDiscount, min_booking_amount: d.minAmount, start_date: new Date(d.startsOn + 'T00:00:00+07:00'), end_date: new Date(nextDay(d.endsOn) + 'T00:00:00+07:00'), status: d.status });
        } else {
          const d = parsed.data as z.infer<typeof importSchemas.rooms>;
          const type = await RoomType.findOne({ type_code: d.typeCode });
          if (!type) { errors.push({ index, message: `Không tìm thấy loại phòng mã ${d.typeCode}.` }); continue; }
          if (await Room.exists({ room_number: d.number })) { skipped++; continue; }
          await Room.create({ room_number: d.number, floor: d.floor, room_type_id: type._id, status: d.status, active: d.active, unavailable_periods: d.status === 'maintenance' ? [{ start: new Date(), reason: 'Bảo trì' }] : [] });
        }
        inserted++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Không thể nhập bản ghi.';
        errors.push({ index, message: msg });
      }
    }

    res.json({ collection, total: items.length, inserted, skipped, errors } satisfies DataImportResult);
  });

  return router;
}
