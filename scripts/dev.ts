import 'dotenv/config';
import mongoose from 'mongoose';
import { createServer } from 'vite';
import { startLocalMongo } from './local-mongo.js';
import { config } from '../server/config.js';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/seed.js';
import { initializeModels } from '../server/models.js';

const local = !process.env.MONGODB_URI;
console.log(local ? 'Preparing local MongoDB replica set; first run downloads MongoDB.' : 'Connecting to configured MongoDB.');
const mongo = local ? await startLocalMongo() : undefined;
await mongoose.connect(config.mongoUri);
if (local) await seedDemo(); else await initializeModels();
const { app, sessionStore } = createApp({ mongoUri: config.mongoUri, secret: config.secret, origin: config.origin, demo: local });
const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
app.use(vite.middlewares);
const server = app.listen(config.port, config.host, () => console.log(`Hotel web ready: ${config.origin}`));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await vite.close();
  await sessionStore.close();
  await mongoose.disconnect();
  await mongo?.stop({ doCleanup: false, force: false });
  process.exit(0);
}
server.on('error', async (error) => { console.error(error.message); await stop(); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
