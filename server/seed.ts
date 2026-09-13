import bcrypt from 'bcryptjs';
import { Customer, initializeModels, Room, RoomType, Service, User } from './models.js';

export async function seedDemo() {
  await initializeModels();
  // Insert only missing demo records. Never overwrite a changed password or delete data.
  const users = [
    { username: 'admin', full_name: 'Quản trị viên', role: 'admin', password: 'AdminDemo2026!' },
    { username: 'letan', full_name: 'Nhân viên lễ tân', role: 'staff', password: 'LetanDemo2026!' },
  ];
  for (const { password, ...user } of users) {
    if (!await User.exists({ username: user.username })) await User.create({ ...user, password_hash: await bcrypt.hash(password, 12) });
  }
  const types = [
    { type_code: 'STANDARD', name: 'Standard', base_price_per_night: 600000, max_occupancy: 2, amenities: ['Wi-Fi', 'Điều hòa'] },
    { type_code: 'DELUXE', name: 'Deluxe', base_price_per_night: 900000, max_occupancy: 3, amenities: ['Wi-Fi', 'Điều hòa', 'Ban công'] },
    { type_code: 'SUITE', name: 'Suite', base_price_per_night: 1200000, max_occupancy: 4, amenities: ['Wi-Fi', 'Bồn tắm', 'Phòng khách'] },
  ];
  // Catalogs can now be renamed in the UI. Seed only empty catalogs so restarting
  // never recreates an old room number/code after a user edits it.
  if (await RoomType.countDocuments() === 0 && await Room.countDocuments() === 0) for (const [index, data] of types.entries()) {
    const type = await RoomType.findOneAndUpdate({ type_code: data.type_code }, { $setOnInsert: data }, { upsert: true, new: true, runValidators: true });
    for (let n = 1; n <= 4; n++) {
      const room_number = `${index + 1}0${n}`;
      await Room.updateOne({ room_number }, { $setOnInsert: { room_number, floor: index + 1, room_type_id: type._id, status: 'available', active: true, inventory_history: [{ at: new Date(), type_id: type._id, type_name: type.name, enabled: type.status === 'active' }] } }, { upsert: true, runValidators: true });
    }
  }
  if (await Service.countDocuments() === 0) for (const [i, name, unit, price] of [
    ['LAUNDRY', 'Giặt ủi', 'Bộ', 50000], ['BREAKFAST', 'Bữa sáng', 'Suất', 100000],
    ['WATER', 'Nước suối', 'Chai', 20000], ['SPA', 'Spa', 'Lượt', 300000],
    ['COFFEE', 'Cà phê', 'Ly', 40000], ['EXTRABED', 'Giường phụ', 'Đêm', 200000],
  ]) await Service.updateOne({ service_code: i }, { $setOnInsert: { service_code: i, name, unit, unit_price: price } }, { upsert: true, runValidators: true });
  if (await Customer.countDocuments() === 0) await Customer.insertMany([
    { full_name: 'Khách mẫu 01', phone: '0900000001', id_card: 'DEMO000001', nationality: 'Việt Nam' },
    { full_name: 'Khách mẫu 02', phone: '0900000002', id_card: 'DEMO000002', nationality: 'Việt Nam' },
    { full_name: 'Khách mẫu 03', phone: '0900000003', id_card: 'DEMO000003', nationality: 'Việt Nam' },
  ]);
}
