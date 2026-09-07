import { describe, expect, it } from 'vitest';
import { calculateBill, MAX_MONEY } from '../server/billing-math.js';

describe('Week 4 billing arithmetic', () => {
  it('matches the agreed 2,300,000 invoice and 1,800,000 remaining receipt', () => {
    expect(calculateBill([1200000], 2, [100000], 500000, { type: 'fixed', value: 200000, minimum: 0, cap: 200000 })).toEqual({ roomTotal: 2400000, serviceTotal: 100000, subtotal: 2500000, discount: 200000, total: 2300000, deposit: 500000, toCollect: 1800000, toRefund: 0 });
  });
  it('keeps multiple rooms and service lines separate before summing', () => {
    expect(calculateBill([600000, 900000], 3, [40000, 100000, 0], 500000)).toMatchObject({ roomTotal: 4500000, serviceTotal: 140000, total: 4640000, toCollect: 4140000 });
  });
  it('rounds percentage discounts to a VND integer and applies the cap', () => {
    expect(calculateBill([101], 1, [], 0, { type: 'percentage', value: 50, minimum: 101, cap: 100 })).toMatchObject({ discount: 51, total: 50 });
    expect(calculateBill([1000000], 1, [], 0, { type: 'percentage', value: 50, minimum: 0, cap: 200000 }).discount).toBe(200000);
  });
  it('never discounts beyond subtotal and separates a refund from a negative receipt', () => {
    expect(calculateBill([100000], 1, [], 50000, { type: 'fixed', value: 200000, minimum: 0, cap: 300000 })).toMatchObject({ discount: 100000, total: 0, toCollect: 0, toRefund: 50000 });
  });
  it('handles zero-priced stays and deposits covering the exact total', () => {
    expect(calculateBill([0], 1, [0], 0)).toMatchObject({ total: 0, toCollect: 0, toRefund: 0 });
    expect(calculateBill([100000], 1, [], 100000)).toMatchObject({ total: 100000, toCollect: 0, toRefund: 0 });
  });
  it('rejects invalid nights, fractional or overflowing money and invalid discounts', () => {
    for (const nights of [0, -1, 1.5, 366, NaN]) expect(() => calculateBill([100], nights, [], 0)).toThrow();
    for (const money of [-1, .5, NaN, Infinity, MAX_MONEY + 1]) expect(() => calculateBill([money], 1, [], 0)).toThrow();
    expect(() => calculateBill([MAX_MONEY], 1, [1], 0)).toThrow();
    expect(() => calculateBill([100], 1, [], 0, { type: 'percentage', value: 101, minimum: 0, cap: 100 })).toThrow();
    expect(() => calculateBill([100], 1, [], 0, { type: 'fixed', value: 10, minimum: 101, cap: 10 })).toThrow();
  });
});
