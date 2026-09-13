import { Router } from 'express';
import mongoose, { type ClientSession, type PipelineStage } from 'mongoose';
import { z } from 'zod';
import { Booking, Customer, Invoice, Room } from './models.js';
import { adminOnly, HttpError, validId } from './http.js';
import { transaction } from './scheduling.js';
import { hotelDay, nextDay, nightsBetween, validCalendarDate } from '../shared/dates.js';
import { calculateOccupancy } from './occupancy.js';
import type { CashTotals, ReceiptsReport, ReportPeriod, RevenueReport, RevenueTotals, TopCustomersReport, TopServicesReport } from '../shared/reports.js';

const date = z.string().refine(validCalendarDate, 'Ngày không hợp lệ; dùng YYYY-MM-DD.');
const rangeInput = z.object({ from: date.optional(), to: date.optional() });
const id = z.string().regex(/^[a-f0-9]{24}$/i, 'Mã dữ liệu không hợp lệ.');
const topInput = rangeInput.extend({ limit: z.coerce.number().int().min(1).max(50).default(10) });
const receiptsInput = rangeInput.extend({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), method: z.enum(['cash', 'transfer', 'card']).optional(), kind: z.enum(['deposit', 'checkout', 'refund', 'adjustment']).optional() });
export function reportRange(input: { from?: string; to?: string }, at = new Date()) {
  const today = hotelDay(at), from = input.from || today.slice(0, 8) + '01', to = input.to || today;
  if (!validCalendarDate(from) || !validCalendarDate(to) || to < from || nightsBetween(from, nextDay(to)) > 366) throw new HttpError(400, 'Chọn khoảng ngày hợp lệ, từ ngày bắt đầu đến hết ngày kết thúc, tối đa 366 ngày.');
  return { from, to, asOf: at.toISOString(), timezone: 'Asia/Ho_Chi_Minh' } satisfies ReportPeriod;
}
const timeRange = (r: ReportPeriod) => ({ $gte: new Date(r.from + 'T00:00:00+07:00'), $lt: new Date(Math.min(Date.parse(nextDay(r.to) + 'T00:00:00+07:00'), Date.parse(r.asOf) + 1)) });
const period = (field: string, groupBy: 'day' | 'month') => ({ $dateToString: { date: field, format: groupBy === 'day' ? '%Y-%m-%d' : '%Y-%m', timezone: 'Asia/Ho_Chi_Minh' } });
export function safeReportNumbers(value: unknown): void {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new HttpError(409, 'Tổng số vượt giới hạn tính chính xác. Hãy thu hẹp khoảng báo cáo.');
  if (Array.isArray(value)) value.forEach(safeReportNumbers);
  else if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof mongoose.Types.ObjectId)) Object.values(value).forEach(safeReportNumbers);
}
const aggregate = (model: typeof Invoice | typeof Booking, pipeline: PipelineStage[], session: ClientSession) => model.aggregate(pipeline).session(session).option({ maxTimeMS: 15000 }).exec();
const emptyRevenue = (): RevenueTotals => ({ invoiceCount: 0, roomTotal: 0, serviceTotal: 0, discount: 0, invoiceTotal: 0, adjustments: 0, revenue: 0, cashIn: 0, cashOut: 0, netCash: 0 });

export function revenuePipeline(r: ReportPeriod, groupBy: 'day' | 'month'): PipelineStage[] {
  return [{ $match: { payment_status: 'paid', paid_at: timeRange(r) } }, { $group: { _id: period('$paid_at', groupBy), invoiceCount: { $sum: 1 }, roomTotal: { $sum: '$total_room_charge' }, serviceTotal: { $sum: '$total_service_charge' }, discount: { $sum: '$discount_amount' }, invoiceTotal: { $sum: '$invoice_total' } } }];
}
export function receiptsMatch(r: ReportPeriod, filter: { employeeId?: string; method?: string; kind?: string } = {}) {
  return { recorded_at: timeRange(r), ...(filter.employeeId ? { recorded_by: new mongoose.Types.ObjectId(filter.employeeId) } : {}), ...(filter.method ? { method: filter.method } : {}), ...(filter.kind ? { kind: filter.kind } : {}) };
}
function receiptStages(r: ReportPeriod, filter: { employeeId?: string; method?: string; kind?: string } = {}): PipelineStage[] {
  const match = receiptsMatch(r, filter);
  return [{ $match: { payments: { $elemMatch: match } } }, { $unwind: '$payments' }, { $match: Object.fromEntries(Object.entries(match).map(([k, v]) => ['payments.' + k, v])) }];
}
const cashFields = { count: { $sum: 1 }, cashIn: { $sum: { $cond: [{ $eq: ['$payments.direction', 'in'] }, '$payments.amount', 0] } }, cashOut: { $sum: { $cond: [{ $eq: ['$payments.direction', 'out'] }, '$payments.amount', 0] } } };
const cashTotals = (d?: { count: number; cashIn: number; cashOut: number }): CashTotals => ({ count: d?.count || 0, cashIn: d?.cashIn || 0, cashOut: d?.cashOut || 0, netCash: (d?.cashIn || 0) - (d?.cashOut || 0) });

async function revenue(r: ReportPeriod, groupBy: 'day' | 'month', session: ClientSession): Promise<RevenueReport> {
  const originals = await aggregate(Invoice, revenuePipeline(r, groupBy), session);
  const changes = await aggregate(Invoice, [{ $match: { payment_status: 'paid', 'adjustments.approved_at': timeRange(r) } }, { $unwind: '$adjustments' }, { $match: { 'adjustments.approved_at': timeRange(r) } }, { $group: { _id: period('$adjustments.approved_at', groupBy), adjustments: { $sum: '$adjustments.amount' }, absoluteAdjustments: { $sum: { $abs: '$adjustments.amount' } } } }], session);
  // Reject imprecise intermediate sums even when positive/negative adjustments cancel.
  safeReportNumbers(changes);
  safeReportNumbers(changes.reduce((sum, row) => sum + row.absoluteAdjustments, 0));
  const cash = await aggregate(Booking, [...receiptStages(r), { $group: { _id: period('$payments.recorded_at', groupBy), ...cashFields } }], session);
  const buckets = new Map<string, RevenueTotals & { period: string }>();
  for (let day = r.from; day <= r.to; day = nextDay(day)) { const key = groupBy === 'month' ? day.slice(0, 7) : day; if (!buckets.has(key)) buckets.set(key, { period: key, ...emptyRevenue() }); }
  for (const record of originals) Object.assign(buckets.get(record._id)!, { invoiceCount: record.invoiceCount, roomTotal: record.roomTotal, serviceTotal: record.serviceTotal, discount: record.discount, invoiceTotal: record.invoiceTotal });
  for (const record of changes) buckets.get(record._id)!.adjustments = record.adjustments;
  for (const record of cash) Object.assign(buckets.get(record._id)!, { cashIn: record.cashIn, cashOut: record.cashOut });
  const totals = emptyRevenue();
  for (const row of buckets.values()) {
    row.revenue = row.invoiceTotal + row.adjustments; row.netCash = row.cashIn - row.cashOut;
    for (const key of Object.keys(totals) as (keyof RevenueTotals)[]) totals[key] += row[key];
  }
  const result = { ...r, groupBy, items: [...buckets.values()], totals }; safeReportNumbers(result); return result;
}

async function receipts(r: ReportPeriod, d: z.infer<typeof receiptsInput> & { employeeId?: string }, session: ClientSession): Promise<ReceiptsReport> {
  const rows = await aggregate(Booking, [...receiptStages(r, d), { $sort: { 'payments.recorded_at': -1, _id: -1, 'payments._id': -1 } }, { $facet: {
    totals: [{ $group: { _id: null, ...cashFields } }],
    items: [{ $skip: (d.page - 1) * d.limit }, { $limit: d.limit }, { $project: { _id: 0, id: { $toString: '$payments._id' }, bookingId: { $toString: '$_id' }, bookingCode: '$booking_code', at: '$payments.recorded_at', byId: { $toString: '$payments.recorded_by' }, by: { $ifNull: ['$payments.recorded_by_name', 'Chưa ghi tên'] }, kind: '$payments.kind', direction: '$payments.direction', amount: '$payments.amount', method: '$payments.method', reference: { $ifNull: ['$payments.reference', ''] }, reason: { $ifNull: ['$payments.reason', ''] } } }],
    byMethod: [{ $group: { _id: '$payments.method', ...cashFields } }, { $sort: { _id: 1 } }],
    byEmployee: [{ $group: { _id: '$payments.recorded_by', name: { $first: '$payments.recorded_by_name' }, ...cashFields } }, { $sort: { _id: 1 } }, { $limit: 200 }],
    employeeCount: [{ $group: { _id: '$payments.recorded_by' } }, { $count: 'count' }],
  } }], session);
  const data = rows[0], totals = cashTotals(data.totals[0]);
  const result = { ...r, items: data.items, total: totals.count, page: d.page, limit: d.limit, totals, byMethod: data.byMethod.map((m: { _id: string } & CashTotals) => ({ method: m._id, ...cashTotals(m) })), byEmployee: data.byEmployee.map((e: { _id: unknown; name?: string } & CashTotals) => ({ id: String(e._id), name: e.name || 'Chưa ghi tên', ...cashTotals(e) })), employeeCount: data.employeeCount[0]?.count || 0 };
  safeReportNumbers(result); return result;
}

async function services(r: ReportPeriod, mode: 'usage' | 'invoice', limit: number, session: ClientSession): Promise<TopServicesReport> {
  const field = mode === 'usage' ? 'services_used' : 'services_snapshot', prefix = '$' + field;
  const stages: PipelineStage[] = mode === 'usage'
    ? [{ $match: { status: { $in: ['checked_in', 'completed'] }, services_used: { $elemMatch: { used_at: timeRange(r), voided: { $ne: true } } } } }, { $unwind: '$services_used' }, { $match: { 'services_used.used_at': timeRange(r), 'services_used.voided': { $ne: true } } }]
    : [{ $match: { payment_status: 'paid', paid_at: timeRange(r) } }, { $unwind: '$services_snapshot' }, { $match: { 'services_snapshot.voided': { $ne: true } } }];
  const rows = await aggregate(mode === 'usage' ? Booking : Invoice, [...stages,
    { $sort: { [mode === 'usage' ? 'services_used.used_at' : 'paid_at']: 1, _id: 1 } },
    { $group: { _id: { serviceId: prefix + '.service_id', unit: { $ifNull: [prefix + '.unit', 'Chưa ghi đơn vị'] } }, name: { $last: prefix + '.service_name' }, quantity: { $sum: prefix + '.quantity' }, lines: { $sum: 1 }, amount: { $sum: prefix + '.amount' } } },
    { $facet: { items: [{ $sort: { [mode === 'usage' ? 'quantity' : 'amount']: -1, '_id.serviceId': 1, '_id.unit': 1 } }, { $limit: limit }], total: [{ $count: 'count' }] } }], session);
  const result = { ...r, mode, limit, total: rows[0].total[0]?.count || 0, items: rows[0].items.map((v: { _id: { serviceId: unknown; unit: string }; name: string; quantity: number; lines: number; amount: number }) => ({ id: String(v._id.serviceId) + ':' + v._id.unit, serviceId: String(v._id.serviceId), name: v.name, unit: v._id.unit, quantity: v.quantity, lines: v.lines, amount: v.amount })) };
  safeReportNumbers(result); return result;
}

async function customers(r: ReportPeriod, limit: number, session: ClientSession, customerId?: string): Promise<TopCustomersReport> {
  const range = timeRange(r), inRange = (field: string) => ({ $and: [{ $gte: [field, range.$gte] }, { $lt: [field, range.$lt] }] });
  const data = await aggregate(Invoice, [
    { $match: { payment_status: 'paid', ...(customerId ? { customer_id: new mongoose.Types.ObjectId(customerId) } : {}), $or: [{ paid_at: range }, { 'adjustments.approved_at': range }] } },
    { $project: { customer_id: 1, customer_name: 1, events: { $concatArrays: [
      { $cond: [inRange('$paid_at'), [{ at: '$paid_at', invoiceCount: 1, invoiceTotal: '$invoice_total', adjustments: 0 }], []] },
      { $map: { input: { $filter: { input: '$adjustments', as: 'a', cond: inRange('$$a.approved_at') } }, as: 'a', in: { at: '$$a.approved_at', invoiceCount: 0, invoiceTotal: 0, adjustments: '$$a.amount' } } },
    ] } } }, { $unwind: '$events' }, { $sort: { 'events.at': 1, _id: 1 } },
    { $group: { _id: '$customer_id', name: { $last: '$customer_name' }, invoiceCount: { $sum: '$events.invoiceCount' }, invoiceTotal: { $sum: '$events.invoiceTotal' }, adjustments: { $sum: '$events.adjustments' }, absoluteAdjustments: { $sum: { $abs: '$events.adjustments' } } } },
    { $set: { revenue: { $add: ['$invoiceTotal', '$adjustments'] } } },
    { $facet: { items: [{ $sort: { revenue: -1, _id: 1 } }, { $limit: limit }], total: [{ $count: 'count' }] } },
  ], session);
  safeReportNumbers(data);
  const result = { ...r, limit, total: data[0].total[0]?.count || 0, items: data[0].items.map((v: { _id: unknown; name: string; invoiceCount: number; invoiceTotal: number; adjustments: number; revenue: number }) => ({ id: String(v._id), name: v.name, invoiceCount: v.invoiceCount, invoiceTotal: v.invoiceTotal, adjustments: v.adjustments, revenue: v.revenue })) };
  safeReportNumbers(result); return result;
}

export function reportsRouter() {
  const router = Router();
  // Customer records are available to both roles; this is one customer's history,
  // not access to hotel-wide rankings or other employees' receipt summaries.
  router.get('/customers/:id/spending', async (req, res) => {
    const customerId = validId(req.params.id), now = new Date();
    z.object({}).strict().parse(req.query);
    const r: ReportPeriod = { from: '2000-01-01', to: hotelDay(now), asOf: now.toISOString(), timezone: 'Asia/Ho_Chi_Minh' };
    const result = await transaction(async session => {
      if (!await Customer.exists({ _id: customerId }).session(session)) throw new HttpError(404, 'Không tìm thấy khách hàng.');
      return (await customers(r, 1, session, customerId)).items[0];
    });
    res.json({ customerId, asOf: r.asOf, invoiceCount: result?.invoiceCount || 0, invoiceTotal: result?.invoiceTotal || 0, adjustments: result?.adjustments || 0, total: result?.revenue || 0 });
  });
  router.get('/reports/my-receipts', async (req, res) => {
    const d = receiptsInput.strict().parse(req.query), r = reportRange(d);
    res.json(await transaction(s => receipts(r, { ...d, employeeId: String(res.locals.user._id) }, s)));
  });
  router.use('/reports', adminOnly);
  router.get('/reports/revenue', async (req, res) => {
    const d = rangeInput.extend({ groupBy: z.enum(['day', 'month']).default('day') }).strict().parse(req.query), r = reportRange(d);
    res.json(await transaction(s => revenue(r, d.groupBy, s)));
  });
  router.get('/reports/cash-flow', async (req, res) => {
    const d = receiptsInput.extend({ employeeId: id.optional() }).strict().parse(req.query), r = reportRange(d);
    res.json(await transaction(s => receipts(r, d, s)));
  });
  router.get('/reports/top-services', async (req, res) => {
    const d = topInput.extend({ mode: z.enum(['usage', 'invoice']).default('invoice') }).strict().parse(req.query), r = reportRange(d);
    res.json(await transaction(s => services(r, d.mode, d.limit, s)));
  });
  router.get('/reports/top-customers', async (req, res) => {
    const d = topInput.strict().parse(req.query), r = reportRange(d);
    res.json(await transaction(s => customers(r, d.limit, s)));
  });
  router.get('/reports/occupancy', async (req, res) => {
    const d = rangeInput.extend({ typeId: id.optional() }).strict().parse(req.query), r = reportRange(d);
    res.json(await transaction(async s => {
      const bounds = timeRange(r);
      const rooms = await Room.find({ created_at: { $lt: bounds.$lt } }).select('created_at inventory_history unavailable_periods').limit(2501).session(s).lean().maxTimeMS(15000);
      const stays = await Booking.find({ status: { $in: ['checked_in', 'completed'] }, actual_check_in: { $lt: bounds.$lt }, $or: [{ status: 'checked_in' }, { actual_check_out: { $gt: bounds.$gte } }] }).select('status actual_check_in actual_check_out rooms_booked.room_id').limit(20001).session(s).lean().maxTimeMS(15000);
      if (rooms.length > 2500 || stays.length > 20000) throw new HttpError(413, 'Dữ liệu công suất quá lớn cho một lần xem. Hãy thu hẹp khoảng ngày hoặc liên hệ quản trị.');
      return calculateOccupancy(rooms, stays, r, d.typeId);
    }));
  });
  return router;
}
