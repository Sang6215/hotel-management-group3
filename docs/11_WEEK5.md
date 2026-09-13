# Tuần 5 — Báo cáo và đối chiếu

Phiên bản 0.5.0, ngày 13/09/2026. Thực hiện tuần kế tiếp trong kế hoạch sáu tuần; giữ các chức năng tuần 1–4 và dữ liệu hiện có. Không mở trình duyệt để thử theo yêu cầu người dùng. Kiểm chứng bằng test tự động, build và HTTP khi triển khai.

## Chức năng đã bổ sung

| Màn hình | Quyền | Nội dung |
|---|---|---|
| Báo cáo → Doanh thu | Admin | Theo ngày/tháng, cơ cấu tiền phòng/dịch vụ/giảm giá/điều chỉnh, so sánh dòng tiền |
| Báo cáo → Dòng tiền | Admin | Thu, hoàn, thuần; tổng hợp theo người ghi và phương thức; lọc nhân viên, loại giao dịch, phương thức, phân trang |
| Báo cáo → Công suất phòng | Admin | Đêm phòng thực tế và khả năng phục vụ trong lịch sử; bảng ngày/loại phòng, cảnh báo dữ liệu thiếu |
| Báo cáo → Dịch vụ | Admin | Top 20 theo thời gian sử dụng hoặc hóa đơn thanh toán; không gộp các đơn vị tính khác nhau |
| Báo cáo → Khách hàng | Admin | Top 20 theo mã khách; hóa đơn gốc, điều chỉnh và chi tiêu trong kỳ |
| Sổ thu của tôi | Cả hai | Chỉ giao dịch do tài khoản đăng nhập ghi nhận, lọc ngày/phương thức/loại và phân trang |
| Khách hàng → Lịch sử | Cả hai | Tổng chi tiêu đã thanh toán và điều chỉnh của đúng hồ sơ, cùng danh sách booking |

Chọn Từ ngày / Đến hết ngày rồi nhấn Xem báo cáo. Báo cáo quản trị mặc định từ đầu tháng đến hôm nay; sổ cá nhân mặc định hôm nay. Khoảng báo cáo tối đa 366 ngày, gồm cả ngày kết thúc. API kiểm tra quyền độc lập với việc ẩn menu. Sổ cá nhân không nhận mã nhân viên từ client; lấy danh tính từ phiên đã xác thực.

## Định nghĩa số liệu

- Giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7), không dùng ngày theo đồng hồ máy người xem. Mọi báo cáo ghi mốc dữ liệu `asOf`; không tính sự kiện nằm sau mốc đó.
- Doanh thu = giá trị hóa đơn gốc đã thanh toán theo `paid_at` + điều chỉnh theo `approved_at`. Không cộng tiền cọc lần nữa, không đẩy điều chỉnh tháng sau về tháng hóa đơn gốc.
- Cơ cấu phòng/dịch vụ là trước giảm; giảm giá và điều chỉnh tách riêng. Hóa đơn nhiều phòng vẫn chỉ được cộng một lần.
- Dòng tiền = các dòng thu trừ hoàn theo `payments.recorded_at`, gồm cọc, thu cuối và thu/hoàn điều chỉnh. Tổng áp dụng cho toàn bộ bộ lọc, không chỉ trang đang xem. Người ghi là người xác nhận trên web, không phải lịch ca.
- Top dịch vụ theo lượt dùng lấy dòng chưa hủy của booking đang ở/hoàn thành, theo `used_at`. Chế độ hóa đơn lấy snapshot trên hóa đơn đã trả, theo `paid_at`, trước giảm giá chung và điều chỉnh chung; không phân bổ tùy tiện giảm giá hóa đơn về từng dịch vụ.
- Top khách nhóm bằng `customer_id`, không nhóm theo tên. Tên hiển thị lấy snapshot gần nhất trong kỳ; hai người trùng tên vẫn tách riêng. Tổng chi tiêu hồ sơ là hóa đơn và điều chỉnh đã ghi đến hiện tại, không phải cọc đang giữ.
- Truy vấn tài chính dùng aggregation trong một snapshot transaction; từ chối tổng vượt miền số nguyên an toàn, kể cả cộng/trừ điều chỉnh lớn có thể triệt tiêu nhau.

## Quy ước công suất và dữ liệu cũ

Công suất = đêm phòng đã sử dụng / đêm phòng có thể phục vụ × 100. Khoảng lưu trú lấy ngày nhận thực tế đến trước ngày trả thực tế; đếm riêng từng phòng, cắt theo khoảng báo cáo. Chỉ tính đêm lịch đã kết thúc. Booking đang ở tính đến đêm hôm qua, không dừng theo ngày trả dự kiến đã quá hạn. Pending, confirmed và cancelled không phải lưu trú thực tế.

Nhận và trả cùng ngày có 0 đêm công suất, dù quy tắc tính tiền tối thiểu là 1 đêm. Đây là báo cáo đêm lịch, không phải tỷ lệ sử dụng theo giờ. Khi có nhiều thay đổi trong một ngày, dùng trạng thái danh mục cuối ngày; ngày kết thúc bảo trì được xem là ngày mở lại. Khoảng bảo trì chồng nhau chỉ loại mỗi đêm một lần.

`rooms.inventory_history` lưu mốc thời gian, mã/tên loại và khả năng phục vụ. Khả năng phục vụ yêu cầu phòng hoạt động, không bảo trì và loại phòng hoạt động. Thay đổi phòng hoặc tên/trạng thái loại phòng ghi lịch sử trong transaction cùng thao tác danh mục. Thay đổi giá không sửa lịch sử hóa đơn; trạng thái dọn phòng vẫn thuộc khả năng phục vụ, không phải ngừng kinh doanh dài hạn.

Lần khởi động bản tuần 5 tự bổ sung mốc hiện trạng cho phòng chưa có lịch sử, tại thời điểm nâng cấp. Không gán mốc ngược về ngày tạo phòng, không đổi giá/trạng thái/booking hay seed dữ liệu mẫu lên online. Chạy lại không thêm mốc trùng. Các đêm trước mốc đầu tiên được ghi “chưa đủ lịch sử” và loại khỏi cả tử số/mẫu số; không giả định công suất cả tháng là 0%. Tỷ lệ chỉ mô tả phần đủ lịch sử.

Nếu lưu trú rơi vào đêm được ghi ngừng phục vụ, báo xung đột và không công bố tỷ lệ tổng. Giới hạn mỗi lần tính là 2.500 phòng và 20.000 lượt lưu trú giao khoảng; vượt giới hạn trả lỗi rõ. Không thay trạng thái phòng từ kết quả báo cáo.

## Đối chiếu tính tay

| Kỳ | Sự kiện | Doanh thu | Thu | Hoàn | Thuần |
|---|---|---:|---:|---:|---:|
| Tháng 1 | Cọc 31/01 lúc 23:30 | 0 | 500.000 | 0 | 500.000 |
| Tháng 2 | Hóa đơn 2 phòng: 2.400.000 + 100.000 − 200.000; thu còn lại | 2.300.000 | 1.800.000 | 0 | 1.800.000 |
| Tháng 3 | Duyệt giảm và hoàn 100.000 | −100.000 | 0 | 100.000 | −100.000 |

Ví dụ công suất: 2 phòng đều đủ lịch sử, khoảng 31/01–02/02 gồm 3 đêm/phòng; cả hai được sử dụng đêm 31/01 và 01/02 → 4/6 = 66,67%. Test bổ sung phòng bảo trì, thay loại, thiếu lịch sử, lưu trú đang mở và nhiều phiếu tham chiếu cùng phòng.

## Kiểm chứng và giới hạn bàn giao

- Bộ kiểm tra hiện có 106 bài: 78 bài tuần 1–4 và 28 bài mới (14 API/MongoDB, 10 công suất/ngày/số an toàn, 4 render thành phần giao diện).
- MongoDB kiểm thử là replica set riêng tự khởi động và dọn sau test; không tạo giao dịch thử trên Atlas. Các dòng log lỗi trong test rollback là lỗi được chủ động gây ra để kiểm chứng hoàn tác.
- Đo index trên 5.000 booking và 5.000 hóa đơn giả lập riêng: [kết quả đo](12_INDEX_BENCHMARK.md). Đây không phải đo HTTP/Render hay cam kết tải thực tế.
- Kiểm tra TypeScript và build production. Render tự triển khai khi đẩy main; kiểm tra HTTP health và tên bundle để xác định bản mới, không mở web để thao tác thử.
- Chưa kiểm thử tương tác/hiển thị bằng trình duyệt trong tuần này theo yêu cầu. Chưa nghiệm thu trên máy hai thành viên còn lại; dành cho tuần 6. Không chỉnh Word hoặc tạo ảnh minh chứng giả.
- Không thêm thanh toán ngân hàng, lịch ca, xuất Excel hay biểu đồ nâng cao ngoài phạm vi bản đầu.

## Tuần 6 tiếp theo

Chạy từ bản clone sạch trên máy thành viên; đối chiếu toàn bộ luồng đặt nhiều phòng → cọc → nhận → dịch vụ → trả → hóa đơn → báo cáo; chuẩn bị dữ liệu demo được nhóm duyệt, ảnh thật và hướng dẫn thao tác. Sau đó diễn tập bảo vệ và sửa lỗi tìm được. Không đưa dữ liệu đo tải vào database online của nhóm.
