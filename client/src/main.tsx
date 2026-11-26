import React, { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, BedDouble, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp, Database, Eye, EyeOff, FileChartColumn, KeyRound, LayoutDashboard, LoaderCircle, LogOut, Menu, Plus, ReceiptText, RefreshCw, Search, ShieldCheck, Tag, Users } from 'lucide-react';
import { api, ApiError } from './api';
import type { Overview, RoomView, UserView } from '../../shared/types';
import { RoomsPage, CatalogPage } from './catalogs';
import { BookingsPage } from './bookings';
import { PromotionsPage } from './promotions';
import { InvoicesPage } from './invoices';
import { ReportsPage } from './reports';
import { DataToolsPage } from './data-tools';
import { Modal } from './workspace-ui';
import './styles.css';
import './workspace.css';

const money = (v: number) => new Intl.NumberFormat('vi-VN').format(v) + ' ₫';
const roleName = (role: string) => role === 'admin' ? 'Quản trị viên' : 'Lễ tân';
const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Không thể kết nối. Vui lòng thử lại.';
type View = 'overview' | 'rooms' | 'users' | 'profile' | 'room-types' | 'services' | 'customers' | 'bookings' | 'promotions' | 'invoices' | 'reports' | 'my-receipts' | 'data-tools';
function Brand({ dark = false }: { dark?: boolean }) {
  return <div className={`brand ${dark ? 'brand-dark' : ''}`}><span className="brand-icon"><Building2 size={22} aria-hidden="true" /></span><span>HOTEL DESK<small>NHÓM 3 · QUẢN LÝ KHÁCH SẠN</small></span></div>;
}
function Loading() { return <div className="loading" role="status" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /> Đang tải dữ liệu…</div>; }
function Alert({ children }: { children: ReactNode }) { return <div className="alert" role="alert">{children}</div>; }
function PasswordField({ id, label, value, setValue, autoComplete = 'current-password', minLength }: { id: string; label: string; value: string; setValue: (v: string) => void; autoComplete?: string; minLength?: number }) {
  const [visible, setVisible] = useState(false);
  return <label htmlFor={id}>{label}<span className="password-field"><input id={id} name={id} type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={e => setValue(e.target.value)} required minLength={minLength} maxLength={72} /><button type="button" className="icon-button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={visible}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></span></label>;
}
function Login({ onLogin }: { onLogin: (user: UserView) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const result = await api<{ user: UserView }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); onLogin(result.user); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  function fill(role: 'admin' | 'staff') { setUsername(role === 'admin' ? 'admin' : 'letan'); setPassword(role === 'admin' ? 'AdminDemo2026!' : 'LetanDemo2026!'); setError(''); }
  return <main className="login-layout">
    <section className="login-story"><Brand /><div className="story-content"><div className="eyebrow light">CỔNG LÀM VIỆC NỘI BỘ</div><h1>Quản lý khách sạn.<br /><span>Một nơi làm việc chung.</span></h1><p>Dành cho lễ tân và quản trị viên, từ tra cứu phòng, lưu trú, hóa đơn snapshot đến báo cáo doanh thu và sao lưu MongoDB.</p><div className="story-rule" /><div className="story-feature"><ShieldCheck aria-hidden="true" /><div><strong>Đúng người, đúng quyền</strong><span>Kiểm soát quyền truy cập độc lập tại máy chủ API.</span></div></div><div className="story-feature"><Database aria-hidden="true" /><div><strong>Dữ liệu nhất quán trên MongoDB</strong><span>Transaction chống đặt trùng lịch và bảo toàn hóa đơn lịch sử.</span></div></div></div><div className="story-footer">ĐỒ ÁN HỌC PHẦN NOSQL<span>NHÓM 3 · MONGODB</span></div></section>
    <section className="login-main"><div className="login-card"><span className="round-icon"><KeyRound size={24} aria-hidden="true" /></span><div className="eyebrow">CHÀO MỪNG TRỞ LẠI</div><h2>Đăng nhập</h2><p className="muted">Sử dụng tài khoản nội bộ để tiếp tục.</p><form onSubmit={submit} aria-label="Đăng nhập">
      <label htmlFor="username">Tên đăng nhập<input id="username" name="username" autoComplete="username" required autoFocus value={username} onChange={e => setUsername(e.target.value)} placeholder="Nhập tên đăng nhập" maxLength={40} /></label>
      <PasswordField id="password" label="Mật khẩu" value={password} setValue={setPassword} />
      {error && <Alert>{error}</Alert>}<button type="submit" className="button primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <>Vào không gian làm việc <ArrowRight size={18} aria-hidden="true" /></>}</button>
    </form>{import.meta.env.DEV && <div className="demo-login"><span>Bạn đang dùng bản mẫu cục bộ</span><div><button type="button" onClick={() => fill('admin')}>Điền tài khoản quản trị</button><button type="button" onClick={() => fill('staff')}>Điền tài khoản lễ tân</button></div></div>}<p className="login-help"><CircleHelp size={16} aria-hidden="true" /> Cần tài khoản? Liên hệ quản trị viên của nhóm.</p></div><div className="login-copyright">Nhóm 3 · Hệ thống quản lý khách sạn</div></section>
  </main>;
}
function Status({ status }: { status: RoomView['status'] }) {
  const labels = { available: 'Sẵn sàng', occupied: 'Đang có khách', cleaning: 'Đang dọn', maintenance: 'Bảo trì' };
  return <span className={`status ${status}`}><span aria-hidden="true" />{labels[status]}</span>;
}
function RoomCard({ room }: { room: RoomView }) {
  return <article className="room-card"><div className="room-card-top"><BedDouble size={22} aria-hidden="true" /><Status status={room.status} /></div><h3 className="num">{room.number}<span>{room.typeName}</span></h3><div className="room-meta"><span><Users size={14} aria-hidden="true" /> {room.capacity} khách</span><span>Tầng {room.floor}</span></div><div className="room-price num">{money(room.price)}<span> / đêm</span></div></article>;
}
function OverviewPage({ go, user }: { go: (view: View) => void; user: UserView }) {
  const [data, setData] = useState<Overview>();
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() { setBusy(true); setError(''); try { const [d, r] = await Promise.all([api<Overview>('/overview'), api<{ items: RoomView[] }>('/rooms')]); setData(d); setRooms(r.items); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, []);
  if (!data && !error) return <Loading />;
  const totalRooms = Math.max(1, data?.rooms || 0);
  const segments = data ? [
    { key: 'available', label: 'Sẵn sàng', count: data.available },
    { key: 'occupied', label: 'Đang có khách', count: data.occupied ?? 0 },
    { key: 'cleaning', label: 'Đang dọn', count: data.cleaning ?? 0 },
    { key: 'maintenance', label: 'Bảo trì', count: data.maintenance ?? 0 },
  ] : [];
  return <><div className="page-title"><div><div className="eyebrow">KHÔNG GIAN LÀM VIỆC</div><h1>Tổng quan khách sạn</h1><p>Chào {user.fullName}. Đây là tình trạng dữ liệu hiện tại từ MongoDB.</p></div><button type="button" className="button secondary" onClick={load} disabled={busy}><RefreshCw size={16} aria-hidden="true" className={busy ? 'spin' : ''} /> Cập nhật</button></div>
    {error && <Alert>{error}</Alert>}{data && <><div className="phase-notice"><span className="notice-icon"><Check size={18} aria-hidden="true" /></span><div><strong>Đặt phòng, thanh toán, báo cáo & sao lưu từ dữ liệu thật</strong><span>{user.role === 'admin' ? 'Quản trị theo dõi doanh thu, dòng tiền, công suất phòng và sao lưu/khôi phục dữ liệu.' : 'Lễ tân tra phòng trống, tiếp nhận khách, ghi dịch vụ, thanh toán và xem sổ thu cá nhân.'}</span><button type="button" className="text-button" onClick={() => go(user.role === 'admin' ? 'reports' : 'my-receipts')}>{user.role === 'admin' ? 'Mở báo cáo quản trị' : 'Mở sổ thu của tôi'}</button></div><span className="phase-tag">SẴN SÀNG</span></div>
    {data.demo && <div className="data-caption"><span className="demo-dot" aria-hidden="true" /> Dữ liệu mẫu để nhóm thực hành</div>}
    <div className="stats"><Stat label="Tổng số phòng" value={data.rooms} note={`${data.roomTypes} loại phòng đang hoạt động`} icon={<BedDouble aria-hidden="true" />} /><Stat label="Phòng sẵn sàng" value={data.available} note={`Đang ở: ${data.occupied ?? 0} · Đang dọn: ${data.cleaning ?? 0}`} icon={<Building2 aria-hidden="true" />} /><Stat label="Hồ sơ khách hàng" value={data.customers} note={data.customers === 0 ? 'Chưa nhập khách hàng' : 'Hồ sơ đã lưu'} icon={<Users aria-hidden="true" />} /><Stat label="Phiếu đặt phòng" value={data.bookings} note={`Đến hôm nay: ${data.todayArrivals ?? 0} · Đi: ${data.todayDepartures ?? 0}`} icon={<CalendarDays aria-hidden="true" />} /></div>
    <section className="section">
      <div className="section-title">
        <div><h2>Phân bổ trạng thái phòng</h2><p>Theo dõi trực quan số phòng sẵn sàng, đang lưu trú, đang dọn và bảo trì.</p></div>
        {(data.pendingRefunds ?? 0) > 0 && <a className="booking-badge pending" href="#bookings">{data.pendingRefunds} phiếu chờ hoàn cọc</a>}
      </div>
      <div className="status-meter" aria-hidden="true">{segments.map(s => s.count > 0 && <span key={s.key} className={`meter-seg ${s.key}`} style={{ width: `${(s.count / totalRooms) * 100}%` }} />)}</div>
      <div className="status-legend">{segments.map(s => <div key={s.key} className="legend-item"><span className={`status ${s.key}`}><span aria-hidden="true" />{s.label}</span><strong className="num">{s.count} phòng</strong></div>)}</div>
    </section>
    <section className="section"><div className="section-title"><div><h2>Phòng trong khách sạn</h2><p>Thông tin danh mục và trạng thái phòng hiện tại</p></div><button type="button" className="text-button" onClick={() => go('rooms')}>Xem tất cả <ArrowRight size={16} aria-hidden="true" /></button></div>{rooms.length ? <div className="room-grid preview">{rooms.slice(0, 4).map(r => <RoomCard key={r.id} room={r} />)}</div> : <div className="empty"><BedDouble aria-hidden="true" /> Chưa có phòng trong danh mục.</div>}</section>
    <div className="overview-bottom"><section className="section activity"><h2>Hoạt động lưu trú</h2><div className="empty"><span className="empty-icon"><CalendarDays size={27} aria-hidden="true" /></span><strong>{data.bookings ? `${data.bookings} phiếu đặt phòng đã lưu (${data.activeBookings ?? 0} lượt đang giữ lịch/ở)` : 'Sẵn sàng lập phiếu đặt đầu tiên'}</strong><p>Tra lịch, xác nhận đặt phòng, nhận cọc và theo dõi lượt lưu trú.</p><div className="action-row"><button type="button" className="button primary" onClick={() => { window.location.hash = 'bookings/new'; }}>Tạo đặt phòng</button><button type="button" className="button secondary" onClick={() => go('bookings')}>Danh sách đặt phòng</button></div></div></section><section className="section access-card"><ShieldCheck size={28} aria-hidden="true" /><h2>Quyền của bạn</h2><p>Bạn đang đăng nhập với vai trò <strong>{roleName(user.role).toLowerCase()}</strong>.</p><ul><li><Check size={16} aria-hidden="true" /> Tra phòng và quản lý khách hàng</li><li><Check size={16} aria-hidden="true" /> Quản lý mật khẩu cá nhân</li><li><Check size={16} aria-hidden="true" /> {user.role === 'admin' ? 'Quản trị tài khoản, báo cáo và sao lưu dữ liệu' : 'Ghi dịch vụ, thanh toán và xem sổ thu cá nhân'}</li></ul><button type="button" className="text-button" onClick={() => go(user.role === 'admin' ? 'users' : 'profile')}>{user.role === 'admin' ? 'Quản lý tài khoản' : 'Xem tài khoản của tôi'} <ArrowRight size={16} aria-hidden="true" /></button></section></div></>}
  </>;
}
function Stat({ label, value, note, icon }: { label: string; value: number; note: string; icon: ReactNode }) { return <article className="stat"><div className="stat-label">{label}<span>{icon}</span></div><strong className="num">{String(value).padStart(2, '0')}</strong><p>{note}</p></article>; }
function UsersPage({ currentUser }: { currentUser: UserView }) {
  const [items, setItems] = useState<UserView[]>(); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [modal, setModal] = useState(false); const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(''); const [fullName, setFullName] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState<'admin' | 'staff'>('staff');
  const [formError, setFormError] = useState('');
  async function load() { setError(''); try { const d = await api<{ items: UserView[]; total: number }>(`/users?page=${page}&limit=10`); setItems(d.items); setTotal(d.total); } catch (e) { setError(errorMessage(e)); } }
  useEffect(() => { void load(); }, [page]);
  async function toggle(user: UserView) {
    const status = user.status === 'active' ? 'locked' : 'active';
    if (!window.confirm(`${status === 'locked' ? 'Khóa' : 'Mở khóa'} tài khoản ${user.username}?${status === 'locked' ? ' Các phiên đăng nhập của tài khoản sẽ hết hiệu lực.' : ''}`)) return;
    setBusy(true); setError(''); setSuccess('');
    try { await api(`/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setSuccess('Đã cập nhật trạng thái tài khoản.'); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setFormError('');
    try { await api('/users', { method: 'POST', body: JSON.stringify({ username, fullName, password, role }) }); setModal(false); setPassword(''); setSuccess(`Đã tạo tài khoản ${username}.`); await load(); } catch (e) { setFormError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <><div className="page-title"><div><div className="eyebrow">QUẢN TRỊ</div><h1>Tài khoản nội bộ</h1><p>Cấp quyền làm việc và quản lý trạng thái đăng nhập của thành viên.</p></div><button type="button" className="button primary" onClick={() => { setUsername(''); setFullName(''); setPassword(''); setRole('staff'); setFormError(''); setModal(true); }}><Plus size={18} aria-hidden="true" /> Tạo tài khoản</button></div>{error && <Alert>{error} <button type="button" className="text-button" onClick={load}>Thử lại</button></Alert>}{success && <div className="success" role="status"><Check size={16} aria-hidden="true" /><span>{success}</span></div>}{!items && !error ? <Loading /> : <section className="section account-table"><div className="section-title"><h2>Danh sách tài khoản <span className="count-badge num">{total}</span></h2><span className="muted">Chỉ quản trị viên truy cập</span></div><div className="table-scroll"><table><thead><tr><th>Thành viên</th><th>Tên đăng nhập</th><th>Vai trò</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{items?.map(u => <tr key={u.id}><td><div className="member"><span className={`avatar ${u.role}`}>{u.fullName.split(' ').slice(-1)[0].slice(0, 1).toUpperCase()}</span><div><strong>{u.fullName}</strong>{u.id === currentUser.id && <small>Tài khoản của bạn</small>}</div></div></td><td>{u.username}</td><td><span className={`role-badge ${u.role}`}>{roleName(u.role)}</span></td><td><span className={`status ${u.status === 'active' ? 'available' : 'maintenance'}`}><span aria-hidden="true" />{u.status === 'active' ? 'Hoạt động' : 'Đã khóa'}</span></td><td>{u.role === 'staff' ? <button type="button" className="text-button" disabled={busy} onClick={() => toggle(u)}>{u.status === 'active' ? 'Khóa' : 'Mở khóa'}</button> : <span className="protected"><ShieldCheck size={16} aria-hidden="true" /> Bảo vệ</span>}</td></tr>)}</tbody></table></div><div className="pagination"><span>Trang <span className="num">{page} / {Math.max(1, Math.ceil(total / 10))}</span></span><div><button type="button" className="icon-button" aria-label="Trang trước" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" className="icon-button" aria-label="Trang sau" disabled={page * 10 >= total} onClick={() => setPage(page + 1)}><ChevronRight size={18} aria-hidden="true" /></button></div></div></section>}
    {modal && <Modal title="Tạo tài khoản nội bộ" busy={busy} close={() => setModal(false)}><form onSubmit={create}><label>Họ và tên<input autoFocus required minLength={2} maxLength={100} value={fullName} onChange={e => setFullName(e.target.value)} /></label><label>Tên đăng nhập<input required pattern="[a-z0-9_.\-]{3,40}" minLength={3} maxLength={40} autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} /><small>3–40 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.</small></label><label>Vai trò<select value={role} onChange={e => setRole(e.target.value as 'admin' | 'staff')}><option value="staff">Lễ tân</option><option value="admin">Quản trị viên</option></select></label><PasswordField id="new-user-password" label="Mật khẩu ban đầu" value={password} setValue={setPassword} autoComplete="new-password" minLength={12} /><p className="muted">Ít nhất 12 ký tự. Gửi riêng mật khẩu cho người sử dụng.</p>{formError && <Alert>{formError}</Alert>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setModal(false)}>Hủy</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button></div></form></Modal>}
  </>;
}
function ProfilePage({ user }: { user: UserView }) {
  const [currentPassword, setCurrent] = useState(''); const [newPassword, setNew] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setSuccess(''); if (newPassword !== confirm) { setError('Mật khẩu xác nhận chưa khớp.'); return; } setBusy(true);
    try { const r = await api<{ message: string }>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); setSuccess(r.message); setCurrent(''); setNew(''); setConfirm(''); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <><div className="page-title"><div><div className="eyebrow">CÁ NHÂN</div><h1>Tài khoản của tôi</h1><p>Thông tin đăng nhập và bảo mật tài khoản.</p></div></div><div className="profile-grid"><section className="section profile-info"><span className="avatar large">{user.fullName.slice(0, 1)}</span><h2>{user.fullName}</h2><span className={`role-badge ${user.role}`}>{roleName(user.role)}</span><dl><dt>Tên đăng nhập</dt><dd>{user.username}</dd><dt>Trạng thái</dt><dd>Đang hoạt động</dd></dl></section><section className="section password-panel"><h2>Đổi mật khẩu</h2><p className="muted">Sau khi đổi, các phiên đăng nhập khác sẽ kết thúc.</p><form onSubmit={submit}><PasswordField id="current-password" label="Mật khẩu hiện tại" value={currentPassword} setValue={setCurrent} /><PasswordField id="new-password" label="Mật khẩu mới" value={newPassword} setValue={setNew} minLength={12} autoComplete="new-password" /><PasswordField id="confirm-password" label="Nhập lại mật khẩu mới" value={confirm} setValue={setConfirm} minLength={12} autoComplete="new-password" />{error && <Alert>{error}</Alert>}{success && <div className="success" role="status"><Check size={16} aria-hidden="true" /><span>{success}</span></div>}<button type="submit" className="button primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Cập nhật mật khẩu'}</button></form></section></div></>;
}
function App() {
  const [user, setUser] = useState<UserView>(); const [initializing, setInitializing] = useState(true); const [initError, setInitError] = useState(''); const [logoutError, setLogoutError] = useState('');
  const [view, setView] = useState<View>('overview'); const [route, setRoute] = useState('overview'); const [menu, setMenu] = useState(false);
  function go(v: View) { window.location.hash = v; setMenu(false); }
  async function restore() { setInitializing(true); setInitError(''); try { setUser((await api<{ user: UserView }>('/auth/me')).user); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) setInitError(errorMessage(e)); } finally { setInitializing(false); } }
  useEffect(() => { void restore(); const end = () => setUser(undefined); window.addEventListener('session-ended', end); return () => window.removeEventListener('session-ended', end); }, []);
  useEffect(() => { const handle = () => { const hash = window.location.hash.slice(1); const base = hash.split('/')[0]; setRoute(hash); setView(['overview', 'rooms', 'users', 'profile', 'room-types', 'services', 'customers', 'bookings', 'promotions', 'invoices', 'reports', 'my-receipts', 'data-tools'].includes(base) ? base as View : 'overview'); }; handle(); window.addEventListener('hashchange', handle); return () => window.removeEventListener('hashchange', handle); }, []);
  async function logout() { setLogoutError(''); try { await api('/auth/logout', { method: 'POST', body: '{}' }); setUser(undefined); go('overview'); } catch (e) { setLogoutError(errorMessage(e)); } }
  if (initializing) return <Loading />;
  if (initError) return <main className="connection-error"><Building2 size={32} aria-hidden="true" /><h1>Chưa kết nối được hệ thống</h1><p>{initError}</p><button type="button" className="button primary" onClick={restore}><RefreshCw size={18} aria-hidden="true" /> Thử lại</button></main>;
  if (!user) return <Login onLogin={u => { setUser(u); go('overview'); }} />;
  const nav = [{ id: 'overview' as View, label: 'Tổng quan', icon: LayoutDashboard }, { id: 'rooms' as View, label: 'Phòng khách sạn', icon: BedDouble }, { id: 'bookings' as View, label: 'Đặt phòng', icon: CalendarDays }, { id: 'customers' as View, label: 'Khách hàng', icon: Users }, { id: 'room-types' as View, label: 'Loại phòng', icon: Building2 }, { id: 'services' as View, label: 'Dịch vụ', icon: ReceiptText }, { id: 'promotions' as View, label: 'Khuyến mãi', icon: Tag }, { id: 'invoices' as View, label: 'Hóa đơn', icon: ReceiptText }, ...(user.role === 'admin' ? [{ id: 'reports' as View, label: 'Báo cáo', icon: FileChartColumn }] : []), { id: 'my-receipts' as View, label: 'Sổ thu của tôi', icon: ReceiptText }];
  const adminNav = [{ id: 'users' as View, label: 'Tài khoản nội bộ', icon: ShieldCheck }, { id: 'data-tools' as View, label: 'Sao lưu & Dữ liệu', icon: Database }];
  const currentTitle = view === 'profile' ? 'Cá nhân' : [...nav, ...adminNav].find(n => n.id === view)?.label || 'Tổng quan';
  return <div className="app-layout">{menu && <button type="button" className="mobile-backdrop" aria-label="Đóng menu" onClick={() => setMenu(false)} />}<aside className={`sidebar ${menu ? 'open' : ''}`}><Brand /><div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div><nav aria-label="Điều hướng chính">{nav.map(n => <a key={n.id} href={`#${n.id}`} className={view === n.id ? 'active' : ''} aria-current={view === n.id ? 'page' : undefined} onClick={() => setMenu(false)}><n.icon size={19} aria-hidden="true" />{n.label}{view === n.id && <span className="nav-indicator" aria-hidden="true" />}</a>)}</nav>{user.role === 'admin' && <><div className="workspace-label admin-label">QUẢN TRỊ</div><nav aria-label="Điều hướng quản trị">{adminNav.map(n => <a key={n.id} href={`#${n.id}`} className={view === n.id ? 'active' : ''} aria-current={view === n.id ? 'page' : undefined} onClick={() => setMenu(false)}><n.icon size={19} aria-hidden="true" />{n.label}{view === n.id && <span className="nav-indicator" aria-hidden="true" />}</a>)}</nav></>}<div className="sidebar-bottom"><div className="phase-card"><span className="phase-label">HOÀN THIỆN · NHÓM 3</span><strong>Vận hành & Sao lưu MongoDB</strong><div className="phase-progress"><span /></div><small>Báo cáo · Export/Import · Backup</small></div><button type="button" className="sidebar-user" onClick={() => go('profile')}><span className="avatar">{user.fullName.slice(0, 1)}</span><span><strong>{user.fullName}</strong><small>{roleName(user.role)}</small></span><ChevronRight size={16} aria-hidden="true" /></button></div></aside>
    <div className="main-layout"><header className="topbar"><div><button type="button" className="icon-button mobile-menu" aria-label="Mở menu" onClick={() => setMenu(!menu)}><Menu aria-hidden="true" /></button><span className="breadcrumb">Khách sạn <ChevronRight size={14} aria-hidden="true" /> {currentTitle}</span></div><div className="topbar-right"><span className="today"><CalendarDays size={16} aria-hidden="true" />{new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())}</span><button type="button" className="logout-button" onClick={logout} aria-label="Đăng xuất"><LogOut size={17} aria-hidden="true" /><span>Đăng xuất</span></button></div></header><main className="content">{logoutError && <Alert>{logoutError}</Alert>}{view === 'overview' && <OverviewPage go={go} user={user} />}{view === 'rooms' && <RoomsPage user={user} />}{(view === 'room-types' || view === 'services' || view === 'customers') && <CatalogPage key={view} kind={view} user={user} />}{view === 'bookings' && <BookingsPage route={route} user={user} />}{view === 'promotions' && <PromotionsPage user={user} />}{view === 'invoices' && <InvoicesPage route={route} user={user} />}{(view === 'reports' || view === 'my-receipts') && <ReportsPage user={user} personal={view === 'my-receipts'} />}{view === 'data-tools' && <DataToolsPage user={user} />}{view === 'users' && (user.role === 'admin' ? <UsersPage currentUser={user} /> : <section className="section denied"><ShieldCheck size={32} aria-hidden="true" /><h1>Bạn không có quyền truy cập</h1><p>Màn hình này dành cho quản trị viên.</p><button type="button" className="button primary" onClick={() => go('overview')}>Về tổng quan</button></section>)}{view === 'profile' && <ProfilePage user={user} />}</main><footer className="app-footer"><span>Hotel Desk · Nhóm 3</span><span>Hệ thống quản lý khách sạn · MongoDB</span></footer></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
