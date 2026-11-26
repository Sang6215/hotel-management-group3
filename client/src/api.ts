let csrf = '';
export class ApiError extends Error { constructor(message: string, public status: number, public fields: { field: string; message: string }[] = []) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method || 'GET';
  if (method !== 'GET' && !csrf) {
    const result = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
    if (!result.ok) throw new ApiError('Không thể mở phiên làm việc. Vui lòng thử lại.', result.status);
    csrf = (await result.json()).csrfToken;
  }
  const response = await fetch(`/api/v1${path}`, {
    ...options, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(method === 'GET' ? {} : { 'X-CSRF-Token': csrf }), ...options.headers },
  });
  const data = await response.json().catch(() => ({ message: 'Máy chủ chưa phản hồi. Vui lòng thử lại.' }));
  if (response.status === 401) { csrf = ''; if (path !== '/auth/login') window.dispatchEvent(new Event('session-ended')); }
  if (!response.ok) throw new ApiError(data.fields?.[0]?.message || data.message || 'Thao tác chưa thành công.', response.status, data.fields || []);
  if (data.csrfToken) csrf = data.csrfToken;
  if (path === '/auth/logout') csrf = '';
  return data as T;
}

export async function downloadApiFile(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  if (response.status === 401) { csrf = ''; window.dispatchEvent(new Event('session-ended')); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: 'Không thể tải tệp từ máy chủ.' }));
    throw new ApiError(data.message || 'Không thể tải tệp.', response.status);
  }
  const blob = await response.blob();
  const header = response.headers.get('content-disposition') || '';
  const match = /filename="([^"]+)"/i.exec(header);
  const filename = match?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
