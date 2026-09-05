import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../server/config.js';

await mongoose.connect(config.mongoUri);
const db = mongoose.connection.db!;
const hello = await db.admin().command({ hello: 1 });
if (!hello.setName) throw new Error('MongoDB is not a replica set.');
const probes = db.collection('_phase1_probe');
await probes.createIndex({ marker: 1 });
const marker = randomUUID();
const s = await mongoose.startSession();
try {
  try {
    await s.withTransaction(async () => { await probes.insertOne({ marker }, { session: s }); throw new Error('intentional-rollback'); });
  } catch (error) { if (!(error instanceof Error) || error.message !== 'intentional-rollback') throw error; }
  if (await probes.findOne({ marker })) throw new Error('Rollback verification failed.');
  await s.withTransaction(async () => { await probes.insertOne({ marker }, { session: s }); });
  if (!await probes.findOne({ marker })) throw new Error('Commit verification failed.');
  console.log(JSON.stringify({ replicaSet: hello.setName, rollback: 'PASS', commit: 'PASS', collections: (await db.listCollections().toArray()).map(c => c.name) }, null, 2));
} finally {
  // Delete only this run's diagnostic record; no application data is touched.
  await probes.deleteOne({ marker });
  await s.endSession();
  await mongoose.disconnect();
}
