import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import { z, ZodError } from 'zod';
import { Booking, Customer, Room, RoomType, User } from './models.js';
import type { Role, UserView } from '../shared/types.js';
import { HttpError, validId } from './http.js';
import { operationsRouter } from './operations.js';
import { reservationsRouter } from './reservations.js';

declare module 'express-session' {
  interface SessionData { userId?: string; userVersion?: number; csrf?: string }
}

type AppOptions = { mongoUri: string; secret: string; origin: string; production?: boolean; trustProxy?: boolean; demo?: boolean };
const credentials = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,40}$/), password: z.string().min(1).max(72) });
const newPassword = z.string().min(12, 'Mật khẩu cần ít nhất 12 ký tự.').max(72).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Mật khẩu quá dài.');
const createUserInput = z.object({
  username: credentials.shape.username,
  password: newPassword,
  fullName: z.string().trim().min(2).max(100), role: z.enum(['admin', 'staff']),
}).strict();
const dummyHash = bcrypt.hashSync('invalid-login-comparison-only', 12);
const token = () => randomBytes(32).toString('hex');
const publicUser = (user: { _id: unknown; username: string; full_name: string; role: string; status?: string | null; created_at: Date }): UserView => ({
  id: String(user._id), username: user.username, fullName: user.full_name,
  role: user.role as Role, status: user.status === 'locked' ? 'locked' : 'active', createdAt: user.created_at.toISOString(),
});

export function createApp(options: AppOptions) {
  const app = express();
  if (options.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: options.production ? undefined : false, strictTransportSecurity: options.production ? undefined : false }));
  app.use(express.json({ limit: '32kb' }));
  const sessionStore = MongoStore.create({ mongoUrl: options.mongoUri, collectionName: 'sessions', ttl: 8 * 3600, mongoOptions: { maxPoolSize: 5, serverSelectionTimeoutMS: 15000 } });
  sessionStore.on('error', () => console.error('Session database is unavailable.'));
  const cookie = { httpOnly: true, secure: !!options.production, sameSite: 'strict' as const, path: '/', maxAge: 8 * 3600 * 1000 };
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', session({ name: 'hotel.sid', secret: options.secret, store: sessionStore, resave: false, saveUninitialized: false, cookie }));

  app.get('/api/v1/health', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', phase: 3 });
  });
  app.get('/api/v1/auth/csrf', (req, res) => {
    req.session.csrf ||= token();
    res.json({ csrfToken: req.session.csrf });
  });
  const allowedOrigins = new Set([options.origin]);
  if (!options.production) {
    const alias = new URL(options.origin);
    if (['localhost', '127.0.0.1'].includes(alias.hostname)) {
      alias.hostname = alias.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      allowedOrigins.add(alias.origin);
    }
  }
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!req.is('application/json')) throw new HttpError(415, 'Yêu cầu cần dữ liệu JSON.');
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) throw new HttpError(403, 'Nguồn yêu cầu không được phép.');
    const incoming = req.get('x-csrf-token') || '';
    const expected = req.session.csrf || '';
    if (!expected || Buffer.byteLength(incoming) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(incoming), Buffer.from(expected))) {
      throw new HttpError(403, 'Phiên bảo vệ đã thay đổi. Vui lòng tải lại trang.');
    }
    next();
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true, message: { message: 'Đăng nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.' } });
  app.post('/api/v1/auth/login', loginLimiter, async (req, res) => {
    const data = credentials.parse(req.body);
    const user = await User.findOne({ username: data.username }).select('+password_hash');
    const matches = await bcrypt.compare(data.password, user?.password_hash || dummyHash);
    if (!user || !matches || user.status !== 'active') throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.');
    await new Promise<void>((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.userId = String(user._id);
    req.session.userVersion = user.session_version;
    req.session.csrf = token();
    await new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
    res.json({ user: publicUser(user), csrfToken: req.session.csrf });
  });

  app.use('/api/v1', async (req, res, next) => {
    if (!req.session.userId) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
    const user = await User.findById(req.session.userId);
    if (!user || user.status !== 'active' || user.session_version !== req.session.userVersion) {
      await new Promise<void>((resolve, reject) => req.session.destroy(e => e ? reject(e) : resolve()));
      res.clearCookie('hotel.sid', { path: '/', secure: cookie.secure, httpOnly: true, sameSite: 'strict' });
      throw new HttpError(401, 'Phiên đăng nhập đã hết hiệu lực.');
    }
    res.locals.user = user;
    next();
  });
  app.get('/api/v1/auth/me', (req, res) => res.json({ user: publicUser(res.locals.user), csrfToken: req.session.csrf }));
  app.post('/api/v1/auth/logout', async (req, res) => {
    await new Promise<void>((resolve, reject) => req.session.destroy(e => e ? reject(e) : resolve()));
    res.clearCookie('hotel.sid', { path: '/', secure: cookie.secure, httpOnly: true, sameSite: 'strict' });
    res.json({ message: 'Đã đăng xuất.' });
  });
  app.post('/api/v1/auth/password', async (req, res) => {
    const data = z.object({ currentPassword: z.string().min(1).max(72), newPassword }).strict().parse(req.body);
    const user = await User.findById(req.session.userId).select('+password_hash');
    if (!user || !await bcrypt.compare(data.currentPassword, user.password_hash)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng.');
    user.password_hash = await bcrypt.hash(data.newPassword, 12);
    user.session_version += 1;
    await user.save();
    await new Promise<void>((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.userId = String(user._id);
    req.session.userVersion = user.session_version;
    req.session.csrf = token();
    await new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
    res.json({ message: 'Đã đổi mật khẩu. Các phiên đăng nhập khác đã kết thúc.', csrfToken: req.session.csrf });
  });
  app.get('/api/v1/overview', async (_req, res) => {
    const [rooms, available, customers, bookings, roomTypes] = await Promise.all([
      Room.countDocuments({ active: true }), Room.countDocuments({ active: true, status: 'available' }),
      Customer.countDocuments(), Booking.countDocuments(), RoomType.countDocuments({ status: 'active' }),
    ]);
    res.json({ rooms, available, customers, bookings, roomTypes, phase: 3, demo: !!options.demo });
  });
  app.use('/api/v1', operationsRouter());
  app.use('/api/v1', reservationsRouter());
  app.use('/api/v1/users', (_req, res, next) => {
    if (res.locals.user.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên được quản lý tài khoản.');
    next();
  });
  app.get('/api/v1/users', async (req, res) => {
    const { page, limit } = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
    const [items, total] = await Promise.all([User.find().sort({ created_at: 1, _id: 1 }).skip((page - 1) * limit).limit(limit), User.countDocuments()]);
    res.json({ items: items.map(publicUser), total, page, limit });
  });
  app.post('/api/v1/users', async (req, res) => {
    const data = createUserInput.parse(req.body);
    const user = await User.create({ username: data.username, full_name: data.fullName, password_hash: await bcrypt.hash(data.password, 12), role: data.role });
    res.status(201).json({ user: publicUser(user) });
  });
  app.patch('/api/v1/users/:id/status', async (req, res) => {
    const id = validId(req.params.id);
    const { status } = z.object({ status: z.enum(['active', 'locked']) }).strict().parse(req.body);
    const user = await User.findById(id);
    if (!user) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    if (user.role === 'admin') throw new HttpError(403, 'Giai đoạn này chỉ hỗ trợ khóa hoặc mở tài khoản lễ tân.');
    if (user.status !== status) {
      user.status = status;
      user.session_version += 1;
      await user.save();
    }
    res.json({ user: publicUser(user) });
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Không tìm thấy chức năng được yêu cầu.')));
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) { res.status(err.status).json({ message: err.message }); return; }
    if (err instanceof ZodError) { res.status(400).json({ message: 'Vui lòng kiểm tra dữ liệu nhập.', fields: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })) }); return; }
    if (err?.code === 11000) {
      const labels: Record<string, string> = { phone: 'Số điện thoại', id_card: 'Số giấy tờ', room_number: 'Số phòng', type_code: 'Mã loại phòng', service_code: 'Mã dịch vụ', username: 'Tên đăng nhập' };
      const field = Object.keys(err.keyPattern || {})[0];
      res.status(409).json({ message: `${labels[field] || 'Mã dữ liệu'} đã tồn tại. Vui lòng kiểm tra lại.` }); return;
    }
    if (err instanceof mongoose.Error.ValidationError) { res.status(400).json({ message: 'Dữ liệu không hợp lệ.', fields: Object.values(err.errors).map(e => ({ field: e.path, message: e.message })) }); return; }
    if (err instanceof mongoose.Error.VersionError) { res.status(409).json({ message: 'Dữ liệu vừa thay đổi. Vui lòng tải lại.' }); return; }
    if (err instanceof SyntaxError || err?.type === 'entity.too.large') { res.status(400).json({ message: 'Dữ liệu gửi lên không hợp lệ.' }); return; }
    console.error('Request failed:', err?.name || 'Error');
    res.status(500).json({ message: 'Không thể xử lý lúc này. Vui lòng thử lại.' });
  };
  app.use(errors);
  return { app, sessionStore };
}
