import { config } from '../server/config.js';
import mongoose from 'mongoose';
import { seedDemo } from '../server/seed.js';
if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
await mongoose.connect(config.mongoUri);
await seedDemo();
console.log('Demo seed complete. Existing records were preserved.');
await mongoose.disconnect();
