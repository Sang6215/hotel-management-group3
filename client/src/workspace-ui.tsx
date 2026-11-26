import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react';
import { api, ApiError } from './api';
import type { Page } from '../../shared/types';

export const money = (v: number) => new Intl.NumberFormat('vi-VN').format(v) + ' ₫';
export const errorMessage = (e: unknown) => e instanceof Error ? e.message : 'Không thể kết nối. Vui lòng thử lại.';
export const calendarLabel = (s: string) => s.split('-').reverse().join('/');
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return error ? <div className="alert" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{error}</span>{retry && <button type="button" className="text-button" onClick={retry}>Thử lại</button>}</div> : null;
}
export function useRemote<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined); setError('');
    if (!path) { setBusy(false); return; }
    setBusy(true);
    api<T>(path, { signal: controller.signal }).then(d => { if (!controller.signal.aborted) setData(d); }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [path, tick]);
  return { data, busy, error, reload: () => setTick(t => t + 1) };
}
export function LoadState({ busy, empty }: { busy: boolean; empty?: boolean }) {
  if (busy) return <div className="empty" role="status" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /><span>Đang tải dữ liệu…</span></div>;
  if (empty) return <div className="empty">Chưa có kết quả phù hợp.</div>;
  return null;
}
export function Pager({ data, page, setPage }: { data?: Pick<Page<unknown>, 'total' | 'limit'>; page: number; setPage: (p: number) => void }) {
  if (!data) return null;
  return <div className="pagination"><span><strong className="num">{data.total}</strong> kết quả · Trang <span className="num">{page} / {Math.max(1, Math.ceil(data.total / data.limit))}</span></span><div><button type="button" className="icon-button" aria-label="Trang trước" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" className="icon-button" aria-label="Trang sau" disabled={page * data.limit >= data.total} onClick={() => setPage(page + 1)}><ChevronRight size={18} aria-hidden="true" /></button></div></div>;
}
export function Modal({ title, busy, close, children, wide = false }: { title: string; busy?: boolean; close: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={wide ? 'wide-dialog' : ''} aria-label={title} onCancel={e => { e.preventDefault(); if (!busy) close(); }}><div className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Đóng" disabled={busy} onClick={close}><X size={19} aria-hidden="true" /></button></div>{children}</dialog>;
}
export type Field = { key: string; label: string; type?: 'number' | 'email' | 'textarea' | 'date'; required?: boolean; min?: number; max?: number; maxLength?: number; options?: { value: string; label: string; disabled?: boolean }[]; hint?: string };
export function RecordForm({ title, initial, fields, save, close }: { title: string; initial: Record<string, string | number>; fields: Field[]; save: (values: Record<string, string | number>) => Promise<void>; close: () => void }) {
  const [values, setValues] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const summaryRef = useRef<HTMLDivElement>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setErrors({});
    try { await save(values); close(); } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setErrors(Object.fromEntries(e.fields.map(f => [f.field, f.message])));
      queueMicrotask(() => summaryRef.current?.focus());
    } finally { setBusy(false); }
  }
  const fieldErrorEntries = Object.entries(errors);
  return <Modal title={title} close={close} busy={busy}><form onSubmit={submit}>
    {(error || fieldErrorEntries.length > 0) && <div ref={summaryRef} tabIndex={-1} role="alert" className="error-summary">
      <strong><AlertCircle size={16} aria-hidden="true" /> {error || 'Vui lòng kiểm tra lại các trường bên dưới.'}</strong>
      {fieldErrorEntries.length > 0 && <ul>{fieldErrorEntries.map(([key, msg]) => {
        const label = fields.find(f => f.key === key)?.label || key;
        return <li key={key}><a href={`#field-${key}`} onClick={ev => { ev.preventDefault(); document.getElementById(`field-${key}`)?.focus(); }}>{label}: {msg}</a></li>;
      })}</ul>}
    </div>}
    <fieldset disabled={busy} className="form-fields">{fields.map((f, index) => {
      const props = { id: 'field-' + f.key, name: f.key, value: values[f.key] ?? '', autoFocus: index === 0, required: f.required, 'aria-invalid': !!errors[f.key], 'aria-describedby': errors[f.key] ? 'error-' + f.key : undefined, onChange: (e: { target: { value: string } }) => setValues({ ...values, [f.key]: f.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value }) };
      return <label key={f.key} htmlFor={props.id}>{f.label}{f.options ? <select {...props}>{f.options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</select> : f.type === 'textarea' ? <textarea {...props} rows={3} maxLength={f.maxLength || 1000} /> : <input {...props} type={f.type || 'text'} step={f.type === 'number' ? 1 : undefined} min={f.min} max={f.max} maxLength={f.maxLength || 100} />}{f.hint && <small>{f.hint}</small>}{errors[f.key] && <span className="field-error" id={'error-' + f.key}>{errors[f.key]}</span>}</label>;
    })}</fieldset><div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>Hủy</button><button className="button primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thông tin'}</button></div></form></Modal>;
}
