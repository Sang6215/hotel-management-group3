import type { RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function validId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) throw new HttpError(400, 'Mã dữ liệu không hợp lệ.');
  return id;
}
export const adminOnly: RequestHandler = (_req, res, next) => {
  if (res.locals.user.role !== 'admin') throw new HttpError(403, 'Thao tác này chỉ dành cho quản trị viên.');
  next();
};
export function checkVersion(doc: { version: number }, version: number) {
  if (doc.version !== version) throw new HttpError(409, 'Dữ liệu vừa thay đổi. Vui lòng đóng biểu mẫu và tải lại trước khi sửa.');
}
