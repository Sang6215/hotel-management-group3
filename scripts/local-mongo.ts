import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function startLocalMongo() {
  const dbPath = path.resolve('.local/mongo');
  await mkdir(dbPath, { recursive: true });
  return MongoMemoryReplSet.create({
    binary: { version: '8.0.15', downloadDir: path.resolve('.local/mongodb-binaries') },
    instanceOpts: [{ port: 27027, dbPath }],
    replSet: { name: 'hotel-local', count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
  });
}
