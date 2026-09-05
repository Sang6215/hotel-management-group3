// Dates in the API are hotel calendar dates. Do not derive nights from event hours.
export const DAY_MS = 86400000;
export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31') return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function hotelDay(value: Date | string): string {
  // The initial product operates one hotel in Vietnam (UTC+7, no daylight saving).
  return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 10);
}
export function nightsBetween(checkIn: string, checkOut: string): number {
  return (Date.parse(checkOut + 'T00:00:00Z') - Date.parse(checkIn + 'T00:00:00Z')) / DAY_MS;
}
export function nextDay(value: string): string {
  return new Date(Date.parse(value + 'T00:00:00Z') + DAY_MS).toISOString().slice(0, 10);
}
