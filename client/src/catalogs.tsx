import { useState } from 'react';
import { BedDouble, Check, Plus, RefreshCw, Search } from 'lucide-react';
import { api } from './api';
import { calendarLabel, ErrorBox, errorMessage, type Field, LoadState, Modal, money, Pager, RecordForm, useRemote } from './workspace-ui';
import type { BookingView, CustomerView, Page, RoomTypeView, RoomView, ServiceView, UserView } from '../../shared/types';
import type { CustomerSpending } from '../../shared/reports';
import { ReportStats } from './reports';

const statuses = [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Ngừng sử dụng' }];
const roomLabels = { available: 'Sẵn sàng', occupied: 'Đang có khách', cleaning: 'Đang dọn', maintenance: 'Bảo trì' };
export const bookingLabels = { pending: 'Nháp · chưa giữ phòng', confirmed: 'Đã xác nhận', checked_in: 'Đang lưu trú', completed: 'Hoàn tất', cancelled: 'Đã hủy' };
export function BookingBadge({ status }: { status: BookingView['status'] }) { return <span className={`booking-badge ${status}`}>{bookingLabels[status]}</span>; }
type CatalogItem = RoomTypeView | ServiceView | CustomerView;
type Kind = 'room-types' | 'services' | 'customers';
const names: Record<Kind, string> = { 'room-types': 'Loại phòng', services: 'Dịch vụ', customers: 'Khách hàng' };
const statusField: Field = { key: 'status', label: 'Trạng thái', options: statuses };
const priceField: Field = { key: 'price', label: 'Đơn giá (₫)', type: 'number', required: true, min: 0, max: 1_000_000_000 };
const baseFields: Field[] = [{ key: 'code', label: 'Mã danh mục', required: true, maxLength: 30 }, { key: 'name', label: 'Tên', required: true }, priceField];
const catalogFields: Record<Kind, Field[]> = {
  'room-types': [...baseFields, { key: 'capacity', label: 'Sức chứa tối đa (khách)', type: 'number', required: true, min: 1, max: 100 }, { key: 'amenities', label: 'Tiện ích', hint: 'Ngăn cách bằng dấu phẩy.', maxLength: 2000 }, { key: 'description', label: 'Mô tả', type: 'textarea' }, statusField],
  services: [...baseFields, { key: 'category', label: 'Nhóm dịch vụ', maxLength: 80 }, { key: 'unit', label: 'Đơn vị tính', required: true, maxLength: 30 }, statusField],
  customers: [{ key: 'fullName', label: 'Họ và tên', required: true }, { key: 'phone', label: 'Số điện thoại', required: true, maxLength: 30, hint: 'Số Việt Nam có thể nhập 0… hoặc +84…' }, { key: 'idCard', label: 'CCCD / Hộ chiếu', required: true, maxLength: 40 }, { key: 'email', label: 'Email', type: 'email', maxLength: 200 }, { key: 'nationality', label: 'Quốc tịch', maxLength: 80 }, statusField],
};
export function CustomerEditor({ close, saved }: { close: () => void; saved: (c: CustomerView) => void }) {
  return <RecordForm title="Thêm khách hàng" fields={catalogFields.customers} initial={{ fullName: '', phone: '', idCard: '', email: '', nationality: 'Việt Nam', status: 'active' }} close={close} save={async values => {
    const r = await api<{ item: CustomerView }>('/customers', { method: 'POST', body: JSON.stringify(values) }); saved(r.item);
  }} />;
}
export function CustomerHistory({ customer, close }: { customer: CustomerView; close: () => void }) {
  const [page, setPage] = useState(1);
  const result = useRemote<Page<BookingView>>(`/customers/${customer.id}/bookings?page=${page}&limit=10`);
  const spending = useRemote<CustomerSpending>(`/customers/${customer.id}/spending`);
  return <Modal title={`Lịch sử · ${customer.fullName}`} close={close} wide><p className="muted">Phiếu đặt và lượt lưu trú liên kết với hồ sơ khách hàng. Chi tiêu là hóa đơn đã thanh toán cộng điều chỉnh đã duyệt; không cộng lại tiền cọc.</p><ErrorBox error={spending.error} retry={spending.reload} /><LoadState busy={spending.busy} />{spending.data && <ReportStats items={[{ label: 'Tổng chi tiêu đến hiện tại', value: money(spending.data.total) }, { label: 'Hóa đơn đã thanh toán', value: spending.data.invoiceCount }, { label: 'Hóa đơn gốc', value: money(spending.data.invoiceTotal) }, { label: 'Điều chỉnh', value: money(spending.data.adjustments) }]} />}<ErrorBox error={result.error} retry={result.reload} /><LoadState busy={result.busy} empty={result.data?.total === 0} /><div className="history-list">{result.data?.items.map(b => <a key={b.id} href={`#bookings/${b.id}`} onClick={close}><div><strong>{b.code}</strong><p>{calendarLabel(b.checkIn)} → {calendarLabel(b.checkOut)} · Phòng {b.rooms.map(r => r.number).join(', ')}</p></div><BookingBadge status={b.status} /></a>)}</div><Pager data={result.data} page={page} setPage={setPage} /></Modal>;
}
export function CatalogPage({ kind, user }: { kind: Kind; user: UserView }) {
  const [q, setQ] = useState(''), [status, setStatus] = useState('all'), [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null), [success, setSuccess] = useState(''), [history, setHistory] = useState<CustomerView>();
  const result = useRemote<Page<CatalogItem>>(`/${kind}?q=${encodeURIComponent(q)}&status=${status}&page=${page}&limit=10`);
  const canEdit = kind === 'customers' || user.role === 'admin';
  const initial: Record<string, string | number> = editing && editing !== 'new' ? Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])) : { code: '', name: '', price: 0, capacity: 2, amenities: '', description: '', category: '', unit: '', fullName: '', phone: '', idCard: '', email: '', nationality: 'Việt Nam', status: 'active' };
  async function save(values: Record<string, string | number>) {
    const body = Object.fromEntries(catalogFields[kind].map(f => [f.key, f.key === 'amenities' ? String(values[f.key] || '').split(',').map(s => s.trim()).filter(Boolean) : values[f.key] ?? '']));
    if (editing !== 'new' && editing) body.version = editing.version;
    await api(`/${kind}${editing && editing !== 'new' ? '/' + editing.id : ''}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(body) });
    setSuccess('Đã lưu thông tin.'); result.reload();
  }
  return <><div className="page-title"><div><div className="eyebrow">{kind === 'customers' ? 'HỒ SƠ' : 'DANH MỤC'}</div><h1>{names[kind]}</h1><p>{kind === 'customers' ? 'Tra cứu giấy tờ, thông tin liên hệ và lịch sử đặt phòng.' : kind === 'room-types' ? 'Giá theo đêm, sức chứa và tiện ích của từng loại phòng.' : 'Đơn giá và đơn vị tính của các dịch vụ khách sạn.'}</p></div><div className="action-row"><button type="button" className="button secondary" onClick={result.reload} disabled={result.busy}><RefreshCw size={16} aria-hidden="true" />Cập nhật</button>{canEdit && <button type="button" className="button primary" onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" />Thêm {names[kind].toLowerCase()}</button>}</div></div>
    {success && <div className="success" role="status"><Check size={16} aria-hidden="true" /><span>{success}</span></div>}<div className="toolbar"><label className="search-field"><Search size={18} aria-hidden="true" /><input aria-label={`Tìm ${names[kind].toLowerCase()}`} placeholder={kind === 'customers' ? 'Tên, điện thoại hoặc giấy tờ…' : 'Tìm tên hoặc mã…'} value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></label><label className="floor-select">Trạng thái<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">Tất cả</option>{statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label></div><ErrorBox error={result.error} retry={result.reload} /><LoadState busy={result.busy} empty={result.data?.total === 0} />
    {result.data && result.data.total > 0 && <section className="section records-table"><div className="table-scroll"><table><thead><tr><th>{kind === 'customers' ? 'Khách hàng' : 'Tên / mã'}</th><th>{kind === 'customers' ? 'Liên hệ' : 'Đơn giá'}</th><th>{kind === 'customers' ? 'Giấy tờ' : kind === 'room-types' ? 'Sức chứa' : 'Nhóm / đơn vị'}</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{result.data.items.map(item => <tr key={item.id}><td><strong>{'fullName' in item ? item.fullName : item.name}</strong><small className="block muted">{'code' in item ? item.code : item.nationality}</small></td><td className="num">{'phone' in item ? <>{item.phone}<small className="block">{item.email}</small></> : money(item.price)}</td><td className="num">{'idCard' in item ? item.idCard : 'capacity' in item ? `${item.capacity} khách` : `${item.category || 'Khác'} / ${item.unit}`}</td><td><span className={`status ${item.status === 'active' ? 'available' : 'maintenance'}`}><span aria-hidden="true" />{item.status === 'active' ? 'Hoạt động' : 'Ngừng sử dụng'}</span></td><td><div className="action-row">{canEdit && <button type="button" className="text-button" onClick={() => setEditing(item)}>Chỉnh sửa</button>}{'fullName' in item && <button type="button" className="text-button" onClick={() => setHistory(item)}>Lịch sử</button>}</div></td></tr>)}</tbody></table></div><Pager data={result.data} page={page} setPage={setPage} /></section>}
    {editing && <RecordForm title={`${editing === 'new' ? 'Thêm' : 'Sửa'} ${names[kind].toLowerCase()}`} initial={initial} fields={catalogFields[kind]} save={save} close={() => setEditing(null)} />}{history && <CustomerHistory customer={history} close={() => setHistory(undefined)} />}
  </>;
}
export function RoomsPage({ user }: { user: UserView }) {
  const [q, setQ] = useState(''), [floor, setFloor] = useState(''), [status, setStatus] = useState(''), [active, setActive] = useState('true'), [typeId, setTypeId] = useState(''), [page, setPage] = useState(1);
  const [editing, setEditing] = useState<RoomView | 'new' | null>(null), [success, setSuccess] = useState(''), [actionError, setActionError] = useState(''), [busyId, setBusyId] = useState('');
  const types = useRemote<Page<RoomTypeView>>('/room-types?limit=200');
  const query = new URLSearchParams({ q, active, page: String(page), limit: '12', ...(floor !== '' ? { floor } : {}), ...(status ? { status } : {}), ...(typeId ? { typeId } : {}) });
  const result = useRemote<Page<RoomView>>(`/rooms?${query}`);
  const fields: Field[] = [{ key: 'number', label: 'Số phòng', required: true, maxLength: 20 }, { key: 'floor', label: 'Tầng', type: 'number', required: true, min: -10, max: 200 }, { key: 'typeId', label: 'Loại phòng', required: true, options: [{ value: '', label: 'Chọn loại phòng' }, ...(types.data?.items || []).map(t => ({ value: t.id, label: `${t.name} (${t.capacity} khách)${t.status === 'inactive' ? ' · Ngừng sử dụng' : ''}` }))] }, { key: 'status', label: 'Trạng thái hiện tại', options: Object.entries(roomLabels).map(([value, label]) => ({ value, label, disabled: value === 'occupied' })) }, { key: 'active', label: 'Sử dụng trong danh mục', options: [{ value: 'true', label: 'Đang sử dụng' }, { value: 'false', label: 'Ngừng sử dụng' }] }];
  const initial = editing && editing !== 'new' ? { number: editing.number, floor: editing.floor, typeId: editing.typeId, status: editing.status, active: String(editing.active) } : { number: '', floor: 1, typeId: '', status: 'available', active: 'true' };
  async function save(values: Record<string, string | number>) {
    await api('/rooms' + (editing && editing !== 'new' ? '/' + editing.id : ''), { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify({ ...values, active: values.active === 'true', ...(editing && editing !== 'new' ? { version: editing.version } : {}) }) });
    setActionError(''); setSuccess('Đã lưu phòng.'); result.reload();
  }
  async function markReady(room: RoomView) {
    setBusyId(room.id); setActionError(''); setSuccess('');
    try {
      await api(`/rooms/${room.id}/mark-ready`, { method: 'POST', body: JSON.stringify({ version: room.version }) });
      setSuccess(`Phòng ${room.number} đã được xác nhận dọn xong và chuyển sang Sẵn sàng.`);
      result.reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally { setBusyId(''); }
  }
  return <><div className="page-title"><div><div className="eyebrow">DANH MỤC</div><h1>Phòng khách sạn</h1><p>Trạng thái hiện tại của phòng. Để tra lịch trống theo ngày, mở Tạo đặt phòng.</p></div><div className="action-row"><a className="button secondary" href="#room-types">Loại phòng</a>{user.role === 'admin' && <button type="button" className="button primary" onClick={() => setEditing('new')} disabled={!types.data}><Plus size={16} aria-hidden="true" />Thêm phòng</button>}</div></div>{success && <div className="success" role="status"><Check size={16} aria-hidden="true" /><span>{success}</span></div>}<ErrorBox error={actionError} />
    <div className="toolbar wrap"><label className="search-field"><Search size={18} aria-hidden="true" /><input aria-label="Tìm phòng" placeholder="Số phòng, loại phòng…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /></label><label>Tầng<input type="number" min={-10} max={200} placeholder="Tất cả" value={floor} onChange={e => { setFloor(e.target.value); setPage(1); }} /></label><label>Loại phòng<select value={typeId} onChange={e => { setTypeId(e.target.value); setPage(1); }}><option value="">Tất cả loại</option>{types.data?.items.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Trạng thái<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Tất cả trạng thái</option>{Object.entries(roomLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>Sử dụng<select value={active} onChange={e => { setActive(e.target.value); setPage(1); }}><option value="true">Đang sử dụng</option><option value="false">Đã ngừng</option><option value="all">Tất cả</option></select></label><button type="button" className="icon-button" aria-label="Tải lại phòng" onClick={result.reload}><RefreshCw size={18} aria-hidden="true" /></button></div>
    <ErrorBox error={result.error || types.error} retry={() => { result.reload(); types.reload(); }} /><LoadState busy={result.busy} empty={result.data?.total === 0} /><div className="result-count"><span className="num">{result.data?.total ?? '…'}</span> phòng</div><div className="room-grid">{result.data?.items.map(r => <article className="room-card" key={r.id}><div className="room-card-top"><BedDouble size={22} aria-hidden="true" /><span className={`status ${r.status}`}><span aria-hidden="true" />{roomLabels[r.status]}</span></div><h3 className="num">{r.number}<span>{r.typeName}</span></h3><div className="room-meta"><span>{r.capacity} khách</span><span>Tầng {r.floor}</span></div><div className="room-price num">{money(r.price)}<span> / đêm</span></div>{!r.active && <p className="muted">Đã ngừng sử dụng</p>}{user.role === 'admin' && <div className="room-actions">{r.status === 'cleaning' && <button type="button" className="text-button" disabled={busyId === r.id} onClick={() => markReady(r)}><Check size={15} aria-hidden="true" />{busyId === r.id ? 'Đang cập nhật…' : 'Dọn xong'}</button>}<button type="button" className="text-button room-edit" disabled={r.status === 'occupied' || busyId === r.id} onClick={() => setEditing(r)}>Chỉnh sửa</button></div>}</article>)}</div><Pager data={result.data} page={page} setPage={setPage} />{editing && <RecordForm title={editing === 'new' ? 'Thêm phòng' : 'Sửa phòng'} initial={initial} fields={fields} save={save} close={() => setEditing(null)} />}</>;
}
