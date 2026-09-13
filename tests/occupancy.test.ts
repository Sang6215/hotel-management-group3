import { describe, expect, it } from 'vitest';
import { calculateOccupancy } from '../server/occupancy.js';
import { reportRange, safeReportNumbers } from '../server/reports.js';

const date = (day: string) => new Date(day + 'T12:00:00+07:00');
const range = reportRange({ from: '2026-01-31', to: '2026-02-02' }, date('2026-02-03'));
const state = (day = '2026-01-01', enabled = true, type_id = 'standard') => ({ at: date(day), enabled, type_id, type_name: type_id });
const room = (id = '101', history = [state()]) => ({ _id: id, created_at: date('2026-01-01'), inventory_history: history, unavailable_periods: [] as { start: Date; end?: Date }[] });
const stay = (ids = ['101'], status = 'completed', start = '2026-01-30', end = '2026-02-02') => ({ status, actual_check_in: date(start), actual_check_out: date(end), rooms_booked: ids.map(room_id => ({ room_id })) });

describe('Historical room-night calculation', () => {
  it('clips a cross-month multi-room stay and counts each physical room once', () => {
    const r = calculateOccupancy([room(), room('102')], [stay(['101', '102']), stay()], range);
    expect(r.totals).toMatchObject({ usedRoomNights: 4, availableRoomNights: 6, occupancy: 66.67 });
    expect(r.items.map(i => i.usedRoomNights)).toEqual([2, 2, 0]);
  });
  it('ignores planned, cancelled and same-day stays', () => {
    const r = calculateOccupancy([room()], ['pending', 'confirmed', 'cancelled'].map(s => stay(['101'], s)).concat(stay(['101'], 'completed', '2026-02-01', '2026-02-01')), range);
    expect(r.totals.usedRoomNights).toBe(0);
  });
  it('counts ongoing stays through ended nights, never the unfinished current night', () => {
    const r = calculateOccupancy([room()], [stay(['101'], 'checked_in')], { ...range, to: '2026-02-10' });
    expect(r.through).toBe('2026-02-02'); expect(r.totals.usedRoomNights).toBe(3);
  });
  it('uses historical activation and type changes instead of present catalogue state', () => {
    const r = calculateOccupancy([room('101', [state(), state('2026-02-01', false), state('2026-02-02', true, 'suite')])], [], range);
    expect(r.totals).toMatchObject({ availableRoomNights: 2, unavailableRoomNights: 1 });
    expect(r.byType.map(t => [t.id, t.availableRoomNights, t.unavailableRoomNights])).toEqual([['standard', 1, 1], ['suite', 1, 0]]);
    expect(calculateOccupancy([room('101', [state(), state('2026-02-02', true, 'suite')])], [], range, 'suite').totals.availableRoomNights).toBe(1);
  });
  it('unions overlapping maintenance periods and leaves the return date available', () => {
    const r = room(); r.unavailable_periods = [{ start: date('2026-01-30'), end: date('2026-02-02') }, { start: date('2026-01-31'), end: date('2026-02-01') }];
    expect(calculateOccupancy([r], [], range).totals).toMatchObject({ availableRoomNights: 1, unavailableRoomNights: 2 });
  });
  it('marks missing pre-upgrade history unknown, including occupied unknown nights', () => {
    const r = calculateOccupancy([room('101', [state('2026-02-02')])], [stay()], range);
    expect(r.totals).toMatchObject({ availableRoomNights: 1, unknownRoomNights: 2, unknownUsedRoomNights: 2, usedRoomNights: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('does not publish a misleading rate when stays conflict with unavailable nights', () => {
    const r = calculateOccupancy([room('101', [state('2026-01-01', false)])], [stay()], range);
    expect(r.totals).toMatchObject({ conflictingRoomNights: 2, occupancy: null });
  });
  it('accounts for missing room records without inventing availability', () => {
    expect(calculateOccupancy([], [stay()], range).totals).toMatchObject({ unknownRoomNights: 2, unknownUsedRoomNights: 2, occupancy: null });
  });
  it('excludes dates before room creation and future dates', () => {
    const r = room(); r.created_at = date('2026-02-01');
    expect(calculateOccupancy([r], [], range).totals.availableRoomNights).toBe(2);
    expect(calculateOccupancy([r], [], { ...range, from: '2026-02-03', to: '2026-02-04' }).items).toEqual([]);
  });
  it('rejects unsafe totals and invalid ranges', () => {
    expect(() => safeReportNumbers({ items: [{ amount: Number.MAX_SAFE_INTEGER + 1 }] })).toThrow('giới hạn');
    expect(() => reportRange({ from: '2026-02-30', to: '2026-03-01' })).toThrow();
    expect(() => reportRange({ from: '2025-01-01', to: '2026-01-02' })).toThrow();
  });
});
