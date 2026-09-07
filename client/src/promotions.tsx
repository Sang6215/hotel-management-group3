import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from './api';
import { calendarLabel, ErrorBox, type Field, LoadState, money, Pager, RecordForm, useRemote } from './workspace-ui';
import { hotelDay } from '../../shared/dates';
import type { Page, PromotionView, UserView } from '../../shared/types';

const fields: Field[] = [
  { key: 'code', label: 'Mã khuyến mãi', required: true, maxLength: 30, hint: 'Chữ, số, gạch ngang hoặc gạch dưới.' },
  { key: 'type', label: 'Hình thức giảm', options: [{ value: 'fixed', label: 'Số tiền cố định (đồng)' }, { value: 'percentage', label: 'Phần trăm (%)' }] },
  { key: 'value', label: 'Giá trị giảm', type: 'number', min: 1, max: 20_000_000_000_000, required: true, hint: 'Nếu chọn phần trăm: nhập từ 1 đến 100.' },
  { key: 'maxDiscount', label: 'Giảm tối đa (đồng)', type: 'number', min: 1, max: 20_000_000_000_000, required: true },
  { key: 'minAmount', label: 'Tổng trước giảm tối thiểu (đồng)', type: 'number', min: 0, max: 20_000_000_000_000, required: true },
  { key: 'startsOn', label: 'Từ ngày', type: 'date', required: true },
  { key: 'endsOn', label: 'Đến hết ngày', type: 'date', required: true, hint: 'Tính theo ngày Việt Nam; kiểm tra lại khi hoàn tất thanh toán.' },
  { key: 'status', label: 'Trạng thái', options: [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Ngừng sử dụng' }] },
];
export function PromotionsPage({ user }: { user: UserView }) {
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [page, setPage] = useState(1), [editing, setEditing] = useState<PromotionView | 'new' | null>(null);
  const result = useRemote<Page<PromotionView>>(`/promotions?q=${encodeURIComponent(q)}&status=${status}&page=${page}&limit=10`);
  const initial = editing && editing !== 'new' ? Object.fromEntries(fields.map(f => [f.key, editing[f.key as keyof PromotionView]])) : { code: '', type: 'fixed', value: 200000, maxDiscount: 200000, minAmount: 0, startsOn: hotelDay(new Date()), endsOn: hotelDay(new Date()), status: 'active' };
  async function save(values: Record<string, string | number>) {
    await api('/promotions' + (editing && editing !== 'new' ? '/' + editing.id : ''), { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify({ ...values, ...(editing && editing !== 'new' ? { version: editing.version } : {}) }) }); result.reload();
  }
  return <><div className="page-title"><div><div className="eyebrow">DANH MỤC</div><h1>Khuyến mãi</h1><p>Một mã cho mỗi hóa đơn, áp dụng trên tổng tiền phòng và dịch vụ.</p></div>{user.role === 'admin' && <button className="button primary" onClick={() => setEditing('new')}><Plus size={17} />Thêm khuyến mãi</button>}</div>
    <div className="toolbar"><label className="search-field"><Search size={18} /><input aria-label="Tìm mã khuyến mãi" placeholder="Tìm mã khuyến mãi…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></label><label className="floor-select">Trạng thái<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">Tất cả</option><option value="active">Hoạt động</option><option value="inactive">Ngừng sử dụng</option></select></label><button className="button secondary" onClick={result.reload}>Tải lại</button></div>
    <ErrorBox error={result.error} retry={result.reload} /><LoadState busy={result.busy} empty={result.data?.total === 0} />
    {result.data && result.data.total > 0 && <section className="section records-table"><div className="table-scroll"><table><thead><tr><th>Mã</th><th>Mức giảm</th><th>Điều kiện</th><th>Hiệu lực</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{result.data.items.map(p => <tr key={p.id}><td><strong>{p.code}</strong></td><td>{p.type === 'percentage' ? p.value + '%' : money(p.value)}<small className="block">Tối đa {money(p.maxDiscount)}</small></td><td>Từ {money(p.minAmount)}</td><td>{calendarLabel(p.startsOn)}<small className="block">đến hết {calendarLabel(p.endsOn)}</small></td><td><span className={`booking-badge ${p.status === 'inactive' ? 'cancelled' : 'confirmed'}`}>{p.status === 'inactive' ? 'Ngừng sử dụng' : hotelDay(new Date()) < p.startsOn ? 'Chưa bắt đầu' : hotelDay(new Date()) > p.endsOn ? 'Hết hạn' : 'Đang áp dụng'}</span></td><td>{user.role === 'admin' ? <button className="text-button" onClick={() => setEditing(p)}>Chỉnh sửa</button> : 'Chỉ xem'}</td></tr>)}</tbody></table></div><Pager data={result.data} page={page} setPage={setPage} /></section>}
    {editing && <RecordForm title={editing === 'new' ? 'Thêm khuyến mãi' : 'Sửa khuyến mãi'} initial={initial} fields={fields} save={save} close={() => setEditing(null)} />}
  </>;
}
