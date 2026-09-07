import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import { calendarLabel, ErrorBox, errorMessage, LoadState, Modal, money, useRemote } from './workspace-ui';
import { BillingSummary, localTime, MutationNotice, PaymentFields, useSafeMutation } from './billing-ui';
import type { BookingView, CheckoutQuote, Page, PaymentMethod, ServiceUsageView, ServiceView, UserView } from '../../shared/types';

export function BookingBilling({ booking: b, user, reload }: { booking: BookingView; user: UserView; reload: () => void }) {
  const [editing, setEditing] = useState<'new' | 'checkout' | ServiceUsageView | null>(null);
  const mutation = useSafeMutation<{ item: BookingView }>(`hotel-billing:${user.id}:${b.id}`, `/bookings/${b.id}/`, (result, req) => {
    setEditing(null); reload();
    if (req.path.endsWith('/checkout') && result.item.invoiceId) window.location.hash = `invoices/${result.item.invoiceId}`;
  });
  const blocked = mutation.busy || !!mutation.pending;
  useEffect(() => { if (mutation.pending && !mutation.busy) setEditing(null); }, [mutation.pending, mutation.busy]);
  return <section className="section booking-billing"><div className="section-title"><div><h2>Dịch vụ phát sinh & thanh toán</h2><p>Đơn giá lưu tại lúc ghi dịch vụ; hủy/sửa có lịch sử.</p></div>{b.status === 'checked_in' && <div className="action-row"><button className="button secondary" disabled={blocked} onClick={() => { mutation.setError(''); setEditing('new'); }}>Thêm dịch vụ</button><button className="button primary" disabled={blocked} onClick={() => { mutation.setError(''); setEditing('checkout'); }}>Trả phòng & thanh toán</button></div>}{b.invoiceId && <a className="button primary" href={`#invoices/${b.invoiceId}`}>Xem & in hóa đơn</a>}</div>
    <MutationNotice mutation={mutation} />
    {b.services.length ? <div className="table-scroll"><table><thead><tr><th>Phòng / Dịch vụ</th><th>Thời gian / Người ghi</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th><th>Thao tác</th></tr></thead><tbody>{b.services.map(s => <tr key={s.id} className={s.voided ? 'voided-line' : ''}><td><strong>Phòng {s.roomNumber || b.rooms.find(r => r.roomId === s.roomId)?.number}</strong><small className="block">{s.name}</small>{s.voided && <span className="booking-badge cancelled">Đã hủy · Không tính tiền</span>}</td><td>{localTime(s.usedAt)}<small className="block">{s.by}</small></td><td>{s.quantity} {s.unit}</td><td>{money(s.price)}</td><td>{money(s.amount)}{s.reason && <small className="block">Lý do sửa/hủy: {s.reason}</small>}</td><td>{b.status === 'checked_in' && !s.voided ? <button className="text-button" disabled={blocked} onClick={() => { mutation.setError(''); setEditing(s); }}>Sửa / hủy dòng</button> : '—'}</td></tr>)}</tbody></table></div> : <p className="muted">Chưa ghi nhận dịch vụ sử dụng.</p>}
    <div className="billing-service-total">Tổng dịch vụ đang tính: <strong>{money(b.serviceTotal)}</strong></div>
    {b.status === 'completed' && <p className="helper-text">Phiếu đã hoàn tất. Muốn điều chỉnh, quản trị viên mở hóa đơn; không sửa các dòng giao dịch gốc.</p>}
    {editing && editing !== 'checkout' && <ServiceForm key={typeof editing === 'string' ? editing : editing.id} booking={b} initial={editing === 'new' ? undefined : editing} busy={blocked} error={mutation.error} close={() => setEditing(null)} save={data => mutation.send(`/bookings/${b.id}/services${typeof editing === 'object' ? '/' + editing.id : ''}`, typeof editing === 'object' ? 'PATCH' : 'POST', { version: b.version, ...data }, typeof editing === 'object' ? 'Sửa/hủy dịch vụ' : 'Thêm dịch vụ')} />}
    {editing === 'checkout' && <CheckoutForm booking={b} user={user} busy={blocked} error={mutation.error} close={() => setEditing(null)} save={data => mutation.send(`/bookings/${b.id}/checkout`, 'POST', data, 'Trả phòng & thanh toán')} />}
  </section>;
}

function ServiceForm({ booking: b, initial, busy, error, close, save }: { booking: BookingView; initial?: ServiceUsageView; busy: boolean; error: string; close: () => void; save: (data: object) => Promise<void> }) {
  const [q, setQ] = useState(''), [serviceId, setServiceId] = useState(''), [roomId, setRoomId] = useState(b.rooms[0].roomId), [quantity, setQuantity] = useState(initial?.quantity || 1), [voided, setVoided] = useState(false), [reason, setReason] = useState('');
  const services = useRemote<Page<ServiceView>>(initial ? null : `/services?status=active&q=${encodeURIComponent(q)}&limit=200`);
  const selected = services.data?.items.find(s => s.id === serviceId);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (initial) await save({ quantity, voided, reason });
    else if (selected) await save({ roomId, serviceId, serviceVersion: selected.version, quantity });
  }
  return <Modal title={initial ? 'Sửa hoặc hủy dịch vụ' : 'Ghi nhận dịch vụ phát sinh'} busy={busy} close={close}><form onSubmit={submit}><fieldset className="form-fields" disabled={busy}>
    {initial ? <><p>Phòng {initial.roomNumber} · <strong>{initial.name}</strong><br />Đơn giá đã chốt: {money(initial.price)}/{initial.unit}</p><label>Thao tác<select value={voided ? 'void' : 'quantity'} onChange={e => setVoided(e.target.value === 'void')}><option value="quantity">Sửa số lượng, giữ đơn giá</option><option value="void">Hủy dòng, giữ lịch sử</option></select></label></> : <><label>Phòng sử dụng<select value={roomId} onChange={e => setRoomId(e.target.value)}>{b.rooms.map(r => <option key={r.roomId} value={r.roomId}>Phòng {r.number}</option>)}</select></label><label>Tìm dịch vụ<input value={q} placeholder="Tên hoặc mã dịch vụ…" onChange={e => { setQ(e.target.value); setServiceId(''); }} /></label><LoadState busy={services.busy} empty={services.data?.total === 0} /><ErrorBox error={services.error} retry={services.reload} /><label>Dịch vụ<select required value={serviceId} onChange={e => setServiceId(e.target.value)}><option value="">Chọn dịch vụ</option>{services.data?.items.map(s => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}/{s.unit}</option>)}</select></label>{(services.data?.total || 0) > 200 && <small>Tìm cụ thể hơn để thu hẹp 200 kết quả đầu.</small>}</>}
    {!voided && <label>Số lượng<input required type="number" min={1} max={1000} step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>}
    <p>Thành tiền tính vào phiếu: <strong>{money(voided ? 0 : quantity * (initial?.price ?? selected?.price ?? 0))}</strong></p>
    {initial && <label>Lý do sửa/hủy<textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>}
  </fieldset><ErrorBox error={error} /><div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Đóng</button><button className="button primary" disabled={busy || (!initial && (!selected || services.busy))}>{busy ? 'Đang xử lý…' : voided ? 'Xác nhận hủy dòng' : 'Lưu dịch vụ'}</button></div></form></Modal>;
}

function CheckoutForm({ booking: b, user, busy, error, close, save }: { booking: BookingView; user: UserView; busy: boolean; error: string; close: () => void; save: (data: object) => Promise<void> }) {
  const [code, setCode] = useState(''), [quote, setQuote] = useState<CheckoutQuote>(), [loading, setLoading] = useState(false), [quoteError, setQuoteError] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash'), [reference, setReference] = useState(''), [verified, setVerified] = useState(false);
  const sequence = useRef(0);
  async function preview(promotionCode = code) {
    const ticket = ++sequence.current; setLoading(true); setQuote(undefined); setQuoteError(''); setVerified(false);
    try {
      const r = await api<{ quote: CheckoutQuote }>(`/bookings/${b.id}/checkout-preview`, { method: 'POST', body: JSON.stringify({ promotionCode: promotionCode.trim().toUpperCase() }) });
      if (ticket === sequence.current) setQuote(r.quote);
    } catch (e) { if (ticket === sequence.current) setQuoteError(errorMessage(e)); }
    finally { if (ticket === sequence.current) setLoading(false); }
  }
  useEffect(() => { void preview(); return () => { sequence.current++; }; }, [b.version]);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!quote) return;
    await save({ version: quote.version, promotionCode: quote.promotionCode, quoteToken: quote.token, amount: quote.toRefund || quote.toCollect, method, reference, verified });
  }
  const needsAdmin = !!quote?.toRefund && user.role !== 'admin';
  return <Modal title="Trả phòng & thanh toán" busy={busy} close={close} wide><form onSubmit={submit}>
    <p className="helper-text">Trả toàn bộ phòng cùng lúc. Tính từ ngày nhận thực tế đến hôm nay, tối thiểu 1 đêm, chưa có phụ thu theo giờ. Hoàn tất sẽ chuyển phòng sang Đang dọn.</p>
    <fieldset className="form-fields" disabled={busy}><div className="promotion-entry"><label>Mã khuyến mãi (không bắt buộc)<input maxLength={30} value={code} placeholder="Nhập mã hoặc để trống" onChange={e => { setCode(e.target.value); sequence.current++; setQuote(undefined); setLoading(false); setVerified(false); }} /></label><button type="button" className="button secondary" disabled={loading} onClick={() => preview()}>Xem lại phí</button></div></fieldset>
    <LoadState busy={loading} /><ErrorBox error={quoteError} retry={() => preview()} />
    {quote && <><p><strong>{calendarLabel(quote.checkIn)} → {calendarLabel(quote.checkOut)}</strong> · {quote.nights} đêm · {quote.rooms.length} phòng</p><div className="checkout-layout"><div><h3>Chi phí đã chốt</h3><div className="table-scroll"><table><thead><tr><th>Khoản phí</th><th>Chi tiết</th><th>Thành tiền</th></tr></thead><tbody>{quote.rooms.map(r => <tr key={r.roomId}><td>Phòng {r.number}</td><td>{quote.nights} × {money(r.price)}</td><td>{money(quote.nights * r.price)}</td></tr>)}{quote.services.map(s => <tr key={s.id}><td>{s.name}<small className="block">Phòng {s.roomNumber}</small></td><td>{s.quantity} × {money(s.price)}</td><td>{money(s.amount)}</td></tr>)}</tbody></table></div></div><BillingSummary value={quote} /></div>
      {needsAdmin ? <p className="refund-notice">Cần hoàn {money(quote.toRefund)} cho khách. Hãy nhờ quản trị viên đăng nhập, kiểm tra giao dịch và hoàn tất phiếu.</p> : <fieldset className="form-fields" disabled={busy}><PaymentFields method={method} setMethod={setMethod} reference={reference} setReference={setReference} /><label className="acknowledgement"><input type="checkbox" required checked={verified} onChange={e => setVerified(e.target.checked)} /><span>{quote.toRefund ? `Đã xác minh hoàn ${money(quote.toRefund)} cho khách.` : quote.toCollect ? `Đã xác minh nhận đủ ${money(quote.toCollect)} còn lại.` : 'Đã đối chiếu đủ tiền cọc, không cần thu thêm hoặc hoàn tiền.'}</span></label></fieldset>}
    </>}
    <ErrorBox error={error} /><div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Đóng</button><button className="button primary" disabled={busy || loading || !quote || needsAdmin || !verified}>{busy ? 'Đang xử lý…' : 'Hoàn tất trả phòng & lập hóa đơn'}</button></div>
  </form></Modal>;
}
