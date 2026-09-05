# Biên bản kiểm tra Phase 1

Ngày kiểm tra: 05/09/2026. Môi trường: Windows trên máy hiện tại, Node.js 24.19.0, MongoDB 8.0.15 replica set. Phiên bản thư viện chính xác được khóa trong pnpm-lock.yaml.

## Kiểm tra đã thực hiện

| Nhóm | Kết quả thực tế |
|---|---|
| Biên dịch TypeScript và build giao diện/API | Thành công |
| Kiểm thử tích hợp | 15/15 tình huống đạt, replica set tạm riêng |
| Transaction trên database phát triển | Commit PASS, rollback PASS |
| Giao diện đăng nhập | Mở được, điền tài khoản quản trị mẫu và đăng nhập thành công |
| Tổng quan | Hiện dữ liệu từ MongoDB: 12 phòng, 3 loại, 0 khách, 0 booking |
| Tài khoản | Hiện 2 tài khoản mẫu, mở/đóng hộp thoại tạo bằng Escape |
| Vai trò trên giao diện | Đăng nhập lễ tân, không có mục quản trị; vào trực tiếp #users bị từ chối |
| Tìm phòng | Nhập 201 cho đúng một kết quả phòng Deluxe |
| Giao diện màn hình nhỏ | Kiểm tra 390 × 844; menu thu gọn, form và thẻ phòng đọc được, không tràn ngang trang |
| Cài theo lockfile | pnpm install --frozen-lockfile hoàn tất |
| Tệp khởi động Windows | PowerShell phân tích cú pháp không báo lỗi |

## 15 tình huống tự động

1. Đủ tám collection nghiệp vụ, có 12 phòng lưu thật.
2. Người chưa đăng nhập không đọc được dữ liệu được bảo vệ.
3. Thiếu/sai CSRF hoặc Origin ngoài cấu hình bị từ chối.
4. Sai mật khẩu bị từ chối, phản hồi không lộ thông tin hash.
5. Login đổi session ID/CSRF, cookie HttpOnly và SameSite Strict.
6. Staff bị chặn tại API quản trị dù gọi trực tiếp.
7. Tạo tài khoản đúng, từ chối trường sai/tên trùng, không lộ mật khẩu.
8. Khóa staff hủy hiệu lực phiên cũ; mở khóa không phục hồi phiên cũ.
9. Không cho khóa admin và từ chối ID sai.
10. Đổi mật khẩu làm hết hiệu lực các phiên khác, phiên hiện tại được tạo lại.
11. Logout xóa phiên, gọi lại dữ liệu bị từ chối.
12. Tổng quan đọc số liệu đúng, phân trang có giới hạn.
13. Seed chạy lại không nhân đôi hoặc ghi đè dữ liệu đã sửa.
14. Transaction có thể hoàn tác toàn bộ và commit thành công.
15. Schema booking từ chối ngày đảo ngược và lặp cùng phòng.

## Giới hạn của kết quả

Kiểm thử API tạo/khóa tài khoản và đổi mật khẩu chạy trên database tạm, không sửa tài khoản mẫu đang dùng để trình diễn. Kiểm tra UI không thay cho kiểm thử toàn bộ khả năng tiếp cận hoặc mọi kích thước màn hình. Chưa kiểm tra cài trên máy của hai thành viên còn lại hoặc khởi động lại hệ điều hành.

Chưa triển khai nên chưa kiểm tra đặt trùng đồng thời, tính tiền lưu trú, thanh toán, hóa đơn và báo cáo nghiệp vụ. Schema và thử transaction mới chỉ chứng minh nền tảng cho các chức năng đó. Chưa có kết quả tải nhiều người dùng hoặc kiểm tra production.

## Chạy lại

`pnpm test` cho 15 kiểm thử tích hợp; `pnpm build` kiểm tra biên dịch; `pnpm db:check` khi server local đang chạy để kiểm tra replica set hiện tại. Không dùng dữ liệu khách thật cho bộ kiểm thử hoặc seed.
