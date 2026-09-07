import { useRef, useState } from 'react';
import { api, ApiError } from './api';
import { ErrorBox, errorMessage, money } from './workspace-ui';
import type { BillingTotals, BookingView, PaymentMethod } from '../../shared/types';

export const paymentMethods: Record<PaymentMethod, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };
export const localTime = (s: string) => s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
type Pending = { path: string; method: 'POST' | 'PATCH'; body: string; label: string };
export function useSafeMutation<T>(key: string, prefix: string, onSuccess: (data: T, request: Pending) => void) {
  const [pending, setPending] = useState<Pending | null>(() => {
    try {
      const p = JSON.parse(sessionStorage.getItem(key) || 'null');
      return p && typeof p.path === 'string' && p.path.startsWith(prefix) && ['POST', 'PATCH'].includes(p.method) && typeof p.body === 'string' ? p : null;
    } catch { return null; }
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false);
  async function perform(p: Pending) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      // Persist before sending money/service commands. Keep the exact UUID/body after an uncertain response.
      sessionStorage.setItem(key, JSON.stringify(p)); setPending(p);
      const data = await api<T>(p.path, { method: p.method, body: p.body });
      sessionStorage.removeItem(key); setPending(null); onSuccess(data, p);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status < 500) { sessionStorage.removeItem(key); setPending(null); }
    } finally { setBusy(false); inFlight.current = false; }
  }
  return { pending, busy, error, setError, retry: () => pending ? perform(pending) : Promise.resolve(),
    send: (path: string, method: Pending['method'], body: object, label: string) => perform(pending || { path, method, body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }), label }) };
}
export function MutationNotice({ mutation }: { mutation: Pick<ReturnType<typeof useSafeMutation>, 'pending' | 'busy' | 'error' | 'retry'> }) {
  return <><ErrorBox error={mutation.error} />{mutation.pending && <div className="phase-notice"><div><strong>Chưa xác định kết quả: {mutation.pending.label}</strong><span>Không tạo giao dịch mới. Gửi lại đúng yêu cầu đã lưu để kiểm tra, không thu/ghi thêm lần nữa.</span><button className="button secondary" disabled={mutation.busy} onClick={mutation.retry}>{mutation.busy ? 'Đang kiểm tra…' : 'Kiểm tra & gửi lại an toàn'}</button></div></div>}</>;
}
export function BillingSummary({ value: v }: { value: BillingTotals }) {
  return <dl className="billing-totals"><div><dt>Tiền phòng</dt><dd>{money(v.roomTotal)}</dd></div><div><dt>Tiền dịch vụ</dt><dd>{money(v.serviceTotal)}</dd></div><div><dt>Tổng trước giảm</dt><dd>{money(v.subtotal)}</dd></div><div><dt>Giảm giá</dt><dd>−{money(v.discount)}</dd></div><div className="total"><dt>Tổng hóa đơn</dt><dd>{money(v.total)}</dd></div><div><dt>Cọc khấu trừ</dt><dd>−{money(v.deposit)}</dd></div><div className={v.toRefund ? 'refund total' : 'total'}><dt>{v.toRefund ? 'Cần hoàn cho khách' : 'Cần thu khi trả phòng'}</dt><dd>{money(v.toRefund || v.toCollect)}</dd></div></dl>;
}
export function PaymentFields({ method, setMethod, reference, setReference }: { method: PaymentMethod; setMethod: (v: PaymentMethod) => void; reference: string; setReference: (v: string) => void }) {
  return <><label>Phương thức<select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}>{Object.entries(paymentMethods).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>Mã tham chiếu (nếu có)<input maxLength={100} value={reference} onChange={e => setReference(e.target.value)} /></label><p className="helper-text">Chỉ ghi nhận giao dịch đã xác minh tại quầy. Web không tự chuyển tiền; không nhập thông tin thẻ.</p></>;
}
export function PaymentsTable({ payments }: { payments: BookingView['payments'] }) {
  const names: Record<string, string> = { deposit: 'Thu cọc', checkout: 'Thu khi trả phòng', refund: 'Hoàn tiền', adjustment: 'Điều chỉnh hóa đơn' };
  return <div className="table-scroll"><table><thead><tr><th>Thời gian / Người ghi</th><th>Giao dịch</th><th>Số tiền</th><th>Phương thức / Tham chiếu</th></tr></thead><tbody>{payments.map(p => <tr key={p.id}><td>{localTime(p.at)}<small className="block">{p.by}</small></td><td>{names[p.kind] || p.kind}<small className="block">{p.reason}</small></td><td className={p.direction === 'out' ? 'refund' : ''}>{p.direction === 'out' ? '−' : '+'}{money(p.amount)}</td><td>{paymentMethods[p.method]}<small className="block">{p.reference}</small></td></tr>)}</tbody></table></div>;
}
