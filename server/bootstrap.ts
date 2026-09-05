import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from './models.js';

const bootstrapInput = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,40}$/),
  fullName: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
});

export async function bootstrapProductionAdmin() {
  if (await User.exists({})) return false;
  const parsed = bootstrapInput.safeParse({
    username: process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin',
    fullName: process.env.BOOTSTRAP_ADMIN_FULL_NAME || 'Quản trị viên Nhóm 3',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
  });
  if (!parsed.success) {
    throw new Error('Database has no users. Set BOOTSTRAP_ADMIN_PASSWORD to 12-72 bytes before the first production start.');
  }
  await User.create({
    username: parsed.data.username,
    full_name: parsed.data.fullName,
    password_hash: await bcrypt.hash(parsed.data.password, 12),
    role: 'admin',
    status: 'active',
  });
  console.log(`Created initial administrator: ${parsed.data.username}`);
  return true;
}
