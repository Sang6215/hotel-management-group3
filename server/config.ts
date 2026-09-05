import 'dotenv/config';
import { randomBytes } from 'node:crypto';

export const production = process.env.NODE_ENV === 'production';
const secret = process.env.SESSION_SECRET || (production ? '' : randomBytes(48).toString('hex'));
const originSource = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://127.0.0.1:5173';
const origin = new URL(originSource).origin;
if (secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
if (production && (!process.env.MONGODB_URI || !origin.startsWith('https://'))) {
  throw new Error('Production requires MONGODB_URI and an HTTPS APP_ORIGIN or RENDER_EXTERNAL_URL.');
}
export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 5173),
  origin,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27027/hotel_group3?replicaSet=hotel-local',
  secret,
  trustProxy: process.env.TRUST_PROXY === '1',
  timezone: process.env.HOTEL_TIMEZONE || 'Asia/Ho_Chi_Minh',
  depositPercent: Number(process.env.DEPOSIT_PERCENT || 30),
};
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid PORT.');
if (!Number.isInteger(config.depositPercent) || config.depositPercent < 0 || config.depositPercent > 100) throw new Error('Invalid DEPOSIT_PERCENT.');
