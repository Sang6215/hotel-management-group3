import { hotelDay, nextDay } from '../shared/dates.js';
import type { OccupancyCounts, OccupancyReport, ReportPeriod } from '../shared/reports.js';

type RoomHistory = { _id: unknown; created_at: Date; inventory_history: { at: Date; type_id: unknown; type_name: string; enabled: boolean }[]; unavailable_periods: { start: Date; end?: Date | null }[] };
type Stay = { status: string; actual_check_in?: Date | null; actual_check_out?: Date | null; rooms_booked: { room_id: unknown }[] };
const empty = (): OccupancyCounts => ({ usedRoomNights: 0, availableRoomNights: 0, unavailableRoomNights: 0, unknownRoomNights: 0, unknownUsedRoomNights: 0, conflictingRoomNights: 0, occupancy: null });
const fields = ['usedRoomNights', 'availableRoomNights', 'unavailableRoomNights', 'unknownRoomNights', 'unknownUsedRoomNights', 'conflictingRoomNights'] as const;
function add(target: OccupancyCounts, source: OccupancyCounts) { for (const key of fields) target[key] += source[key]; }
function rate(c: OccupancyCounts) { c.occupancy = c.availableRoomNights && !c.conflictingRoomNights ? Math.round(c.usedRoomNights / c.availableRoomNights * 10000) / 100 : null; }

export function calculateOccupancy(rooms: RoomHistory[], stays: Stay[], range: ReportPeriod, typeId?: string): OccupancyReport {
  // Only ended calendar nights: today's unfinished night is never a forecast.
  const cutoff = [nextDay(range.to), hotelDay(range.asOf)].sort()[0];
  const days: string[] = [];
  for (let d = range.from; d < cutoff; d = nextDay(d)) days.push(d);
  const used = new Map<string, Set<string>>();
  for (const stay of stays) {
    if (!['checked_in', 'completed'].includes(stay.status) || !stay.actual_check_in) continue;
    const start = [hotelDay(stay.actual_check_in), range.from].sort().at(-1)!;
    const actualEnd = stay.status === 'completed' ? (stay.actual_check_out ? hotelDay(stay.actual_check_out) : hotelDay(stay.actual_check_in)) : cutoff;
    const end = [actualEnd, cutoff].sort()[0];
    for (const room of stay.rooms_booked) {
      const id = String(room.room_id), nights = used.get(id) || new Set<string>();
      for (let d = start; d < end; d = nextDay(d)) nights.add(d);
      used.set(id, nights);
    }
  }
  const items = days.map(day => ({ day, ...empty() })), byType = new Map<string, OccupancyCounts & { id: string; name: string }>();
  const group = (id: string, name: string) => { if (!byType.has(id)) byType.set(id, { id, name, ...empty() }); const g = byType.get(id)!; g.name = name; return g; };
  for (const room of rooms) {
    const history = [...room.inventory_history].sort((a, b) => a.at.getTime() - b.at.getTime());
    let cursor = -1;
    for (const item of items) {
      while (cursor + 1 < history.length && hotelDay(history[cursor + 1].at) <= item.day) cursor++;
      if (item.day < hotelDay(room.created_at)) continue;
      const state = history[cursor], occupied = used.get(String(room._id))?.has(item.day) || false, c = empty();
      if (!state) {
        // Unknown historical type cannot safely be assigned to a filtered room type.
        if (!typeId) { c.unknownRoomNights = 1; c.unknownUsedRoomNights = Number(occupied); add(item, c); add(group('unknown', 'Chưa đủ lịch sử'), c); }
        continue;
      }
      if (typeId && String(state.type_id) !== typeId) continue;
      const blocked = !state.enabled || room.unavailable_periods.some(p => hotelDay(p.start) <= item.day && (!p.end || hotelDay(p.end) > item.day));
      if (blocked) { c.unavailableRoomNights = 1; c.conflictingRoomNights = Number(occupied); }
      else { c.availableRoomNights = 1; c.usedRoomNights = Number(occupied); }
      add(item, c); add(group(String(state.type_id), state.type_name), c);
    }
  }
  if (!typeId) for (const [id, nights] of used) if (!rooms.some(r => String(r._id) === id)) {
    for (const item of items) if (nights.has(item.day)) { const c = empty(); c.unknownRoomNights = 1; c.unknownUsedRoomNights = 1; add(item, c); add(group('unknown', 'Chưa đủ lịch sử'), c); }
  }
  const totals = empty();
  for (const item of items) { add(totals, item); rate(item); }
  for (const item of byType.values()) rate(item);
  rate(totals);
  const warnings: string[] = [];
  if (totals.unknownRoomNights) warnings.push('Có đêm chưa đủ lịch sử danh mục; không đưa vào mẫu số hoặc tỷ lệ công suất.');
  if (typeId) warnings.push('Lọc theo loại phòng tại từng đêm đã ghi lịch sử; các đêm chưa biết loại không được đưa vào kết quả.');
  if (totals.conflictingRoomNights) warnings.push('Có lưu trú trùng đêm ngừng phục vụ; cần đối chiếu dữ liệu, không công bố tỷ lệ tổng.');
  if (!days.length) warnings.push('Khoảng đã chọn chưa có đêm nào kết thúc để tính công suất.');
  return { ...range, through: days.at(-1) || null, totals, items, byType: [...byType.values()].sort((a, b) => a.id.localeCompare(b.id)), warnings };
}
