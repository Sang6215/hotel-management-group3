import path from 'node:path';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../server/app.js';
import { initializeModels, Room, Service, User } from '../server/models.js';
import { seedDemo } from '../server/seed.js';
import { DataToolsPage } from '../client/src/data-tools.js';
import type { DataImportResult, DataSummary, Overview, RoomView, UserView } from '../shared/types.js';

const ORIGIN = 'http://127.0.0.1:5173';

class TestClient {
  private cookie = '';
  private csrf = '';
  constructor(private readonly baseUrl: string) {}

  private captureCookie(res: Response) {
    const rawList = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];
    const sid = rawList.find(c => c.startsWith('hotel.sid='));
    if (sid) this.cookie = sid.split(';')[0];
  }

  async ensureCsrf() {
    if (this.csrf) return;
    const res = await fetch(`${this.baseUrl}/api/v1/auth/csrf`, {
      headers: this.cookie ? { Cookie: this.cookie } : {},
    });
    this.captureCookie(res);
    const body = (await res.json()) as { csrfToken: string };
    this.csrf = body.csrfToken;
  }

  async login(username: string, password: string) {
    await this.ensureCsrf();
    const { status, data } = await this.json<{ user: UserView; csrfToken: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    expect(status).toBe(200);
    this.csrf = data.csrfToken;
    return data.user;
  }

  async logout() {
    const res = await this.raw('/api/v1/auth/logout', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    this.cookie = '';
    this.csrf = '';
  }

  async raw(urlPath: string, init: RequestInit = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {
      ...(this.cookie ? { Cookie: this.cookie } : {}),
    };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      headers.Origin = ORIGIN;
      if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    }
    const res = await fetch(`${this.baseUrl}${urlPath}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
    this.captureCookie(res);
    return res;
  }

  async json<T>(urlPath: string, init: RequestInit = {}) {
    const res = await this.raw(urlPath, init);
    const data = (await res.json()) as T;
    return { status: res.status, data, headers: res.headers };
  }
}

describe('Admin data tools, mark-ready, overview & DataToolsPage UI', () => {
  let mongo: MongoMemoryReplSet;
  let server: Server;
  let closeSessionStore: () => Promise<void>;
  let baseUrl = '';
  let sampleRoom: RoomView;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      binary: { version: '8.0.15', downloadDir: path.resolve('.local/mongodb-binaries') },
      replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
    });
    await mongoose.connect(mongo.getUri());
    await initializeModels();
    await seedDemo();

    const created = createApp({
      mongoUri: mongo.getUri(),
      secret: 'test-secret-for-data-tools-32chars!',
      origin: ORIGIN,
      demo: true,
    });
    closeSessionStore = () => created.sessionStore.close();

    await new Promise<void>(resolve => {
      server = created.app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    const client = new TestClient(baseUrl);
    await client.login('admin', 'AdminDemo2026!');
    const rooms = await client.json<{ items: RoomView[] }>('/api/v1/rooms?limit=50');
    expect(rooms.status).toBe(200);
    sampleRoom = rooms.data.items[0];
    await client.logout();
  });

  afterAll(async () => {
    await closeSessionStore?.();
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('rejects unauthenticated and staff access to admin data tools and mark-ready', async () => {
    const anon = new TestClient(baseUrl);
    expect((await anon.raw('/api/v1/data/summary')).status).toBe(401);

    const staff = new TestClient(baseUrl);
    await staff.login('letan', 'LetanDemo2026!');
    expect((await staff.raw('/api/v1/data/summary')).status).toBe(403);
    expect((await staff.raw('/api/v1/data/export?collection=rooms&format=json')).status).toBe(403);
    expect((await staff.raw('/api/v1/data/backup')).status).toBe(403);
    expect((await staff.raw('/api/v1/data/restore', { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await staff.raw('/api/v1/data/import', { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await staff.raw(`/api/v1/rooms/${sampleRoom.id}/mark-ready`, {
      method: 'POST',
      body: JSON.stringify({ version: sampleRoom.version }),
    })).status).toBe(403);
    await staff.logout();
  });

  it('returns collection counts, enriched overview KPIs, and marks cleaning rooms ready', async () => {
    const admin = new TestClient(baseUrl);
    await admin.login('admin', 'AdminDemo2026!');

    const summary = await admin.json<DataSummary>('/api/v1/data/summary');
    expect(summary.status).toBe(200);
    expect(summary.data.counts).toMatchObject({
      room_types: 3,
      rooms: 12,
      customers: 3,
      services: 6,
      users: 2,
    });

    const nonCleaningRes = await admin.json<{ message: string }>(`/api/v1/rooms/${sampleRoom.id}/mark-ready`, {
      method: 'POST',
      body: JSON.stringify({ version: sampleRoom.version }),
    });
    expect(nonCleaningRes.status).toBe(409);

    await Room.updateOne({ _id: sampleRoom.id }, { $set: { status: 'cleaning' } });

    const dirtyOverview = await admin.json<Overview>('/api/v1/overview');
    expect(dirtyOverview.status).toBe(200);
    expect(dirtyOverview.data).toMatchObject({
      rooms: 12,
      available: 11,
      occupied: 0,
      cleaning: 1,
      maintenance: 0,
      todayArrivals: 0,
      todayDepartures: 0,
      pendingRefunds: 0,
      activeBookings: 0,
      phase: 5,
      demo: true,
    });

    const readyRes = await admin.json<{ item: RoomView }>(`/api/v1/rooms/${sampleRoom.id}/mark-ready`, {
      method: 'POST',
      body: JSON.stringify({ version: sampleRoom.version }),
    });
    expect(readyRes.status).toBe(200);
    expect(readyRes.data.item.status).toBe('available');

    const cleanOverview = await admin.json<Overview>('/api/v1/overview');
    expect(cleanOverview.status).toBe(200);
    expect(cleanOverview.data.cleaning).toBe(0);
    expect(cleanOverview.data.available).toBe(12);
    await admin.logout();
  });

  it('imports catalogs safely, guards CSV exports with BOM, and strips secrets from users export', async () => {
    const admin = new TestClient(baseUrl);
    await admin.login('admin', 'AdminDemo2026!');

    const svcImport = await admin.json<DataImportResult>('/api/v1/data/import', {
      method: 'POST',
      body: JSON.stringify({
        collection: 'services',
        items: [
          { code: 'LAUNDRY_VIP', name: 'Giặt ủi nhanh', category: 'Giặt là', unit: 'Lượt', price: 90000, status: 'active' },
          { code: 'FORMULA_TEST', name: '=SUM(A1:A2)', category: '+Formula', unit: 'Lần', price: 10000, status: 'active' },
          { code: 'LAUNDRY_VIP', name: 'Trùng mã', category: '', unit: 'Lượt', price: 90000, status: 'active' },
          { code: 'bad code!', name: '', unit: 'Lượt', price: -5 },
        ],
      }),
    });
    expect(svcImport.status).toBe(200);
    expect(svcImport.data.total).toBe(4);
    expect(svcImport.data.inserted).toBe(2);
    expect(svcImport.data.skipped).toBe(1);
    expect(svcImport.data.errors).toHaveLength(1);
    expect(svcImport.data.errors[0].index).toBe(3);

    const roomImport = await admin.json<DataImportResult>('/api/v1/data/import', {
      method: 'POST',
      body: JSON.stringify({
        collection: 'rooms',
        items: [
          { number: '499', floor: 4, typeCode: 'NO_SUCH_TYPE', status: 'available', active: true },
          { number: '401', floor: 4, typeCode: 'STANDARD', status: 'available', active: true },
        ],
      }),
    });
    expect(roomImport.status).toBe(200);
    expect(roomImport.data.inserted).toBe(1);
    expect(roomImport.data.errors).toEqual([{ index: 0, message: 'Không tìm thấy loại phòng mã NO_SUCH_TYPE.' }]);
    expect(await Room.exists({ room_number: '401' })).toBeTruthy();

    const promoImport = await admin.json<DataImportResult>('/api/v1/data/import', {
      method: 'POST',
      body: JSON.stringify({
        collection: 'promotions',
        items: [{ code: 'FALL20', type: 'percentage', value: 20, maxDiscount: 500000, minAmount: 300000, startsOn: '2026-11-01', endsOn: '2026-12-31', status: 'active' }],
      }),
    });
    expect(promoImport.status).toBe(200);
    expect(promoImport.data.inserted).toBe(1);

    const csvRes = await admin.raw('/api/v1/data/export?collection=services&format=csv');
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toContain('text/csv');
    const csvBuf = Buffer.from(await csvRes.arrayBuffer());
    expect([...csvBuf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = csvBuf.toString('utf8');
    expect(csvText).toContain('"\'=SUM(A1:A2)"');
    expect(csvText).toContain('"\'+Formula"');

    const usersRes = await admin.raw('/api/v1/data/export?collection=users&format=json');
    expect(usersRes.status).toBe(200);
    expect(usersRes.headers.get('content-type')).toContain('application/json');
    const exportedUsers = JSON.parse(await usersRes.text()) as Record<string, unknown>[];
    expect(exportedUsers.length).toBeGreaterThanOrEqual(2);
    for (const u of exportedUsers) {
      expect(u).not.toHaveProperty('password_hash');
      expect(u).not.toHaveProperty('session_version');
    }
    await admin.logout();
  });

  it('creates checksum-verified backup snapshots, rejects tampered restores, and restores atomically', async () => {
    const admin = new TestClient(baseUrl);
    await admin.login('admin', 'AdminDemo2026!');

    const backupRes = await admin.json<{
      format: string;
      version: number;
      exportedAt: string;
      exportedBy: string;
      counts: Record<string, number>;
      checksum: string;
      collections: Record<string, Record<string, unknown>[]>;
    }>('/api/v1/data/backup');

    expect(backupRes.status).toBe(200);
    const backup = backupRes.data;
    expect(backup.format).toBe('hotel-desk-backup-v1');
    expect(backup.version).toBe(1);
    expect(backup.exportedBy).toBe('admin');
    expect(backup.checksum).toMatch(/^[a-f0-9]{64}$/);
    const expectedHash = createHash('sha256').update(JSON.stringify(backup.collections)).digest('hex');
    expect(backup.checksum).toBe(expectedHash);
    expect(backup.counts.services).toBeGreaterThanOrEqual(8);
    expect(backup.counts.rooms).toBe(13);

    await Service.deleteOne({ service_code: 'LAUNDRY_VIP' });
    await Room.deleteOne({ room_number: '401' });
    expect(await Service.exists({ service_code: 'LAUNDRY_VIP' })).toBeFalsy();
    expect(await Room.exists({ room_number: '401' })).toBeFalsy();

    const wrongConfirm = await admin.json<{ message: string }>('/api/v1/data/restore', {
      method: 'POST',
      body: JSON.stringify({ backup, confirm: 'NO' }),
    });
    expect(wrongConfirm.status).toBe(400);

    const tampered = structuredClone(backup);
    tampered.collections.services[0].name = 'Tampered';
    const tamperedRes = await admin.json<{ message: string }>('/api/v1/data/restore', {
      method: 'POST',
      body: JSON.stringify({ backup: tampered, confirm: 'RESTORE' }),
    });
    expect(tamperedRes.status).toBe(400);
    expect(tamperedRes.data.message).toContain('checksum');
    expect(await Service.exists({ service_code: 'LAUNDRY_VIP' })).toBeFalsy();

    const badCount = structuredClone(backup);
    badCount.counts.services = 999;
    const badCountRes = await admin.json<{ message: string }>('/api/v1/data/restore', {
      method: 'POST',
      body: JSON.stringify({ backup: badCount, confirm: 'RESTORE' }),
    });
    expect(badCountRes.status).toBe(400);

    const restored = await admin.json<{ message: string; counts: Record<string, number> }>('/api/v1/data/restore', {
      method: 'POST',
      body: JSON.stringify({ backup, confirm: 'RESTORE' }),
    });
    expect(restored.status).toBe(200);
    expect(await Service.exists({ service_code: 'LAUNDRY_VIP' })).toBeTruthy();
    expect(await Room.exists({ room_number: '401' })).toBeTruthy();
    expect(await User.countDocuments()).toBe(2);

    const meRes = await admin.json<{ user: UserView }>('/api/v1/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.data.user.username).toBe('admin');
    await admin.logout();
  });

  it('allows payloads larger than 32kb on /data/import and renders DataToolsPage for admin vs staff', async () => {
    const admin = new TestClient(baseUrl);
    await admin.login('admin', 'AdminDemo2026!');

    const bulkTypes = Array.from({ length: 60 }, (_, idx) => ({
      code: `BULK_TYPE_${idx + 1}`,
      name: `Loại phòng thử nghiệm ${idx + 1}`,
      price: 550000 + idx * 10000,
      capacity: 2,
      amenities: ['Wi-Fi', 'Điều hòa'],
      description: 'X'.repeat(700),
      status: 'active',
    }));
    const payload = JSON.stringify({ collection: 'room_types', items: bulkTypes });
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(40 * 1024);

    const importRes = await admin.json<DataImportResult>('/api/v1/data/import', {
      method: 'POST',
      body: payload,
    });
    expect(importRes.status).toBe(200);
    expect(importRes.data.inserted).toBe(60);
    expect(importRes.data.errors).toEqual([]);
    await admin.logout();

    const staffHtml = renderToStaticMarkup(createElement(DataToolsPage, {
      user: { id: '2', username: 'letan', fullName: 'Lễ tân', role: 'staff', status: 'active', createdAt: '2026-11-20T00:00:00.000Z' },
    }));
    expect(staffHtml).toContain('Bạn không có quyền truy cập');

    const adminHtml = renderToStaticMarkup(createElement(DataToolsPage, {
      user: { id: '1', username: 'admin', fullName: 'Quản trị', role: 'admin', status: 'active', createdAt: '2026-11-20T00:00:00.000Z' },
    }));
    expect(adminHtml).toContain('Sao lưu, khôi phục &amp; xuất/nhập MongoDB');
    expect(adminHtml).toContain('Xuất dữ liệu từng collection');
    expect(adminHtml).toContain('RESTORE');
  });
});
