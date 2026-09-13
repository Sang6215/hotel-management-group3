# Hợp đồng API Phase 1–3

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

## API bổ sung tuần 3 (đã hoạt động)

Các POST dưới đây cần cookie + CSRF, requestId (UUID, phạm vi booking) và version. Body strict; giá, tổng tiền và số tiền hoàn tính tại máy chủ.

| Đường dẫn | Method | Các trường thêm ngoài requestId/version | Quyền |
|---|---|---|---|
| /bookings/:id/confirmation-quote | GET | Không; trả quote: token, rooms, customer, total, minimumDeposit, depositPercent, nights | Cả hai |
| /bookings/:id/confirm | POST | quoteToken, amount (cọc), method, reference tùy chọn | Cả hai; chỉ pending |
| /bookings/:id/deposits | POST | amount, method, reference tùy chọn | Cả hai; chỉ confirmed |
| /bookings/:id/cancel | POST | reason 3–500 ký tự | Cả hai; pending/confirmed |
| /bookings/:id/refunds | POST | method, reference tùy chọn, reason | Admin; cancelled chờ hoàn |
| /bookings/:id/check-in | POST | Không | Cả hai; confirmed, đúng ngày, mọi phòng available |
| /bookings/:id/extend | POST | checkOut YYYY-MM-DD, reason | Cả hai; checked_in |
| /bookings/:id/reschedule | POST | checkIn, checkOut YYYY-MM-DD, reason | Cả hai; confirmed |

method là cash/transfer/card. Thành công trả HTTP 200 với item (phiếu hiện tại), receipt (requestId, action, at, version, amount của lần thực hiện gốc). Cùng mã/nội dung/tài khoản trả receipt cũ và item mới nhất, không thực hiện lại. Cùng mã khác nội dung hoặc người gửi trả 409. Hỏng kết nối dùng lại đúng requestId và body; không phát mã mới. Mã báo giá thay đổi hoặc version cũ trả 409.

BookingView thêm payments, refundStatus (none/pending/refunded), refundedTotal, depositPercent, actualCheckIn, confirmedAt; history có by. deposit là cọc còn giữ sau hoàn. GET /bookings thêm refund=pending để lọc chờ hoàn. Các trường commands/hashes nội bộ không xuất ra API.

Quy tắc và giới hạn tại [Tuần 3](09_WEEK3.md).

## API bổ sung tuần 4 (đã hoạt động)

Tiền tố /api/v1; mọi thao tác ghi cần cookie phiên + JSON + CSRF. Các lệnh dịch vụ, trả phòng và điều chỉnh cần requestId UUID và version. Body strict; không nhận giá tự đặt từ client.

| Đường dẫn | Method | Đầu vào chính | Quyền |
|---|---|---|---|
| /promotions | GET, POST | GET: q, status, page, limit. POST: code, type fixed/percentage, value, maxDiscount, minAmount, startsOn, endsOn, status | Đọc cả hai; ghi admin |
| /promotions/:id | PATCH | Trường tạo + version | Admin |
| /bookings/:id/services | POST | requestId, version, roomId, serviceId, serviceVersion, quantity | Cả hai; checked_in |
| /bookings/:id/services/:lineId | PATCH | requestId, version, quantity, voided, reason | Cả hai; checked_in |
| /bookings/:id/checkout-preview | POST | promotionCode, có thể để trống | Cả hai; chỉ đọc, checked_in |
| /bookings/:id/checkout | POST | requestId, version, promotionCode, quoteToken, amount, method, reference, verified=true | Cả hai; khoản hoàn cần admin |
| /invoices | GET | q, from, to, customerId, page, limit | Cả hai |
| /invoices/:id | GET | Không | Cả hai |
| /invoices/:id/adjustments | POST | requestId, version hóa đơn, amount có dấu, method, reference, reason, verified=true | Admin |

checkout-preview trả quote gồm token, version, ngày thực tế, nights, rooms, services, roomTotal, serviceTotal, discount, total, deposit, toCollect, toRefund và promotionCode. Khi trả phòng, amount phải đúng khoản thu hoặc hoàn trong báo giá; máy chủ tính lại và từ chối báo giá cũ. Tiền phòng, dịch vụ, hóa đơn và sổ thu/hoàn được chốt trong cùng transaction; phòng chuyển cleaning.

Dịch vụ lưu đơn giá tại thời điểm ghi. Sửa số lượng giữ đơn giá, hủy giữ lịch sử và loại khỏi tổng; dòng đã hủy không mở lại. Một hóa đơn dùng tối đa một mã khuyến mãi, tính trên phòng + dịch vụ, có mức tối thiểu/trần giảm và ngày hiệu lực bao gồm cả ngày kết thúc.

BookingView thêm services, serviceTotal, actualCheckOut và invoiceId. InvoiceView trả bản chụp khách/phòng/dịch vụ/giá/sổ tiền tại lúc lập, cùng adjustments, adjustmentTotal và effectiveTotal. Điều chỉnh dương là thu thêm, âm là hoàn; không sửa giá trị gốc. Danh sách có phân trang tối đa 200; bộ lọc ngày hóa đơn tính theo Việt Nam và bao gồm hết ngày to.

Lệnh ghi trả item hiện tại và receipt gốc; gửi lại cùng UUID, body và tài khoản không ghi lần nữa. Sau mất kết nối phải gửi lại nguyên yêu cầu. Xem [quy tắc và kiểm thử tuần 4](10_WEEK4.md).

## API các giai đoạn sau

Các API sau là hợp đồng dự kiến, chưa có handler và không được coi là chức năng đã chạy:

| Giai đoạn | Nhóm API cần bổ sung |
|---|---|
| 5 | reports/revenue, occupancy, top-services, top-customers, my-receipts |

Ca kiểm thử thanh toán đã chạy: tiền phòng 2.400.000, dịch vụ 100.000, giảm 200.000, cọc 500.000, tổng 2.300.000 và còn thu 1.800.000. Dữ liệu kiểm thử nằm trên replica set riêng, không phải giao dịch thực tế trên Atlas.

Các thao tác giữ phòng/tiền tuần 3 và thanh toán tuần 4 dùng requestId, version và biên nhận như trên.

## API bổ sung tuần 5 (đã hoạt động)

Tiền tố /api/v1; tất cả GET, cần phiên đăng nhập. Query strict. Khoảng ngày `from/to` theo giờ Việt Nam, bao gồm ngày kết thúc, tối đa 366 ngày. Mặc định đầu tháng đến hôm nay; giao diện sổ cá nhân tự truyền hôm nay. Không tính sự kiện sau `asOf`.

| Đường dẫn | Query thêm ngoài from/to | Quyền |
|---|---|---|
| /reports/revenue | groupBy=day/month | Admin |
| /reports/cash-flow | employeeId, method=cash/transfer/card, kind=deposit/checkout/refund/adjustment, page, limit (1–100) | Admin |
| /reports/my-receipts | method, kind, page, limit; không nhận employeeId | Cả hai, cưỡng chế danh tính phiên |
| /reports/occupancy | typeId tùy chọn, áp theo loại tại đêm lịch sử | Admin |
| /reports/top-services | mode=usage/invoice, limit (1–50) | Admin |
| /reports/top-customers | limit (1–50) | Admin |
| /customers/:id/spending | Không có query, tổng từ dữ liệu hệ thống đến hiện tại | Cả hai |

Kiểu kết quả ở `shared/reports.ts`. Báo cáo trả from/to/asOf/timezone và dữ liệu thật; tổng không phụ thuộc phân trang. Dòng tiền nhóm tối đa 200 nhân viên kèm employeeCount để thông báo thiếu trang nhóm; chi tiết sổ tiền phân trang độc lập. Báo cáo công suất trả through, totals, items theo ngày, byType và warnings; tỷ lệ null khi mẫu số 0 hoặc có lưu trú xung đột ngày ngừng phục vụ.

400 cho query sai, 401 chưa đăng nhập/phiên hết hiệu lực, 403 sai quyền, 404 khách không tồn tại, 409 tổng vượt giới hạn chính xác, 413 công suất vượt giới hạn 2.500 phòng/20.000 lượt. Truy vấn có thời gian tối đa 15 giây ở MongoDB. Định nghĩa doanh thu, dòng tiền, top, lịch sử phòng và hạn chế tại [Tuần 5](11_WEEK5.md).

Tham khảo hành vi cookie và session: [Express session middleware](https://expressjs.com/en/resources/middleware/session/).
