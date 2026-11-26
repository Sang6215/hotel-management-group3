import { useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertTriangle, Check, Database, Download, FileJson, RefreshCw, ShieldAlert, Upload } from 'lucide-react';
import { api, downloadApiFile } from './api';
import { ErrorBox, errorMessage, LoadState, useRemote } from './workspace-ui';
import { localTime } from './billing-ui';
import type { DataCollectionName, DataImportResult, DataSummary, UserView } from '../../shared/types';

const COLLECTION_LABELS: Record<DataCollectionName, string> = {
  room_types: 'Loại phòng (room_types)',
  rooms: 'Phòng vật lý (rooms)',
  customers: 'Khách hàng (customers)',
  services: 'Dịch vụ (services)',
  promotions: 'Khuyến mãi (promotions)',
  bookings: 'Phiếu đặt phòng (bookings)',
  invoices: 'Hóa đơn (invoices)',
  users: 'Tài khoản nội bộ (users · ẩn mật khẩu)',
};

const IMPORTABLE: { value: 'room_types' | 'rooms' | 'services' | 'customers' | 'promotions'; label: string; sample: string }[] = [
  {
    value: 'services',
    label: 'Dịch vụ (services)',
    sample: JSON.stringify([{ code: 'MINIBAR', name: 'Đồ uống minibar', category: 'Ăn uống', unit: 'Lượt', price: 80000, status: 'active' }], null, 2),
  },
  {
    value: 'room_types',
    label: 'Loại phòng (room_types)',
    sample: JSON.stringify([{ code: 'VIP_GARDEN', name: 'VIP Sân vườn', price: 1600000, capacity: 4, amenities: ['Wi-Fi', 'Bồn tắm'], description: 'Phòng rộng hướng vườn', status: 'active' }], null, 2),
  },
  {
    value: 'rooms',
    label: 'Phòng vật lý (rooms)',
    sample: JSON.stringify([{ number: '401', floor: 4, typeCode: 'STANDARD', status: 'available', active: true }], null, 2),
  },
  {
    value: 'customers',
    label: 'Khách hàng (customers)',
    sample: JSON.stringify([{ fullName: 'Nguyễn Văn A', phone: '0912345001', idCard: '079099000111', email: '', nationality: 'Việt Nam', status: 'active' }], null, 2),
  },
  {
    value: 'promotions',
    label: 'Khuyến mãi (promotions)',
    sample: JSON.stringify([{ code: 'WEEKEND10', type: 'percentage', value: 10, maxDiscount: 300000, minAmount: 500000, startsOn: '2026-11-01', endsOn: '2026-12-31', status: 'active' }], null, 2),
  },
];

type BackupPreview = {
  format?: string;
  version?: number;
  exportedAt?: string;
  exportedBy?: string;
  counts?: Record<string, number>;
  checksum?: string;
  collections?: Record<string, unknown[]>;
};

export function DataToolsPage({ user }: { user: UserView }) {
  if (user.role !== 'admin') {
    return (
      <section className="section denied">
        <ShieldAlert size={32} aria-hidden="true" />
        <h1>Bạn không có quyền truy cập</h1>
        <p>Chức năng sao lưu, khôi phục và xuất/nhập dữ liệu chỉ dành cho quản trị viên.</p>
        <a className="button primary" href="#overview">Về tổng quan</a>
      </section>
    );
  }

  const summary = useRemote<DataSummary>('/data/summary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [exportCollection, setExportCollection] = useState<DataCollectionName>('bookings');
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');

  const [importTarget, setImportTarget] = useState<(typeof IMPORTABLE)[number]['value']>('services');
  const [importJson, setImportJson] = useState(IMPORTABLE[0].sample);
  const [importResult, setImportResult] = useState<DataImportResult | null>(null);

  const [backupFile, setBackupFile] = useState<BackupPreview | null>(null);
  const [backupFileName, setBackupFileName] = useState('');
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoreAck, setRestoreAck] = useState(false);

  async function handleBackupDownload() {
    setBusy(true); setError(''); setSuccess('');
    try {
      await downloadApiFile('/data/backup', 'hotel-desk-backup.json');
      setSuccess('Đã tạo và tải xuống bản sao lưu snapshot kèm mã kiểm tra SHA-256.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function handleExportDownload() {
    setBusy(true); setError(''); setSuccess('');
    try {
      await downloadApiFile(`/data/export?collection=${exportCollection}&format=${exportFormat}`, `hotel-${exportCollection}.${exportFormat}`);
      setSuccess(`Đã xuất dữ liệu ${exportCollection} định dạng ${exportFormat.toUpperCase()}.`);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setSuccess(''); setImportResult(null);
    try {
      const parsed = JSON.parse(importJson);
      if (!Array.isArray(parsed)) throw new Error('Dữ liệu nhập phải là một mảng JSON ([ ... ]).');
      const result = await api<DataImportResult>('/data/import', {
        method: 'POST',
        body: JSON.stringify({ collection: importTarget, items: parsed }),
      });
      setImportResult(result);
      setSuccess(`Nhập dữ liệu xong: thêm ${result.inserted}, bỏ qua trùng ${result.skipped}, lỗi ${result.errors.length}.`);
      summary.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(false); }
  }

  async function handleSelectBackupFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(''); setSuccess(''); setBackupFile(null); setBackupFileName(''); setRestoreConfirmText(''); setRestoreAck(false);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupPreview;
      if (parsed.format !== 'hotel-desk-backup-v1' || !parsed.collections || !parsed.checksum) {
        throw new Error('Tệp không đúng định dạng sao lưu hotel-desk-backup-v1.');
      }
      setBackupFile(parsed);
      setBackupFileName(file.name);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleRestore(e: FormEvent) {
    e.preventDefault();
    if (!backupFile) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const res = await api<{ message: string; counts: Record<string, number> }>('/data/restore', {
        method: 'POST',
        body: JSON.stringify({ backup: backupFile, confirm: restoreConfirmText.trim() }),
      });
      setSuccess(res.message);
      setBackupFile(null);
      setBackupFileName('');
      setRestoreConfirmText('');
      setRestoreAck(false);
      summary.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">QUẢN TRỊ DỮ LIỆU</div>
          <h1>Sao lưu, khôi phục & xuất/nhập MongoDB</h1>
          <p>Xuất dữ liệu JSON/CSV, nhập bổ sung danh mục an toàn và sao lưu/khôi phục nguyên tử 7 collection nghiệp vụ trong transaction.</p>
        </div>
        <button type="button" className="button secondary" disabled={busy || summary.busy} onClick={summary.reload}>
          <RefreshCw size={16} aria-hidden="true" className={summary.busy ? 'spin' : ''} /> Cập nhật số liệu
        </button>
      </div>

      <ErrorBox error={error || summary.error} retry={summary.reload} />
      {success && <div className="success" role="status"><Check size={17} aria-hidden="true" /><span>{success}</span></div>}

      <section className="section">
        <div className="section-title">
          <div>
            <h2>Hiện trạng các collection trong MongoDB</h2>
            <p>{summary.data ? `Cập nhật lúc ${localTime(summary.data.asOf)}` : 'Đang kiểm tra số lượng bản ghi'}</p>
          </div>
          <button type="button" className="button primary" disabled={busy} onClick={handleBackupDownload}>
            <Download size={17} aria-hidden="true" /> Tải bản sao lưu toàn bộ (.json)
          </button>
        </div>
        <LoadState busy={summary.busy} />
        {summary.data && (
          <div className="collection-grid">
            {(Object.keys(COLLECTION_LABELS) as DataCollectionName[]).map(key => (
              <article key={key} className="collection-card">
                <div className="collection-head">
                  <Database size={16} aria-hidden="true" />
                  <span>{key}</span>
                </div>
                <strong className="num">{summary.data!.counts[key] ?? 0}</strong>
                <small>{COLLECTION_LABELS[key]}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="data-tools-grid">
        <section className="section">
          <div className="section-title">
            <div>
              <h2>Xuất dữ liệu từng collection</h2>
              <p>Định dạng JSON giữ nguyên kiểu Extended JSON (ObjectId, Date) để nhập vào MongoDB Compass; CSV mở trực tiếp trên Excel.</p>
            </div>
          </div>
          <div className="form-fields">
            <label>
              Chọn collection
              <select value={exportCollection} onChange={e => setExportCollection(e.target.value as DataCollectionName)} disabled={busy}>
                {(Object.keys(COLLECTION_LABELS) as DataCollectionName[]).map(k => (
                  <option key={k} value={k}>{COLLECTION_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label>
              Định dạng tệp
              <select value={exportFormat} onChange={e => setExportFormat(e.target.value as 'json' | 'csv')} disabled={busy}>
                <option value="json">Extended JSON (.json) — chuẩn MongoDB</option>
                <option value="csv">CSV UTF-8 BOM (.csv) — mở bằng Excel</option>
              </select>
            </label>
            <button type="button" className="button primary" disabled={busy} onClick={handleExportDownload}>
              <FileJson size={17} aria-hidden="true" /> Xuất {exportCollection}.{exportFormat}
            </button>
          </div>
        </section>

        <section className="section">
          <div className="section-title">
            <div>
              <h2>Khôi phục dữ liệu từ bản sao lưu</h2>
              <p>Kiểm tra checksum SHA-256 và schema từng bản ghi trước khi thay thế 7 collection nghiệp vụ trong transaction. Tài khoản đăng nhập được giữ nguyên.</p>
            </div>
          </div>
          <form onSubmit={handleRestore} className="form-fields">
            <label>
              Chọn tệp sao lưu (.json)
              <input type="file" accept="application/json,.json" onChange={handleSelectBackupFile} disabled={busy} />
            </label>
            {backupFile && (
              <div className="backup-preview" role="status">
                <strong><Check size={16} aria-hidden="true" /> {backupFileName}</strong>
                <p>Tạo lúc: {backupFile.exportedAt ? localTime(backupFile.exportedAt) : '—'} · Bởi: {backupFile.exportedBy || '—'}</p>
                <p className="num">
                  {Object.entries(backupFile.counts || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                </p>
              </div>
            )}
            <div className="danger-callout">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>Khôi phục sẽ thay thế toàn bộ dữ liệu phòng, loại phòng, khách hàng, dịch vụ, khuyến mãi, đặt phòng và hóa đơn hiện tại bằng nội dung tệp sao lưu.</span>
            </div>
            <label>
              <span>Nhập chữ <strong>RESTORE</strong> để xác nhận</span>
              <input value={restoreConfirmText} onChange={e => setRestoreConfirmText(e.target.value)} placeholder="RESTORE" disabled={busy || !backupFile} />
            </label>
            <label className="acknowledgement">
              <input type="checkbox" checked={restoreAck} onChange={e => setRestoreAck(e.target.checked)} disabled={busy || !backupFile} />
              <span>Tôi đã sao lưu bản hiện tại và hiểu thao tác này sẽ ghi đè 7 collection nghiệp vụ.</span>
            </label>
            <button type="submit" className="button danger" disabled={busy || !backupFile || !restoreAck || restoreConfirmText.trim() !== 'RESTORE'}>
              <Upload size={17} aria-hidden="true" /> {busy ? 'Đang khôi phục…' : 'Khôi phục dữ liệu'}
            </button>
          </form>
        </section>
      </div>

      <section className="section">
        <div className="section-title">
          <div>
            <h2>Nhập bổ sung danh mục (JSON)</h2>
            <p>Nhập nhanh mảng đối tượng JSON vào danh mục; các mã/SĐT/CCCD đã tồn tại sẽ được bỏ qua an toàn, không ghi đè dữ liệu cũ.</p>
          </div>
        </div>
        <form onSubmit={handleImport} className="form-fields">
          <div className="import-header-row">
            <label>
              Collection đích
              <select
                value={importTarget}
                disabled={busy}
                onChange={e => {
                  const next = e.target.value as (typeof IMPORTABLE)[number]['value'];
                  setImportTarget(next);
                  const found = IMPORTABLE.find(item => item.value === next);
                  if (found) setImportJson(found.sample);
                  setImportResult(null);
                }}
              >
                {IMPORTABLE.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                const found = IMPORTABLE.find(item => item.value === importTarget);
                if (found) setImportJson(found.sample);
              }}
            >
              Chèn JSON mẫu
            </button>
          </div>
          <label>
            Mảng JSON cần nhập (tối đa 500 bản ghi)
            <textarea rows={6} value={importJson} onChange={e => setImportJson(e.target.value)} disabled={busy} spellCheck={false} className="code-textarea" />
          </label>
          <div>
            <button type="submit" className="button primary" disabled={busy}>
              <Upload size={17} aria-hidden="true" /> {busy ? 'Đang nhập…' : 'Kiểm tra & nhập dữ liệu'}
            </button>
          </div>
        </form>
        {importResult && (
          <div className="import-result">
            <p>Kết quả nhập <strong>{importResult.collection}</strong>: Tổng <span className="num">{importResult.total}</span> · Thêm mới <strong className="num">{importResult.inserted}</strong> · Bỏ qua trùng <strong className="num">{importResult.skipped}</strong> · Lỗi <strong className="num">{importResult.errors.length}</strong></p>
            {importResult.errors.length > 0 && (
              <ul>{importResult.errors.map(err => <li key={err.index}>Dòng #{err.index + 1}: {err.message}</li>)}</ul>
            )}
          </div>
        )}
      </section>
    </>
  );
}
