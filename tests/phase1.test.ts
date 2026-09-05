import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { createApp } from '../server/app.js';
import { Booking, Room, User } from '../server/models.js';
import { seedDemo } from '../server/seed.js';

let mongo: MongoMemoryReplSet;
let system: ReturnType<typeof createApp>;
const origin = 'http://127.0.0.1:5173';
beforeAll(async () => {
  // A separate temporary replica set. Never uses the developer's database or .env URI.
  mongo = await MongoMemoryReplSet.create({ binary: { version: '8.0.15', downloadDir: path.resolve('.local/mongodb-binaries') }, replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  const uri = mongo.getUri('hotel_phase1_tests');
  await mongoose.connect(uri);
  await seedDemo();
  system = createApp({ mongoUri: uri, secret: 'test-only-secret-that-is-at-least-32-characters', origin, demo: true });
});
afterAll(async () => { await system?.sessionStore.close(); await mongoose.disconnect(); await mongo?.stop(); });

async function login(username = 'admin', password = 'AdminDemo2026!') {
  const agent = request.agent(system.app);
  const before = await agent.get('/api/v1/auth/csrf').expect(200);
  const response = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', before.body.csrfToken).set('Origin', origin).send({ username, password }).expect(200);
  return { agent, csrf: response.body.csrfToken as string, response, before };
}

describe('Phase 1 authentication and foundation', () => {
  it('creates eight business collections and reads persisted room seed', async () => {
    const names = (await mongoose.connection.db!.listCollections().toArray()).map(c => c.name);
    for (const name of ['users', 'room_types', 'rooms', 'customers', 'services', 'bookings', 'promotions', 'invoices']) expect(names).toContain(name);
    expect(await Room.countDocuments()).toBe(12);
  });
  it('rejects unauthenticated access to protected data', async () => {
    for (const route of ['/auth/me', '/users', '/rooms', '/overview']) await request(system.app).get('/api/v1' + route).expect(401);
  });
  it('rejects missing, malformed and foreign-origin CSRF submissions', async () => {
    const agent = request.agent(system.app);
    const pre = await agent.get('/api/v1/auth/csrf');
    const body = { username: 'admin', password: 'AdminDemo2026!' };
    await agent.post('/api/v1/auth/login').send(body).expect(403);
    await agent.post('/api/v1/auth/login').set('X-CSRF-Token', 'é'.repeat(64)).send(body).expect(403);
    await agent.post('/api/v1/auth/login').set('X-CSRF-Token', pre.body.csrfToken).set('Origin', 'https://foreign.example').send(body).expect(403);
  });
  it('rejects incorrect passwords with no credential details', async () => {
    const agent = request.agent(system.app);
    const pre = await agent.get('/api/v1/auth/csrf');
    const r = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', pre.body.csrfToken).send({ username: 'admin', password: 'wrong' }).expect(401);
    expect(JSON.stringify(r.body)).not.toContain('hash');
  });
  it('rotates session and CSRF on login and uses HttpOnly SameSite cookies', async () => {
    const { agent, csrf, response, before } = await login();
    expect(csrf).not.toBe(before.body.csrfToken);
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
    expect(response.headers['set-cookie']).not.toEqual(before.headers['set-cookie']);
    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.role).toBe('admin');
    expect(JSON.stringify(me.body)).not.toMatch(/password|session_version/);
    expect(me.headers['cache-control']).toBe('no-store');
  });
  it('blocks staff at the API even if frontend controls are bypassed', async () => {
    const { agent, csrf } = await login('letan', 'LetanDemo2026!');
    await agent.get('/api/v1/users').expect(403);
    await agent.post('/api/v1/users').set('X-CSRF-Token', csrf).send({ username: 'illegal', fullName: 'Forbidden', role: 'admin', password: 'Password2026!' }).expect(403);
    await agent.get('/api/v1/rooms').expect(200);
  });
  it('creates users, validates input, prevents duplicate usernames and hides hashes', async () => {
    const { agent, csrf } = await login();
    const body = { username: 'new_staff', fullName: 'Test Staff', role: 'staff', password: 'StaffPassword2026!' };
    const created = await agent.post('/api/v1/users').set('X-CSRF-Token', csrf).send(body).expect(201);
    expect(created.body.user.username).toBe('new_staff');
    expect(JSON.stringify(created.body)).not.toContain('password');
    await agent.post('/api/v1/users').set('X-CSRF-Token', csrf).send(body).expect(409);
    await agent.post('/api/v1/users').set('X-CSRF-Token', csrf).send({ ...body, username: 'bad_password', password: '123' }).expect(400);
    await agent.post('/api/v1/users').set('X-CSRF-Token', csrf).send({ ...body, role: 'owner' }).expect(400);
    const stored = await User.findOne({ username: 'new_staff' }).select('+password_hash');
    expect(stored!.password_hash).not.toBe(body.password); expect(stored!.password_hash).toMatch(/^\$2/);
  });
  it('locking staff invalidates existing sessions and unlocking does not restore them', async () => {
    const { agent: admin, csrf } = await login();
    const { agent: staff } = await login('letan', 'LetanDemo2026!');
    const user = await User.findOne({ username: 'letan' });
    await admin.patch(`/api/v1/users/${user!._id}/status`).set('X-CSRF-Token', csrf).send({ status: 'locked' }).expect(200);
    await staff.get('/api/v1/auth/me').expect(401);
    const lockedAgent = request.agent(system.app);
    const pre = await lockedAgent.get('/api/v1/auth/csrf');
    await lockedAgent.post('/api/v1/auth/login').set('X-CSRF-Token', pre.body.csrfToken).send({ username: 'letan', password: 'LetanDemo2026!' }).expect(401);
    await admin.patch(`/api/v1/users/${user!._id}/status`).set('X-CSRF-Token', csrf).send({ status: 'active' }).expect(200);
    await staff.get('/api/v1/auth/me').expect(401);
    await login('letan', 'LetanDemo2026!');
  });
  it('prevents locking administrator accounts and validates record IDs', async () => {
    const { agent, csrf, response } = await login();
    await agent.patch(`/api/v1/users/${response.body.user.id}/status`).set('X-CSRF-Token', csrf).send({ status: 'locked' }).expect(403);
    await agent.patch('/api/v1/users/not-an-id/status').set('X-CSRF-Token', csrf).send({ status: 'locked' }).expect(400);
  });
  it('changing password revokes other sessions and rotates current session', async () => {
    const { agent: a, csrf } = await login('new_staff', 'StaffPassword2026!');
    const { agent: b } = await login('new_staff', 'StaffPassword2026!');
    await a.post('/api/v1/auth/password').set('X-CSRF-Token', csrf).send({ currentPassword: 'wrong', newPassword: 'UpdatedPassword2026!' }).expect(400);
    const changed = await a.post('/api/v1/auth/password').set('X-CSRF-Token', csrf).send({ currentPassword: 'StaffPassword2026!', newPassword: 'UpdatedPassword2026!' }).expect(200);
    expect(changed.body.csrfToken).not.toBe(csrf);
    await a.get('/api/v1/auth/me').expect(200); await b.get('/api/v1/auth/me').expect(401);
    await login('new_staff', 'UpdatedPassword2026!');
  });
  it('logout destroys session so it cannot be reused', async () => {
    const { agent, csrf } = await login();
    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf).send({}).expect(200);
    await agent.get('/api/v1/auth/me').expect(401);
  });
  it('returns real counts and bounded account pagination', async () => {
    const { agent } = await login();
    const overview = await agent.get('/api/v1/overview').expect(200);
    expect(overview.body).toMatchObject({ rooms: 12, roomTypes: 3, customers: 3, bookings: 0, phase: 2 });
    const page = await agent.get('/api/v1/users?page=1&limit=1').expect(200);
    expect(page.body.items).toHaveLength(1); expect(page.body.total).toBe(3);
    await agent.get('/api/v1/users?limit=500').expect(400);
  });
  it('demo seeding is idempotent and preserves existing changes', async () => {
    await User.updateOne({ username: 'letan' }, { $set: { full_name: 'Preserved name' } });
    await seedDemo();
    expect(await User.countDocuments()).toBe(3); expect(await Room.countDocuments()).toBe(12);
    expect((await User.findOne({ username: 'letan' }))!.full_name).toBe('Preserved name');
  });
  it('a replica-set transaction rolls back all writes and can commit', async () => {
    const collection = mongoose.connection.db!.collection('transaction_test');
    await collection.createIndex({ marker: 1 });
    const s = await mongoose.startSession();
    try {
      await expect(s.withTransaction(async () => { await collection.insertOne({ marker: 'rollback' }, { session: s }); await collection.insertOne({ marker: 'rollback2' }, { session: s }); throw new Error('stop'); })).rejects.toThrow('stop');
      expect(await collection.countDocuments()).toBe(0);
      await s.withTransaction(async () => { await collection.insertOne({ marker: 'commit' }, { session: s }); });
      expect(await collection.countDocuments()).toBe(1);
    } finally { await s.endSession(); }
  });
  it('booking foundation validates reversed dates and duplicate rooms', async () => {
    const id = new mongoose.Types.ObjectId();
    const line = { room_id: id, room_number: '101', room_type_id: id, room_type_name: 'Standard', price_per_night: 600000, guest_count: 2 };
    const booking = new Booking({ booking_code: 'INVALID', customer_id: id, customer_snapshot: { full_name: 'Test', phone: '0900000000', id_card: 'TEST0001' }, rooms_booked: [line, line], check_in_plan: new Date('2026-09-12'), check_out_plan: new Date('2026-09-10'), created_by: id });
    await expect(booking.validate()).rejects.toThrow();
    expect(await Booking.countDocuments()).toBe(0);
  });
});
