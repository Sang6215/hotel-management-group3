export type Role = 'admin' | 'staff';
export type UserView = { id: string; username: string; fullName: string; role: Role; status: 'active' | 'locked'; createdAt: string };
export type RoomView = { id: string; number: string; floor: number; typeId: string; typeName: string; capacity: number; price: number; status: 'available' | 'occupied' | 'cleaning' | 'maintenance'; active: boolean; version: number };
export type Overview = { rooms: number; available: number; customers: number; bookings: number; roomTypes: number; phase: 2; demo: boolean };
export type Page<T> = { items: T[]; total: number; page: number; limit: number };
export type CatalogStatus = 'active' | 'inactive';
export type RoomTypeView = { id: string; code: string; name: string; price: number; capacity: number; amenities: string[]; description: string; status: CatalogStatus; version: number };
export type ServiceView = { id: string; code: string; name: string; category: string; unit: string; price: number; status: CatalogStatus; version: number };
export type CustomerView = { id: string; fullName: string; phone: string; idCard: string; email: string; nationality: string; status: CatalogStatus; version: number };
export type BookingStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled';
export type BookingRoom = { roomId: string; number: string; typeId: string; typeName: string; price: number; guestCount: number };
export type BookingView = {
  id: string; code: string; customerId: string; customer: { fullName: string; phone: string; idCard: string };
  rooms: BookingRoom[]; checkIn: string; checkOut: string; nights: number; totalGuests: number; estimatedTotal: number;
  deposit: number; status: BookingStatus; note: string; version: number; createdAt: string;
  history: { action: string; at: string; reason: string }[];
};
export type Availability = Page<RoomView> & { checkIn: string; checkOut: string; nights: number };
