# Việc tiếp theo sau Phase 1

**Cập nhật 05/09/2026:** phần tuần 2 bên dưới đã triển khai, gồm cả danh mục dịch vụ. Xem [hướng dẫn và kết quả](07_WEEK2.md). Các phân công ban đầu giữ lại để nhóm tham khảo, không phải công việc còn thiếu trong mã nguồn hiện tại.

## Bắt đầu tuần 3

1. Chốt các quy tắc cọc/hủy/hoàn với nhóm; giữ mặc định đề xuất trong đặc tả nếu được nhóm thông qua.
2. Dùng schedule_version trên phòng làm điểm ghi chung trong transaction: các thao tác xác nhận, đổi lịch, bảo trì và ngừng phòng phải cùng tham gia cơ chế này. Chỉ transaction mà không ghi chung vẫn có thể đặt trùng.
3. Xác nhận nháp: kiểm tra lại khách, sức chứa, lịch và giá; chốt snapshot; ghi confirmed và cọc cùng giao dịch, xử lý request_id để chống gửi lặp.
4. Hủy/duyệt hoàn cọc, check-in đồng thời mọi phòng, gia hạn có kiểm tra lịch; không tự hoàn tất theo ngày.
5. Kiểm thử hai nhân viên tranh cùng phòng, rollback khi ghi tiền lỗi, hủy giải phóng lịch và bảo trì không chen vào lịch vừa xác nhận.

Không có API ghi tiền hoặc xác nhận trong tuần 2. Guard danh mục hiện tại cần nâng cấp cùng transaction khi triển khai tuần 3.

Phân công đề xuất bám kế hoạch sáu tuần; nhóm có thể đổi người theo sở trường. Nền tảng đã được chuẩn bị chung, chưa gán năng lực hoặc cam kết thời gian cho từng người.

| Thành viên | Bắt đầu tiếp từ đâu | Đầu ra kế tiếp |
|---|---|---|
| Phạm Vũ Trường Anh — 2001230010 | server/app.ts, server/models.ts, docs/03_API_CONTRACT.md | API tra phòng theo ngày, booking nháp, đặc tả transaction xác nhận |
| Trương Quang Sang — 2001230755 | client/src/main.tsx, styles.css, docs/04_WIREFRAMES.md | CRUD phòng/loại phòng và khách, form tạo booking nối API |
| Cao Lê Hải Đăng — 2001230170 | Schema payments/invoices, docs/01_SCOPE_AND_RULES.md | Module tính đêm/tiền, dữ liệu đối chiếu, hợp đồng cọc/hoàn và khuyến mãi |

## Buổi làm chung đầu tiên

- [ ] Sang và Đăng khởi động được trên máy của mình.
- [ ] Nhóm thống nhất giờ nhận/trả, số đêm, cọc 30%, hủy/hoàn và hóa đơn điều chỉnh.
- [ ] Chốt quyền xác nhận dọn phòng: hiện kế hoạch theo Word là admin.
- [ ] Chốt mô hình nhiều phòng cùng nhận/trả và cách phân bổ số khách.
- [ ] Thống nhất commit/nhánh và kết nối repository Git cục bộ với nơi lưu chung do nhóm chọn.
- [ ] Xác nhận hạn nộp để điều chỉnh tiến độ sáu tuần.

## Thứ tự triển khai Phase 2

1. Tách giao diện theo các module khi thêm chức năng, dùng lại api.ts và kiểu chung.
2. CRUD loại phòng/phòng và khách, đầy đủ validation máy chủ và quyền.
3. GET rooms/availability với ngày nhận/trả; kiểm tra lịch confirmed/checked_in.
4. POST bookings tạo nháp nhiều phòng, snapshot khách và báo giá dự kiến.
5. Giao diện tìm phòng → chọn khách → tạo nháp → xem chi tiết, lưu thật MongoDB.
6. Kiểm thử lịch biên, sức chứa, trùng giấy tờ, tải lại trang và lỗi API.

Chỉ gọi “đặt phòng hoàn chỉnh” khi Phase 3 có cơ chế xác nhận chống trùng đồng thời và nhận cọc an toàn. Transaction probe ở Phase 1 chứng minh môi trường hỗ trợ transaction, chưa chứng minh nghiệp vụ đặt phòng đã đúng.

## Tài liệu để nộp bài

Word giữ nội dung nghiệp vụ và mô hình; nhóm thêm ảnh kết quả đúng thời điểm module đã chạy. Chưa chèn ảnh thanh toán giả hoặc ghi đã kiểm thử nghiệp vụ chưa được phát triển. Mã nguồn, câu lệnh và đặc tả kỹ thuật nằm trong thư mục dự án nộp kèm.
