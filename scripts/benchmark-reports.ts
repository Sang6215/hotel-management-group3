// Synthetic, isolated replica set only. No dotenv, MONGODB_URI, Atlas or application data.
import mongoose from 'mongoose';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { Booking, Invoice, initializeModels } from '../server/models.js';
import { reportRange, revenuePipeline, receiptsMatch } from '../server/reports.js';

const mongo = await MongoMemoryReplSet.create({ binary: { version: '8.0.15', downloadDir: path.resolve('.local/mongodb-binaries') }, replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
try {
  await mongoose.connect(mongo.getUri('hotel_week5_benchmark')); await initializeModels();
  const employee = new mongoose.Types.ObjectId();
  const rows = Array.from({ length: 5000 }, (_, i) => {
    const when = new Date(Date.parse('2026-01-01T12:00:00+07:00') + (i % 100) * 86400000);
    return { i, id: new mongoose.Types.ObjectId(), when };
  });
  // Minimal query-shape fixtures: measure indexes, not full business workflows.
  await Booking.collection.insertMany(rows.map(({ i, id, when }) => ({ _id: id, booking_code: `BENCH-${i}`, status: 'completed', payments: [{ _id: new mongoose.Types.ObjectId(), recorded_at: when, recorded_by: employee, amount: 600000, direction: 'in', method: 'cash', kind: 'checkout' }] })));
  await Invoice.collection.insertMany(rows.map(({ i, id, when }) => ({ invoice_code: `BENCH-HD-${i}`, booking_id: id, payment_status: 'paid', paid_at: when, total_room_charge: 600000, total_service_charge: 0, discount_amount: 0, invoice_total: 600000, adjustments: [] })));
  const r = reportRange({ from: '2026-02-01', to: '2026-02-01' });
  const invFilter = (revenuePipeline(r, 'day')[0] as { $match: object }).$match;
  const payFilter = { payments: { $elemMatch: receiptsMatch(r, { employeeId: String(employee) }) } };
  const checks = [];
  for (const [name, model, filter, index] of [
    ['Invoices paid_at', Invoice, invFilter, { payment_status: 1, paid_at: -1 }],
    ['Bookings personal receipts', Booking, payFilter, { 'payments.recorded_by': 1, 'payments.recorded_at': 1 }],
  ] as const) {
    for (const [mode, hint] of [['collection scan', { $natural: 1 }], ['index', index]] as const) {
      const explain = await model.collection.find(filter).hint(hint).explain('executionStats');
      const stats = explain.executionStats;
      checks.push({ name, mode, returned: stats.nReturned, docsExamined: stats.totalDocsExamined, keysExamined: stats.totalKeysExamined, executionMs: stats.executionTimeMillis });
      if (stats.nReturned !== 50 || (mode === 'index' && stats.totalDocsExamined > 100)) throw new Error('Unexpected benchmark selectivity or index plan');
    }
  }
  // Five concurrent DB workloads, deliberately not presented as HTTP/Render latency.
  await Invoice.aggregate(revenuePipeline(r, 'day'));
  const latency = await Promise.all(Array.from({ length: 5 }, async () => {
    const start = performance.now();
    const revenue = await Invoice.aggregate(revenuePipeline(r, 'day'));
    const receipts = await Booking.find(payFilter).lean();
    if (revenue[0].invoiceTotal !== 30000000 || receipts.length !== 50) throw new Error('Incorrect aggregate result');
    return Math.round((performance.now() - start) * 100) / 100;
  }));
  console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, mongodb: '8.0.15', os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 1073741824), bookings: 5000, invoices: 5000, selection: r, checks, concurrentDatabaseLatencyMs: latency }, null, 2));
} finally {
  await mongoose.disconnect(); await mongo.stop();
}
