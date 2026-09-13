import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportsPage, ReportStats, ReportTable } from '../client/src/reports';
import type { UserView } from '../shared/types';

const user = (role: 'admin' | 'staff') => ({ id: 'test', username: 'test', fullName: 'Thử nghiệm', role, status: 'active' as const }) as UserView;
describe('Report components (static render, no browser)', () => {
  it('denies the administration screen for reception staff', () => {
    const html = renderToStaticMarkup(h(ReportsPage, { user: user('staff') }));
    expect(html).toContain('không có quyền'); expect(html).toContain('#my-receipts'); expect(html).not.toContain('Loại báo cáo');
  });
  it('shows the personal receipt screen without hotel-wide report tabs', () => {
    const html = renderToStaticMarkup(h(ReportsPage, { user: user('staff'), personal: true }));
    expect(html).toContain('Sổ thu của tôi'); expect(html).toContain('Từ ngày'); expect(html).not.toContain('Loại báo cáo');
  });
  it('renders all five administration report choices', () => {
    const html = renderToStaticMarkup(h(ReportsPage, { user: user('admin') }));
    for (const label of ['Doanh thu', 'Dòng tiền', 'Công suất phòng', 'Dịch vụ', 'Khách hàng']) expect(html).toContain(label);
  });
  it('renders real zero values, semantic table headers and explicit empty state', () => {
    expect(renderToStaticMarkup(h(ReportStats, { items: [{ label: 'Thu', value: 0 }] }))).toContain('<strong>0</strong>');
    expect(renderToStaticMarkup(h(ReportTable, { headings: ['Kỳ'], children: null }))).toContain('scope="col"');
    expect(renderToStaticMarkup(h(ReportTable, { headings: ['Kỳ'], children: null, empty: true }))).toContain('Chưa');
  });
});
