import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';
import { PaymentsTable } from './billing-ui';
import { calendarLabel, ErrorBox, errorMessage, LoadState, Modal, money, useRemote } from './workspace-ui';
import { hotelDay, nextDay, nightsBetween } from '../../shared/dates';
import type { BookingView, ConfirmationQuote, PaymentMethod, UserView } from '../../shared/types';

type Action = 'confirm' | 'deposits' | 'cancel' | 'refunds' | 'check-in' | 'extend' | 'reschedule';
type Pending = { action: Action; body: string };
const labels: Record<Action, string> = { confirm: 'Xác nhận & nhận cọc', deposits: 'Nhận cọc bổ sung', cancel: 'Hủy đặt phòng', refunds: 'Duyệt & ghi nhận hoàn cọc', 'check-in': 'Nhận phòng', extend: 'Gia hạn lưu trú', reschedule: 'Đổi lịch nhận/trả' };
export const historyLabels: Record<string, string> = { created: 'Tạo phiếu nháp', draft_updated: 'Cập nhật phiếu nháp', confirmed: 'Xác nhận & nhận cọc', deposit_received: 'Nhận cọc bổ sung', cancelled: 'Hủy đặt phòng', refunded: 'Hoàn cọc', checked_in: 'Nhận phòng', extended: 'Gia hạn', rescheduled: 'Đổi lịch', service_added: 'Ghi nhận dịch vụ', service_corrected: 'Sửa/hủy dịch vụ', checked_out: 'Trả phòng & lập hóa đơn', invoice_adjusted: 'Điều chỉnh hóa đơn' };
const methods: Record<PaymentMethod, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };
const localTime = (s: string) => new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

export function BookingActions({ booking: b, user, reload }: { booking: BookingView; user: UserView; reload: () => void }) {
  const storageKey = `hotel-command:${user.id}:${b.id}`;
  const [pending, setPending] = useState<Pending | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { return null; }
  });
  const [action, setAction] = useState<Action>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function send(value: Pending) {
    setBusy(true); setError(''); setPending(value); sessionStorage.setItem(storageKey, JSON.stringify(value));
    try {
      await api(`/bookings/${b.id}/${value.action}`, { method: 'POST', body: value.body });
      sessionStorage.removeItem(storageKey); setPending(null); setAction(undefined); reload();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status < 500) { sessionStorage.removeItem(storageKey); setPending(null); }
    } finally { setBusy(false); }
  }
  async function submit(data: object) {
    if (pending) return send(pending);
    await send({ action: action!, body: JSON.stringify({ requestId: crypto.randomUUID(), version: b.version, ...data }) });
  }
  const allowed: Action[] = b.status === 'pending' ? ['confirm', 'cancel'] : b.status === 'confirmed' ? ['check-in', 'deposits', 'reschedule', 'cancel'] : b.status === 'checked_in' ? ['extend'] : b.refundStatus === 'pending' && user.role === 'admin' ? ['refunds'] : [];
  return <section className="section booking-operations"><h2>Thao tác với phiếu</h2>
    {pending && <div className="phase-notice"><div><strong>Yêu cầu cần kiểm tra: {labels[pending.action]}</strong><span>Gửi lại cùng mã yêu cầu để kiểm tra kết quả; hệ thống không ghi tiền lần thứ hai.</span><button className="button secondary" disabled={busy} onClick={() => send(pending)}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra & gửi lại an toàn'}</button></div></div>}
    {!action && <ErrorBox error={error} />}
    {b.refundStatus === 'pending' && <p className="refund-notice">Chờ quản trị viên hoàn {money(b.deposit)}. Lịch phòng đã được giải phóng.</p>}
    {b.refundStatus === 'refunded' && <p className="success">Đã hoàn toàn bộ cọc: {money(b.refundedTotal)}.</p>}
    <div className="action-row">{allowed.map(a => <button key={a} className={`button ${a === 'confirm' || a === 'check-in' || a === 'refunds' ? 'primary' : 'secondary'}`} disabled={busy || !!pending} onClick={() => { setError(''); setAction(a); }}>{labels[a]}</button>)}</div>
    {b.status === 'checked_in' && <p className="helper-text">Khách đang lưu trú. Ghi dịch vụ và trả phòng tại phần Dịch vụ phát sinh & thanh toán bên dưới.</p>}
    {b.actualCheckIn && <p>Đã nhận phòng lúc {localTime(b.actualCheckIn)}.</p>}{b.actualCheckOut && <p>Đã trả phòng lúc {localTime(b.actualCheckOut)}.</p>}
    {action && <ActionForm key={action} action={action} b={b} busy={busy} pending={!!pending} error={error} close={() => setAction(undefined)} submit={submit} />}
  </section>;
}
function ActionForm({ action, b, busy, pending, error, close, submit }: { action: Action; b: BookingView; busy: boolean; pending: boolean; error: string; close: () => void; submit: (body: object) => Promise<void> }) {
  const quote = useRemote<{ quote: ConfirmationQuote }>(action === 'confirm' ? `/bookings/${b.id}/confirmation-quote` : null);
  const [amount, setAmount] = useState(0), [method, setMethod] = useState<PaymentMethod>('cash'), [reference, setReference] = useState(''), [reason, setReason] = useState('');
  const [checkIn, setCheckIn] = useState(b.checkIn), [checkOut, setCheckOut] = useState(action === 'extend' ? nextDay(b.checkOut > hotelDay(new Date()) ? b.checkOut : hotelDay(new Date())) : b.checkOut);
  useEffect(() => { if (quote.data) setAmount(quote.data.quote.minimumDeposit); }, [quote.data]);
  const monetary = ['confirm', 'deposits', 'refunds'].includes(action);
  const reasonNeeded = ['cancel', 'refunds', 'extend', 'reschedule'].includes(action);
  const revisedTotal = b.rooms.reduce((n, r) => n + r.price * nightsBetween(checkIn, checkOut), 0);
  async function send(e: FormEvent) {
    e.preventDefault();
    const data = action === 'confirm' ? { amount, method, reference, quoteToken: quote.data!.quote.token } : action === 'deposits' ? { amount, method, reference } : action === 'refunds' ? { method, reference, reason } : action === 'cancel' ? { reason } : action === 'extend' ? { checkOut, reason } : action === 'reschedule' ? { checkIn, checkOut, reason } : {};
    await submit(data);
  }
  return <Modal title={labels[action]} busy={busy} close={close}><form onSubmit={send}>
    {action === 'confirm' && <><LoadState busy={quote.busy} /><ErrorBox error={quote.error} retry={quote.reload} />{quote.data && <div className="command-summary"><p>Khách: <strong>{quote.data.quote.customer.fullName}</strong></p><p>{quote.data.quote.rooms.map(r => `Phòng ${r.number}: ${money(r.price)}/đêm`).join(' · ')}</p><p>{quote.data.quote.nights} đêm · Tổng mới: <strong>{money(quote.data.quote.total)}</strong></p><p>Cọc tối thiểu {quote.data.quote.depositPercent}%: <strong>{money(quote.data.quote.minimumDeposit)}</strong></p></div>}</>}
    {action === 'cancel' && <p>Hủy phiếu sẽ giải phóng toàn bộ lịch phòng. {b.deposit > 0 ? `Khoản cọc ${money(b.deposit)} chuyển sang chờ quản trị viên xác nhận hoàn toàn bộ.` : 'Phiếu chưa có cọc cần hoàn.'}</p>}
    {action === 'refunds' && <p>Hoàn toàn bộ cọc còn giữ: <strong>{money(b.deposit)}</strong>. Ghi nhận sau khi đã kiểm tra việc hoàn tiền cho khách.</p>}
    {action === 'check-in' && <p>Nhận đồng thời phòng <strong>{b.rooms.map(r => r.number).join(', ')}</strong> ngày {calendarLabel(b.checkIn)}. Mọi phòng phải đã dọn xong và sẵn sàng giao khách.</p>}
    <fieldset disabled={busy || pending || (action === 'confirm' && !quote.data)} className="form-fields">
      {(action === 'extend' || action === 'reschedule') && <>{action === 'reschedule' && <label>Ngày nhận mới<input type="date" required min={hotelDay(new Date())} max="2100-12-30" value={checkIn} onChange={e => setCheckIn(e.target.value)} /></label>}<label>Ngày trả mới<input type="date" required min={action === 'extend' ? nextDay(b.checkOut) : nextDay(checkIn)} max="2100-12-31" value={checkOut} onChange={e => setCheckOut(e.target.value)} /></label><p>Giữ đơn giá đã chốt. Tiền phòng theo lịch mới: <strong>{money(Number.isFinite(revisedTotal) ? Math.max(0, revisedTotal) : 0)}</strong>.</p></>}
      {(action === 'confirm' || action === 'deposits') && <label>Số tiền cọc nhận (đồng)<input type="number" required min={action === 'confirm' ? quote.data?.quote.minimumDeposit || 0 : 1} max={action === 'confirm' ? quote.data?.quote.total : b.estimatedTotal - b.deposit} step={1} value={amount} onChange={e => setAmount(Number(e.target.value))} /><small>{action === 'deposits' && `Có thể nhận thêm tối đa ${money(b.estimatedTotal - b.deposit)}.`}</small></label>}
      {monetary && <><label>Phương thức<select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}>{Object.entries(methods).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>Mã tham chiếu (nếu có)<input maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></label></>}
      {reasonNeeded && <label>Lý do<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>}
      {(monetary || action === 'check-in') && <label className="acknowledgement"><input type="checkbox" required />{action === 'check-in' ? 'Đã kiểm tra giấy tờ khách và tình trạng từng phòng.' : action === 'refunds' ? 'Đã xác minh hoàn tiền cho khách.' : 'Đã kiểm tra số tiền và phương thức nhận cọc.'}</label>}
      {monetary && <p className="helper-text">Hệ thống ghi sổ tại quầy; nhân viên xác minh giao dịch bên ngoài. Không nhập thông tin thẻ.</p>}
    </fieldset><ErrorBox error={error} />
    <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Đóng</button>{pending ? <button type="button" className="button primary" disabled={busy} onClick={() => submit({})}>Kiểm tra lại yêu cầu</button> : <button className="button primary" disabled={busy || (action === 'confirm' && !quote.data)}>{busy ? 'Đang xử lý…' : labels[action]}</button>}</div>
  </form></Modal>;
}
export function PaymentLedger({ booking: b }: { booking: BookingView }) {
  return <section className="section"><h2>Sổ thu & hoàn tiền</h2>{!b.payments.length ? <p className="muted">Chưa có khoản thu hoặc hoàn.</p> : <PaymentsTable payments={b.payments} />}</section>;
}
