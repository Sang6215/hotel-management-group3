import { useState, type FormEvent, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { calendarLabel, ErrorBox, LoadState, money, Pager, useRemote } from './workspace-ui';
import { localTime, paymentMethods } from './billing-ui';
import { hotelDay } from '../../shared/dates';
import type { UserView, PaymentMethod, Page, RoomTypeView } from '../../shared/types';
import type { OccupancyReport, ReceiptsReport, ReportPeriod, RevenueReport, TopCustomersReport, TopServicesReport } from '../../shared/reports';
import './reports.css';

type Range = { from: string; to: string };
type ReportTab = 'revenue' | 'cash-flow' | 'occupancy' | 'top-services' | 'top-customers';
const tabs: { id: ReportTab; label: string }[] = [{ id: 'revenue', label: 'Doanh thu' }, { id: 'cash-flow', label: 'Dòng tiền' }, { id: 'occupancy', label: 'Công suất phòng' }, { id: 'top-services', label: 'Dịch vụ' }, { id: 'top-customers', label: 'Khách hàng' }];
const params = (r: Range, extra: Record<string, string> = {}) => new URLSearchParams({ ...r, ...extra }).toString();
const percent = (v: number | null) => v === null ? 'Chưa đủ dữ liệu' : v.toLocaleString('vi-VN') + '%';

function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    const s = String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const csv = '\uFEFF' + [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function ReportStats({ items }: { items: { label: string; value: string | number; note?: string }[] }) {
  return <div className="report-stats">{items.map(i => <article key={i.label}><span>{i.label}</span><strong>{i.value}</strong>{i.note && <small>{i.note}</small>}</article>)}</div>;
}
function PeriodNote({ data }: { data: ReportPeriod }) { return <p className="helper-text">Kỳ {calendarLabel(data.from)} – {calendarLabel(data.to)} (bao gồm ngày kết thúc) · Giờ Việt Nam · Dữ liệu tại {localTime(data.asOf)}.</p>; }
export function ReportTable({ headings, children, empty }: { headings: string[]; children: ReactNode; empty?: boolean }) {
  return empty ? <LoadState busy={false} empty /> : <div className="table-scroll"><table><thead><tr>{headings.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function RevenueChart({ items, groupBy }: { items: RevenueReport['items']; groupBy: 'day' | 'month' }) {
  const visible = items.slice(-14);
  if (!visible.length) return null;
  const maxVal = Math.max(1, ...visible.map(i => Math.max(Math.abs(i.revenue), Math.abs(i.netCash))));
  return (
    <section className="section">
      <div className="section-title">
        <div>
          <h2>Biểu đồ doanh thu & dòng tiền ({visible.length} kỳ gần nhất)</h2>
          <p>So sánh trực quan doanh thu ghi nhận theo hóa đơn và dòng tiền thuần thực thu/hoàn.</p>
        </div>
        <div className="chart-legend" aria-hidden="true">
          <span className="legend-dot revenue" /> Doanh thu
          <span className="legend-dot cash" /> Dòng tiền thuần
        </div>
      </div>
      <div className="chart-wrap">
        <svg className="bar-chart" viewBox={`0 0 ${Math.max(400, visible.length * 58)} 210`} role="img" aria-label="Biểu đồ cột so sánh doanh thu và dòng tiền thuần theo kỳ">
          {visible.map((row, idx) => {
            const x = idx * 58 + 14;
            const revH = Math.round((Math.max(0, row.revenue) / maxVal) * 140);
            const cashH = Math.round((Math.max(0, row.netCash) / maxVal) * 140);
            const label = groupBy === 'day' ? row.period.slice(5).split('-').reverse().join('/') : row.period;
            return (
              <g key={row.period}>
                <rect x={x} y={160 - revH} width={16} height={Math.max(2, revH)} rx={3} fill="#1d4ed8">
                  <title>{`${row.period} · Doanh thu: ${money(row.revenue)}`}</title>
                </rect>
                <rect x={x + 19} y={160 - cashH} width={16} height={Math.max(2, cashH)} rx={3} fill="#047857">
                  <title>{`${row.period} · Dòng tiền thuần: ${money(row.netCash)}`}</title>
                </rect>
                <text x={x + 17} y={184} textAnchor="middle" fontSize="11" fill="#475569">{label}</text>
              </g>
            );
          })}
          <line x1="0" y1="162" x2={Math.max(400, visible.length * 58)} y2="162" stroke="#cbd5e1" strokeWidth="1" />
        </svg>
      </div>
    </section>
  );
}

export function ReportsPage({ user, personal = false }: { user: UserView; personal?: boolean }) {
  if (!personal && user.role !== 'admin') return <section className="section denied"><h1>Bạn không có quyền xem báo cáo quản trị</h1><p>Lễ tân chỉ xem các khoản tiền do mình ghi nhận.</p><a href="#my-receipts" className="button primary">Mở sổ thu của tôi</a></section>;
  return <ReportWorkspace key={personal ? 'personal' : 'admin'} personal={personal} />;
}
function ReportWorkspace({ personal }: { personal: boolean }) {
  const today = hotelDay(new Date()), initial = { from: personal ? today : today.slice(0, 8) + '01', to: today };
  const [draft, setDraft] = useState(initial), [range, setRange] = useState(initial), [tab, setTab] = useState<ReportTab>('revenue'), [tick, setTick] = useState(0);
  function apply(e: FormEvent) { e.preventDefault(); setRange({ ...draft }); setTick(t => t + 1); }
  return <div className="reports-page"><div className="page-title"><div><div className="eyebrow">{personal ? 'CÁ NHÂN' : 'QUẢN TRỊ'}</div><h1>{personal ? 'Sổ thu của tôi' : 'Báo cáo khách sạn'}</h1><p>{personal ? 'Chỉ những khoản thu và hoàn do tài khoản của bạn ghi nhận; chưa quản lý ca riêng.' : 'Phân biệt doanh thu hóa đơn, tiền thực thu/hoàn và đêm lưu trú.'}</p></div></div>
    <form className="toolbar wrap report-filters" onSubmit={apply}><label>Từ ngày<input type="date" required min="2000-01-01" max="2100-12-31" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label><label>Đến hết ngày<input type="date" required min={draft.from || '2000-01-01'} max="2100-12-31" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label><button type="submit" className="button primary">Xem báo cáo</button><span className="helper-text">Tối đa 366 ngày mỗi lần xem.</span></form>
    {!personal && <nav className="report-tabs" aria-label="Loại báo cáo">{tabs.map(t => <button type="button" key={t.id} className={`button ${tab === t.id ? 'primary' : 'secondary'}`} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}</nav>}
    <div key={`${tick}:${range.from}:${range.to}:${tab}`}>
      {personal ? <CashView range={range} personal /> : tab === 'revenue' ? <RevenueView range={range} /> : tab === 'cash-flow' ? <CashView range={range} /> : tab === 'occupancy' ? <OccupancyView range={range} /> : tab === 'top-services' ? <ServicesView range={range} /> : <CustomersView range={range} />}
    </div></div>;
}
function RevenueView({ range }: { range: Range }) {
  const [groupBy, setGroupBy] = useState<'day' | 'month'>('day'), result = useRemote<RevenueReport>('/reports/revenue?' + params(range, { groupBy })), data = result.data;
  return <><div className="report-controls"><label>Gộp theo<select value={groupBy} onChange={e => setGroupBy(e.target.value as 'day' | 'month')}><option value="day">Ngày</option><option value="month">Tháng</option></select></label><button type="button" className="button secondary" onClick={result.reload}>Tải lại</button>{data && <button type="button" className="button secondary" onClick={() => downloadCsv(`doanh-thu-${data.from}-${data.to}.csv`, ['Kỳ', 'Hóa đơn', 'Giá trị gốc (VND)', 'Điều chỉnh (VND)', 'Doanh thu (VND)', 'Thực thu (VND)', 'Thực hoàn (VND)', 'Dòng tiền thuần (VND)'], data.items.map(i => [i.period, i.invoiceCount, i.invoiceTotal, i.adjustments, i.revenue, i.cashIn, i.cashOut, i.netCash]))}><Download size={16} aria-hidden="true" />Xuất CSV</button>}</div><p className="report-explanation">Doanh thu = hóa đơn đã thanh toán theo ngày lập + điều chỉnh theo ngày duyệt. Tiền cọc không được cộng lại vào doanh thu; dòng tiền tính riêng theo ngày thực thu/hoàn.</p><ErrorBox error={result.error} retry={result.reload} /><LoadState busy={result.busy} />{data && <><PeriodNote data={data} /><ReportStats items={[{ label: 'Doanh thu trong kỳ', value: money(data.totals.revenue) }, { label: 'Hóa đơn đã thanh toán', value: data.totals.invoiceCount }, { label: 'Điều chỉnh trong kỳ', value: money(data.totals.adjustments) }, { label: 'Dòng tiền thuần', value: money(data.totals.netCash), note: 'Có thể khác doanh thu do cọc thu khác kỳ.' }]} />
    <RevenueChart items={data.items} groupBy={data.groupBy} />
    <section className="section"><h2>Đối chiếu cơ cấu doanh thu</h2><dl className="report-breakdown"><div><dt>Tiền phòng trước giảm</dt><dd className="num">{money(data.totals.roomTotal)}</dd></div><div><dt>Dịch vụ trước giảm</dt><dd className="num">{money(data.totals.serviceTotal)}</dd></div><div><dt>Giảm giá</dt><dd className="num">−{money(data.totals.discount)}</dd></div><div><dt>Hóa đơn gốc trong kỳ</dt><dd className="num">{money(data.totals.invoiceTotal)}</dd></div><div><dt>Điều chỉnh duyệt trong kỳ</dt><dd className="num">{money(data.totals.adjustments)}</dd></div><div><dt>Doanh thu sau điều chỉnh</dt><dd className="num">{money(data.totals.revenue)}</dd></div></dl></section>
    <section className="section"><h2>Diễn biến {data.groupBy === 'month' ? 'theo tháng' : 'theo ngày'}</h2><ReportTable headings={['Kỳ', 'Hóa đơn', 'Giá trị gốc', 'Điều chỉnh', 'Doanh thu', 'Thực thu', 'Thực hoàn', 'Dòng tiền thuần']}>{data.items.map(i => <tr key={i.period}><td className="num">{data.groupBy === 'day' ? calendarLabel(i.period) : i.period}</td><td className="num">{i.invoiceCount}</td><td className="num">{money(i.invoiceTotal)}</td><td className="num">{money(i.adjustments)}</td><td className="num"><strong>{money(i.revenue)}</strong></td><td className="num">{money(i.cashIn)}</td><td className="num">{money(i.cashOut)}</td><td className="num">{money(i.netCash)}</td></tr>)}</ReportTable></section></>}</>;
}
function CashView({ range, personal = false }: { range: Range; personal?: boolean }) {
  const [page, setPage] = useState(1), [method, setMethod] = useState(''), [kind, setKind] = useState(''), [employeeId, setEmployeeId] = useState('');
  const result = useRemote<ReceiptsReport>(`/reports/${personal ? 'my-receipts' : 'cash-flow'}?` + params(range, { page: String(page), limit: '20', ...(method ? { method } : {}), ...(kind ? { kind } : {}), ...(!personal && employeeId ? { employeeId } : {}) })), data = result.data;
  const kinds: Record<string, string> = { deposit: 'Thu cọc', checkout: 'Thu khi trả phòng', refund: 'Hoàn tiền', adjustment: 'Điều chỉnh hóa đơn' };
  return <><div className="report-controls"><label>Phương thức<select value={method} onChange={e => { setMethod(e.target.value); setPage(1); }}><option value="">Tất cả</option>{Object.entries(paymentMethods).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label><label>Giao dịch<select value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="">Tất cả</option>{Object.entries(kinds).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label><button type="button" className="button secondary" onClick={result.reload}>Tải lại</button>{data && data.items.length > 0 && <button type="button" className="button secondary" onClick={() => downloadCsv(`${personal ? 'so-thu-ca-nhan' : 'dong-tien'}-${data.from}-${data.to}-p${data.page}.csv`, ['Thời gian', 'Người ghi', 'Phiếu đặt', 'Loại', 'Hướng', 'Số tiền (VND)', 'Phương thức', 'Tham chiếu', 'Lý do'], data.items.map(i => [localTime(i.at), i.by, i.bookingCode, kinds[i.kind] || i.kind, i.direction, i.amount, paymentMethods[i.method as PaymentMethod] || i.method, i.reference, i.reason]))}><Download size={16} aria-hidden="true" />Xuất CSV trang này</button>}{employeeId && <button type="button" className="text-button" onClick={() => { setEmployeeId(''); setPage(1); }}>Bỏ lọc nhân viên</button>}</div><p className="report-explanation">Sổ tiền gồm cọc, thu khi trả phòng, thu bổ sung và hoàn tiền theo thời điểm ghi nhận. Tổng bên dưới áp dụng cho toàn bộ kết quả lọc, không chỉ trang hiện tại.</p><ErrorBox error={result.error} retry={result.reload} /><LoadState busy={result.busy} />{data && <><PeriodNote data={data} /><ReportStats items={[{ label: 'Tổng thực thu', value: money(data.totals.cashIn) }, { label: 'Tổng thực hoàn', value: money(data.totals.cashOut) }, { label: 'Dòng tiền thuần', value: money(data.totals.netCash) }, { label: 'Số giao dịch', value: data.total }]} />
    {!personal && <section className="section"><h2>Theo người ghi nhận</h2>{data.employeeCount > data.byEmployee.length && <p>Hiển thị {data.byEmployee.length}/{data.employeeCount} nhân viên; thu hẹp kỳ để xem đầy đủ.</p>}<ReportTable empty={!data.byEmployee.length} headings={['Người ghi', 'Số giao dịch', 'Thu', 'Hoàn', 'Thuần', 'Chi tiết']}>{data.byEmployee.map(i => <tr key={i.id}><td>{i.name}<small className="block">Mã: {i.id}</small></td><td className="num">{i.count}</td><td className="num">{money(i.cashIn)}</td><td className="num">{money(i.cashOut)}</td><td className="num">{money(i.netCash)}</td><td><button type="button" className="text-button" onClick={() => { setEmployeeId(i.id); setPage(1); }}>Lọc người này</button></td></tr>)}</ReportTable></section>}
    <section className="section"><h2>Theo phương thức</h2><ReportTable empty={!data.byMethod.length} headings={['Phương thức', 'Số giao dịch', 'Thu', 'Hoàn', 'Thuần']}>{data.byMethod.map(i => <tr key={i.method}><td>{paymentMethods[i.method as PaymentMethod] || i.method}</td><td className="num">{i.count}</td><td className="num">{money(i.cashIn)}</td><td className="num">{money(i.cashOut)}</td><td className="num">{money(i.netCash)}</td></tr>)}</ReportTable></section>
    <section className="section"><h2>Chi tiết sổ tiền</h2><ReportTable empty={!data.items.length} headings={['Thời gian / Người ghi', 'Phiếu đặt', 'Giao dịch / Lý do', 'Số tiền', 'Phương thức / Tham chiếu']}>{data.items.map(i => <tr key={`${i.bookingId}:${i.id}`}><td>{localTime(i.at)}<small className="block">{i.by}</small></td><td><a className="text-button" href={`#bookings/${i.bookingId}`}>{i.bookingCode}</a></td><td>{kinds[i.kind] || i.kind}<small className="block">{i.reason}</small></td><td className={`num ${i.direction === 'out' ? 'refund' : ''}`}>{i.direction === 'in' ? '+' : '−'}{money(i.amount)}</td><td>{paymentMethods[i.method as PaymentMethod] || i.method}<small className="block">{i.reference}</small></td></tr>)}</ReportTable><Pager data={data} page={page} setPage={setPage} /></section></>}</>;
}
function OccupancyView({ range }: { range: Range }) {
  const [typeId, setTypeId] = useState('');
  const types = useRemote<Page<RoomTypeView>>('/room-types?limit=200');
  const result = useRemote<OccupancyReport>('/reports/occupancy?' + params(range, typeId ? { typeId } : {})), data = result.data;
  return <><div className="report-controls"><label>Loại phòng trong lịch sử<select value={typeId} onChange={e => setTypeId(e.target.value)}><option value="">Tất cả loại phòng</option>{types.data?.items.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button type="button" className="button secondary" onClick={result.reload}>Tải lại</button>{data && <button type="button" className="button secondary" onClick={() => downloadCsv(`cong-suat-${data.from}-${data.to}.csv`, ['Đêm', 'Đã sử dụng', 'Có thể phục vụ', 'Ngừng phục vụ', 'Chưa đủ lịch sử', 'Xung đột', 'Công suất (%)'], data.items.map(i => [i.day, i.usedRoomNights, i.availableRoomNights, i.unavailableRoomNights, i.unknownRoomNights, i.conflictingRoomNights, i.occupancy ?? '']))}><Download size={16} aria-hidden="true" />Xuất CSV</button>}</div><p className="report-explanation">Đếm đêm lịch đã kết thúc, theo từng phòng; không dùng số đêm tối thiểu tính tiền. Lượt nhận/trả cùng ngày có 0 đêm lưu trú. Phòng bảo trì hoặc ngừng phục vụ được loại theo lịch sử; không suy ngược từ trạng thái hiện tại.</p><ErrorBox error={result.error} retry={result.reload} /><LoadState busy={result.busy} />{data && <><PeriodNote data={data} /><p>Tính đến đêm {data.through ? calendarLabel(data.through) : 'chưa có'}; không dự báo đêm hôm nay hoặc tương lai.</p>{data.warnings.map(w => <p className="report-warning" key={w}>{w}</p>)}<ReportStats items={[{ label: 'Công suất phần đủ lịch sử', value: percent(data.totals.occupancy) }, { label: 'Đêm phòng đã sử dụng', value: data.totals.usedRoomNights, note: 'Chỉ phần có đủ lịch sử và có thể phục vụ.' }, { label: 'Đêm phòng có thể phục vụ', value: data.totals.availableRoomNights }, { label: 'Đêm chưa đủ lịch sử', value: data.totals.unknownRoomNights, note: `${data.totals.unknownUsedRoomNights} đêm có lưu trú nhưng chưa xác định mẫu số.` }]} />
    <section className="section"><h2>Theo loại phòng trong lịch sử</h2>
      {data.byType.length > 0 && <div className="occupancy-bars">{data.byType.map(i => <div key={i.id} className="occupancy-bar-row"><div className="occupancy-bar-head"><span>{i.name}</span><strong className="num">{percent(i.occupancy)} · {i.usedRoomNights}/{i.availableRoomNights} đêm</strong></div><div className="occupancy-track" aria-hidden="true"><span style={{ width: `${Math.min(100, i.occupancy ?? 0)}%` }} /></div></div>)}</div>}
      <ReportTable empty={!data.byType.length} headings={['Loại phòng', 'Đã sử dụng', 'Có thể phục vụ', 'Ngừng phục vụ', 'Chưa đủ lịch sử', 'Xung đột', 'Công suất']}>{data.byType.map(i => <tr key={i.id}><td>{i.name}</td><td className="num">{i.usedRoomNights}</td><td className="num">{i.availableRoomNights}</td><td className="num">{i.unavailableRoomNights}</td><td className="num">{i.unknownRoomNights}</td><td className="num">{i.conflictingRoomNights}</td><td className="num"><strong>{percent(i.occupancy)}</strong></td></tr>)}</ReportTable>
    </section>
    <section className="section"><h2>Theo từng đêm</h2><ReportTable empty={!data.items.length} headings={['Đêm', 'Đã sử dụng', 'Có thể phục vụ', 'Ngừng phục vụ', 'Chưa đủ lịch sử', 'Xung đột', 'Công suất']}>{data.items.map(i => <tr key={i.day}><td className="num">{calendarLabel(i.day)}</td><td className="num">{i.usedRoomNights}</td><td className="num">{i.availableRoomNights}</td><td className="num">{i.unavailableRoomNights}</td><td className="num">{i.unknownRoomNights}</td><td className="num">{i.conflictingRoomNights}</td><td className="num">{percent(i.occupancy)}</td></tr>)}</ReportTable></section></>}</>;
}
function ServicesView({ range }: { range: Range }) {
  const [mode, setMode] = useState('invoice'), result = useRemote<TopServicesReport>('/reports/top-services?' + params(range, { mode, limit: '20' })), data = result.data;
  return <><div className="report-controls"><label>Cách thống kê<select value={mode} onChange={e => setMode(e.target.value)}><option value="invoice">Theo ngày thanh toán hóa đơn</option><option value="usage">Theo ngày sử dụng dịch vụ</option></select></label><button type="button" className="button secondary" onClick={result.reload}>Tải lại</button>{data && data.items.length > 0 && <button type="button" className="button secondary" onClick={() => downloadCsv(`top-dich-vu-${data.mode}-${data.from}-${data.to}.csv`, ['Dịch vụ', 'Mã dịch vụ', 'Đơn vị', 'Số lượng', 'Số dòng', 'Giá trị (VND)'], data.items.map(i => [i.name, i.serviceId, i.unit, i.quantity, i.lines, i.amount]))}><Download size={16} aria-hidden="true" />Xuất CSV</button>}</div><p className="report-explanation">{mode === 'invoice' ? 'Giá trị dịch vụ trên hóa đơn đã thanh toán, trước giảm giá và điều chỉnh chung; dùng đơn giá đã chốt.' : 'Số lượng phát sinh trên lượt đang ở hoặc hoàn tất; không gồm dòng đã hủy. Giá trị này chưa đồng nghĩa doanh thu đã thanh toán.'} Nếu đổi đơn vị, mỗi đơn vị được tách riêng để không cộng lẫn.</p><ErrorBox error={result.error} retry={result.reload} /><LoadState busy={result.busy} />{data && <section className="section"><h2>Top dịch vụ · {data.items.length}/{data.total} nhóm</h2><PeriodNote data={data} /><ReportTable empty={!data.items.length} headings={['Dịch vụ', 'Đơn vị', 'Số lượng', 'Dòng sử dụng', 'Giá trị trước giảm']}>{data.items.map(i => <tr key={i.id}><td>{i.name}<small className="block">Mã: {i.serviceId}</small></td><td>{i.unit}</td><td className="num">{i.quantity}</td><td className="num">{i.lines}</td><td className="num"><strong>{money(i.amount)}</strong></td></tr>)}</ReportTable></section>}</>;
}
function CustomersView({ range }: { range: Range }) {
  const result = useRemote<TopCustomersReport>('/reports/top-customers?' + params(range, { limit: '20' })), data = result.data;
  return <><div className="report-controls"><button type="button" className="button secondary" onClick={result.reload}>Tải lại</button>{data && data.items.length > 0 && <button type="button" className="button secondary" onClick={() => downloadCsv(`top-khach-hang-${data.from}-${data.to}.csv`, ['Khách hàng', 'Mã hồ sơ', 'Hóa đơn', 'Giá trị gốc (VND)', 'Điều chỉnh (VND)', 'Giá trị trong kỳ (VND)'], data.items.map(i => [i.name, i.id, i.invoiceCount, i.invoiceTotal, i.adjustments, i.revenue]))}><Download size={16} aria-hidden="true" />Xuất CSV</button>}</div><p className="report-explanation">Xếp hạng theo giá trị hóa đơn thanh toán trong kỳ cộng điều chỉnh được duyệt trong kỳ. Khách trùng tên vẫn tách theo mã hồ sơ; điều chỉnh hóa đơn cũ có thể làm giá trị trong kỳ âm.</p><ErrorBox error={result.error} retry={result.reload} /><LoadState busy={result.busy} />{data && <section className="section"><h2>Top khách hàng · {data.items.length}/{data.total} khách</h2><PeriodNote data={data} /><ReportTable empty={!data.items.length} headings={['Khách hàng / Mã hồ sơ', 'Hóa đơn trong kỳ', 'Giá trị hóa đơn gốc', 'Điều chỉnh trong kỳ', 'Giá trị trong kỳ']}>{data.items.map(i => <tr key={i.id}><td>{i.name}<small className="block">{i.id}</small></td><td className="num">{i.invoiceCount}</td><td className="num">{money(i.invoiceTotal)}</td><td className="num">{money(i.adjustments)}</td><td className="num"><strong>{money(i.revenue)}</strong></td></tr>)}</ReportTable></section>}</>;
}
