import express from 'express';
import mongoose from 'mongoose';
import path from 'node:path';
import { config, production } from './config.js';
import { createApp } from './app.js';
import { initializeModels } from './models.js';
import { bootstrapProductionAdmin } from './bootstrap.js';

await mongoose.connect(config.mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 15000 });
await initializeModels();
if (production) await bootstrapProductionAdmin();
const { app, sessionStore } = createApp({ mongoUri: config.mongoUri, secret: config.secret, origin: config.origin, production, trustProxy: config.trustProxy });
app.use(express.static(path.resolve('dist/client')));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.resolve('dist/client/index.html')));
const server = app.listen(config.port, config.host, () => console.log(`Hotel web: ${config.origin}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  server.close(async () => { await sessionStore.close(); await mongoose.disconnect(); process.exit(0); });
});
