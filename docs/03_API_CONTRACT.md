# Hợp đồng API Phase 1–2

Tiền tố /api/v1. Cùng origin với giao diện. Dữ liệu JSON. Cookie phiên tên hotel.sid, HttpOnly, SameSite=Strict, thời hạn tối đa 8 giờ; Secure khi NODE_ENV=production. Không dùng token đăng nhập trong localStorage.

## API đã hoạt động

| Method và đường dẫn | Đầu vào | Kết quả | Quyền |
|---|---|---|---|
| GET /health | Không | status, phase | Công khai; chỉ trạng thái tối thiểu |
| GET /auth/csrf | Không | csrfToken và cookie phiên | Công khai |
| POST /auth/login | username, password | user, csrfToken mới | CSRF hợp lệ, tối đa 20 lần thất bại/15 phút/IP |
| GET /auth/me | Cookie | user, csrfToken | Đã đăng nhập |
| POST /auth/logout | JSON rỗng | message | Đã đăng nhập + CSRF |
| POST /auth/password | currentPassword, newPassword | message, csrfToken mới | Đã đăng nhập + CSRF |
| GET /overview | Không | rooms, available, customers, bookings, roomTypes, phase, demo | Admin hoặc staff |
| GET /rooms | q, page, limit, floor, typeId, status, active=true/false/all | items, total, page, limit; mặc định 20, tối đa 200 | Admin hoặc staff |
| GET /users | page mặc định 1; limit mặc định 20, tối đa 50 | items, total, page, limit | Admin |
| POST /users | username, fullName, role, password | user, HTTP 201 | Admin + CSRF |
| PATCH /users/:id/status | status active hoặc locked | user | Admin + CSRF, đích chỉ là staff |

User trả về: id, username, fullName, role, status, createdAt. Không trả hash mật khẩu hay phiên bản xác thực. Room trả về: id, number, floor, typeName, capacity, price, status. Giá đơn vị VND. Trong Phase 1, kết quả rooms là danh mục hiện tại, không phải kết quả khả dụng theo ngày.

## Cách dùng phiên

1. Trình duyệt nhận csrfToken từ GET /auth/csrf, giữ cookie do máy chủ đặt.
2. Gửi JSON và X-CSRF-Token khi đăng nhập.
3. Máy chủ tạo lại session ID và token CSRF, trả user và csrfToken mới.
4. Mọi thao tác ghi gửi token mới; cookie tự gửi với cùng origin.
5. Tải lại trang gọi /auth/me để lấy trạng thái và token hiện hành.
6. Logout xóa phiên. Khóa tài khoản hoặc đổi mật khẩu tăng session_version, khiến các phiên cũ bị từ chối tại API.

Nếu yêu cầu có Origin không khớp cấu hình thì từ chối. Phía máy chủ còn kiểm tra token CSRF nên không dựa riêng vào Origin. Dữ liệu API có Cache-Control: no-store. Phiên phát triển không cấu hình SESSION_SECRET sẽ bị đăng xuất khi khởi động lại API vì bí mật phiên được tạo mới; dữ liệu nghiệp vụ vẫn giữ nguyên.

## Ràng buộc

Username 3–40 ký tự chữ thường/số/dấu chấm/gạch ngang/gạch dưới; chuẩn hóa khoảng trắng và chữ thường. Họ tên 2–100 ký tự. Mật khẩu mới ít nhất 12 ký tự, tối đa 72 byte UTF-8 vì giới hạn bcrypt. Role chỉ admin/staff; trường lạ trong body quản trị bị từ chối. Không cho khóa admin để tránh tự mất quyền quản trị ở bản đầu.

## Quy ước lỗi

| HTTP | Trường hợp |
|---|---|
| 400 | Trường nhập hoặc ID không hợp lệ, JSON sai, mật khẩu hiện tại sai |
| 401 | Chưa đăng nhập, sai mật khẩu, tài khoản khóa hoặc phiên hết hiệu lực |
| 403 | Sai CSRF/Origin, staff truy cập quản trị, cố khóa admin |
| 404 | Không có bản ghi hoặc route chưa được xây dựng |
| 409 | Tên trùng hoặc dữ liệu đã bị người khác cập nhật |
| 415 | Thao tác ghi không gửi Content-Type application/json |
| 429 | Quá nhiều lần đăng nhập sai |
| 500 | Lỗi xử lý; không trả stack hay dữ liệu bí mật |

Body lỗi có message; lỗi validation có thêm fields với tên trường và thông báo. Client thông báo lỗi, giữ dữ liệu nhập và cho thử lại. Khi session hết hạn, client đưa về đăng nhập.

## API bổ sung tuần 2 (đã hoạt động)

Tất cả đường dẫn dưới đây có tiền tố /api/v1; thao tác ghi cần JSON + cookie phiên + CSRF. API đọc của các module mở cho cả admin/staff.

| Đường dẫn | Method | Đầu vào chính | Quyền ghi |
|---|---|---|---|
| /room-types | GET, POST | code, name, price, capacity, amenities[], description, status | Admin |
| /room-types/:id | PATCH | Các trường trên + version | Admin |
| /rooms | POST | number, floor, typeId, status, active | Admin |
| /rooms/:id | PATCH | Các trường trên + version | Admin |
| /services | GET, POST | code, name, category, unit, price, status | Admin |
| /services/:id | PATCH | Các trường trên + version | Admin |
| /customers | GET, POST | fullName, phone, idCard, email, nationality, status | Admin/staff |
| /customers/:id | PATCH | Các trường trên + version | Admin/staff |
| /customers/:id/bookings | GET | page, limit | Chỉ đọc |
| /rooms/availability | GET | checkIn, checkOut, guests (sức chứa tối thiểu từng phòng), typeId tùy chọn; q, page, limit | Chỉ đọc |
| /bookings | GET, POST | GET: q, status, page, limit. POST: customerId, checkIn, checkOut, rooms[{roomId, guestCount}], note | Admin/staff |
| /bookings/:id | GET, PATCH | PATCH: trường tạo phiếu + version; chỉ pending | Admin/staff |

Danh sách trả items, total, page, limit. GET room-types/services/customers có q và status=active/inactive/all. Tạo trả HTTP 201 và item; cập nhật/chi tiết trả item. Ngừng hoạt động dùng PATCH status=inactive (phòng dùng active=false); không có DELETE vật lý. Có thể kích hoạt lại.

Room có thêm typeId, active, version. Mỗi bản ghi danh mục/khách/booking đều trả version dùng khi sửa. Booking trả customer snapshot, rooms có giá dự kiến, checkIn/checkOut dạng YYYY-MM-DD, nights, totalGuests, estimatedTotal, deposit, status, note, createdAt và history. Availability trả thêm nights và hai ngày đã tra.

Mọi body ghi là strict: không nhận trường ngoài đặc tả. Giá và sức chứa lấy lại từ server, không nhận tổng tiền của trình duyệt. Mọi lỗi version, trùng dữ liệu hoặc phòng không còn phù hợp trả 409; dữ liệu sai trả 400; không đủ quyền trả 403. Lỗi chuẩn hóa/validation có thể có fields để hiện cạnh trường nhập.

Đặc tả chi tiết về thời gian, chụp dữ liệu, bảo trì và bộ kiểm thử tại [nghiệm thu tuần 2](07_WEEK2.md). Khả dụng trong pending là kết quả kiểm tra tại thời điểm lưu, chưa có thao tác giữ lịch; Phase 3 phải kiểm tra lại trong cơ chế đồng bộ riêng.

## API các giai đoạn sau

Các API sau là hợp đồng dự kiến, chưa có handler và không được coi là chức năng đã chạy:

| Giai đoạn | Nhóm API cần bổ sung |
|---|---|
| 3 | POST bookings/:id/confirm, deposits, cancel, refunds, check-in, extend |
| 4 | Ghi/sửa dịch vụ của booking, promotions, checkout-preview, checkout, invoices và adjustments |
| 5 | reports/revenue, occupancy, top-services, top-customers, my-receipts |

Ví dụ dữ liệu cho tra cứu sau: ngày nhận 2026-09-10, ngày trả 2026-09-12, số khách 2, loại STANDARD. Trả danh sách phòng phù hợp và đơn giá dự kiến; phải kiểm tra lại ngay lúc xác nhận. Ví dụ checkout-preview trả tiền phòng 2.400.000, dịch vụ 100.000, giảm 200.000, cọc 500.000, tổng 2.300.000 và còn thu 1.800.000. Đây là dữ liệu đặc tả, không phải phản hồi từ API đã hiện thực.

Các thao tác giữ phòng/tiền cần request_id và version; phải chốt phản hồi khi gửi lặp trước khi viết handler.

Tham khảo hành vi cookie và session: [Express session middleware](https://expressjs.com/en/resources/middleware/session/).
