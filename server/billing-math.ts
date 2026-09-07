import { HttpError } from './http.js';
import type { BillingTotals } from '../shared/types.js';

export const MAX_MONEY = 20_000_000_000_000;
export function checkedMoney(n: number) {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_MONEY) throw new HttpError(400, 'Số tiền không hợp lệ hoặc vượt giới hạn 20 nghìn tỷ đồng.');
  return n;
}
type Discount = { type: 'percentage' | 'fixed'; value: number; minimum: number; cap: number };
export function calculateBill(prices: number[], nights: number, serviceAmounts: number[], deposit: number, promotion?: Discount): BillingTotals {
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) throw new HttpError(400, 'Số đêm thanh toán phải từ 1 đến 365.');
  const roomTotal = checkedMoney(prices.reduce((sum, p) => sum + checkedMoney(p) * nights, 0));
  const serviceTotal = checkedMoney(serviceAmounts.reduce((sum, a) => sum + checkedMoney(a), 0));
  const subtotal = checkedMoney(roomTotal + serviceTotal);
  checkedMoney(deposit);
  let discount = 0;
  if (promotion) {
    const { type, value, minimum, cap } = promotion;
    checkedMoney(value); checkedMoney(minimum); checkedMoney(cap);
    if (value < 1 || cap < 1 || (type === 'percentage' && value > 100)) throw new HttpError(409, 'Cấu hình khuyến mãi không hợp lệ.');
    if (subtotal < minimum) throw new HttpError(409, `Mã giảm yêu cầu tổng trước giảm ít nhất ${minimum.toLocaleString('vi-VN')} đồng.`);
    discount = Math.min(subtotal, cap, type === 'percentage' ? Math.round(subtotal * value / 100) : value);
  }
  const total = checkedMoney(subtotal - discount);
  return { roomTotal, serviceTotal, subtotal, discount, total, deposit, toCollect: Math.max(0, total - deposit), toRefund: Math.max(0, deposit - total) };
}
