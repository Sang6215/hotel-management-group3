# Đo chỉ mục báo cáo tuần 5

Đo lúc 20:25 ngày 13/09/2026 (UTC+7). Lệnh chạy lại: `pnpm bench:reports`.

Môi trường: Windows 10.0.26200, Intel Core i5-13400F, 16 CPU logic, RAM 32 GiB, Node v24.19.0, MongoDB 8.0.15, replica set 1 node cục bộ. Script tạo database tạm riêng; không đọc `.env`, không nhận MONGODB_URI, không kết nối Atlas. Dừng và dọn replica set tạm trong `finally`.

5.000 booking và 5.000 hóa đơn giả lập, chia đều trên 100 ngày; lọc 01/02/2026 giờ Việt Nam thu được 50 bản ghi. Fixture tối giản theo cấu trúc trường truy vấn, không thay thế test nghiệp vụ có schema và transaction thật.

| Truy vấn | Kế hoạch ép để so sánh | Kết quả | Documents examined | Keys examined | executionTimeMillis |
|---|---|---:|---:|---:|---:|
| Hóa đơn paid + paid_at | COLLSCAN | 50 | 5.000 | 0 | 4 |
| Hóa đơn paid + paid_at | Index payment_status + paid_at | 50 | 50 | 50 | 0 |
| Sổ tiền cùng nhân viên/ngày | COLLSCAN | 50 | 5.000 | 0 | 2 |
| Sổ tiền cùng nhân viên/ngày | Index payments.recorded_by + payments.recorded_at | 50 | 50 | 50 | 0 |

Explain dùng `executionStats`; cùng truy vấn được chạy với `$natural` và chỉ mục được chỉ định. Giá trị 0 ms là độ phân giải của MongoDB, không có nghĩa truy vấn mất 0 thời gian. Số documents examined giảm 100 lần trong tập dữ liệu này; không suy ra web nhanh hơn 100 lần. `$elemMatch` buộc ngày và nhân viên thuộc cùng phần tử payments.

Sau warm-up, chạy 5 tác vụ DB đồng thời, mỗi tác vụ tổng hợp doanh thu rồi đọc 50 booking theo sổ thu: **10,40 / 11,56 / 12,67 / 14,38 / 13,53 ms**. Mỗi tổng hợp trả đúng 30.000.000đ. Đây là thời gian DB + driver cục bộ, không bao gồm HTTP, đăng nhập, toàn bộ các facet báo cáo hay Render cold-start.

Các chỉ mục được bổ sung: ngày thu/hoàn; người ghi + ngày; trạng thái + nhận thực tế; trạng thái + thời gian dịch vụ; payment_status + ngày duyệt điều chỉnh. Giữ các chỉ mục lịch phòng và ngày thanh toán hiện có. Khởi động chỉ tạo các chỉ mục khai báo, không xóa chỉ mục cũ.

Kết luận: chỉ mục phù hợp cho hai truy vấn lọc mẫu và đã có số đo tái lập. Mục tiêu end-to-end dưới 2 giây với 5 người trên demo vẫn cần đo riêng ở tuần 6; không coi phép đo này là nghiệm thu tải production.
