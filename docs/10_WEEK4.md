# Tuần 4 — Dịch vụ, khuyến mãi và thanh toán

Triển khai ngày 07/09/2026, tiếp nối toàn bộ chức năng tuần 1–3. Không thay đổi file Word hoặc dữ liệu mẫu lên Atlas.

## Cách sử dụng

1. Quản trị mở **Khuyến mãi → Thêm khuyến mãi**; chọn giảm cố định hoặc phần trăm, trần giảm, tổng tiền tối thiểu và ngày hiệu lực. Lễ tân chỉ xem danh mục.
2. Mở phiếu **Đang lưu trú → Thêm dịch vụ**; chọn phòng trong phiếu, dịch vụ đang hoạt động và số lượng. Hệ thống lưu tên, đơn giá, thời gian và người ghi.
3. **Sửa / hủy dòng** cần lý do. Sửa số lượng không đổi đơn giá cũ. Hủy giữ dòng trong lịch sử nhưng không tính tiền; nếu dùng lại thì thêm dòng mới.
4. Chọn **Trả phòng & thanh toán**. Nhập mã khuyến mãi nếu có, bấm **Xem lại phí** và đối chiếu tiền phòng, dịch vụ, giảm giá, cọc, khoản còn thu hoặc cần hoàn.
5. Sau khi thực tế kiểm tra khoản tiền, chọn phương thức/tham chiếu và ô xác minh, rồi **Hoàn tất trả phòng & lập hóa đơn**. Nếu cần hoàn, chỉ quản trị được thực hiện.
6. Web chuyển sang hóa đơn đã lưu. Toàn bộ phòng trong phiếu chuyển **Đang dọn**; quản trị chỉ chuyển sang **Sẵn sàng** sau khi kiểm tra dọn xong.
7. **Hóa đơn** hỗ trợ tìm theo mã phiếu/khách, lọc ngày, xem chi tiết và **In phiếu** qua hộp thoại in của trình duyệt.
8. Quản trị có thể **Điều chỉnh hóa đơn**, ghi chênh lệch thu thêm/hoàn, lý do và xác minh. Hóa đơn gốc giữ nguyên; lịch sử điều chỉnh và sổ thu/hoàn được lưu riêng.

Nếu mất kết nối sau khi gửi, dùng **Kiểm tra & gửi lại an toàn**. Không tạo yêu cầu mới để đoán giao dịch đã thành công hay chưa.

## Quy tắc đang áp dụng

- Nhận/trả tất cả phòng trong một phiếu cùng lúc. Tính đêm theo ngày nhận thực tế đến ngày trả thực tế tại Việt Nam, tối thiểu 1, tối đa 365; không tính phụ thu theo giờ.
- Đơn giá phòng giữ từ lúc xác nhận; dịch vụ giữ từ lúc ghi. Thay đổi danh mục sau này không sửa hóa đơn đã lập.
- Một mã khuyến mãi áp dụng trên phòng + dịch vụ; kiểm tra thời hạn, tổng tối thiểu và trần giảm lúc hoàn tất. Phần trăm làm tròn tới đồng, giảm không vượt tổng chi phí.
- Tổng hóa đơn đã bao gồm phần cọc. Chỉ thu phần thiếu hoặc hoàn phần dư; không ghi giao dịch tiền 0. Hoàn dư cần admin.
- Checkout, hóa đơn duy nhất cho phiếu, sổ tiền và trạng thái phòng nằm trong cùng MongoDB transaction. Xảy ra lỗi thì không lưu dở dang.
- version và báo giá chống dữ liệu cũ; UUID và biên nhận chống thu trùng khi gửi lại. Các lệnh đồng thời được kiểm thử với MongoDB thật.
- Điều chỉnh không ghi đè hóa đơn gốc, không làm giá trị sau điều chỉnh âm và luôn gắn khoản chênh lệch vào sổ thu/hoàn.
- Giới hạn bảo vệ document: 500 dòng dịch vụ, 500 điều chỉnh mỗi hóa đơn, 1.000 lệnh mỗi phiếu. Số tiền là số nguyên VND, tối đa 20.000.000.000.000 đồng.

## Kiểm thử tự động

Lần chạy 07/09/2026: **78/78 bài đạt** (15 nền tảng, 17 tuần 2, 16 tuần 3, 24 tích hợp tuần 4, 6 tính tiền). TypeScript và build giao diện/máy chủ đạt.

Các ca mới gồm: quyền và CSRF; khuyến mãi trùng mã/hiệu lực/phiên bản; dịch vụ sai phòng/số lượng/ngừng dùng; chốt giá/sửa/hủy; báo giá cũ; làm tròn/trần giảm; trả sớm/tối thiểu một đêm; dư cọc cần admin; tiền 0; gửi lặp và tranh chấp dịch vụ–trả phòng/gia hạn–trả phòng; hóa đơn bất biến; tìm theo ngày; điều chỉnh dương/âm; rollback toàn bộ khi ghi hóa đơn hoặc phiếu lỗi.

Ca đối chiếu: 2.400.000đ phòng + 100.000đ dịch vụ − 200.000đ giảm = 2.300.000đ; cọc 500.000đ nên còn thu 1.800.000đ. Test chạy trên replica set tạm riêng, không dùng Atlas hoặc database phát triển.

## Kiểm tra giao diện trên Brave

Ngày 07/09/2026, đã tiếp tục đúng phiếu cục bộ có nhãn mẫu `DP-20260905-E0B71361` của khách mẫu 02, phòng 101/102; không tạo giao dịch trên Atlas.

- Mã `W4_DEMO_200K` được lưu và đọc lại sau lần khởi động mới.
- Ghi 1 suất Bữa sáng 100.000đ vào phòng 101; bảng phí trả đúng 2.400.000đ phòng + 100.000đ dịch vụ − 200.000đ giảm = 2.300.000đ. Phiếu mẫu cọc 360.000đ nên còn thu 1.940.000đ.
- Hoàn tất qua biểu mẫu: tạo hóa đơn `HD-20260907-DBD71FF1-220`, giữ sổ cọc và khoản thu còn lại; phòng 101/102 chuyển Đang dọn.
- Điều chỉnh giả lập hoàn 20.000đ với lý do ghi rõ là dữ liệu mẫu; hóa đơn gốc vẫn 2.300.000đ, giá trị sau điều chỉnh 2.280.000đ. Tải lại trang vẫn đúng dữ liệu.
- Đã kiểm tra trực quan màn thanh toán và chi tiết hóa đơn. Nút In phiếu có trên giao diện; chưa nghiệm thu bản in trên máy in vật lý.

## Giới hạn và phần tiếp theo

Đây là phiếu thanh toán nội bộ, không phải hóa đơn điện tử thuế. Tiền mặt/chuyển khoản/thẻ chỉ ghi nhận khoản nhân viên đã kiểm tra bên ngoài; chưa có kết nối cổng thanh toán/ngân hàng. Báo cáo doanh thu, công suất và thống kê thuộc tuần 5. Ảnh minh chứng, nội dung báo cáo Word và các yêu cầu import/export, backup/restore cần nghiệm thu riêng theo thang điểm.
