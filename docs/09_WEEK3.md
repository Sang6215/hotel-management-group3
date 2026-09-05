# Tuần 3 — Xác nhận, cọc và lưu trú

Triển khai ngày 05–06/09/2026, tiếp nối danh mục và đặt phòng nháp tuần 2. Dùng hai vai trò quản trị/lễ tân hiện có. Không thay đổi nội dung Word.

## Thao tác trên web

1. **Đặt phòng → Tạo đặt phòng**: chọn khách, ngày và phòng; lưu nháp.
2. Trong chi tiết phiếu, chọn **Xác nhận & nhận cọc**. Đọc báo giá mới, số cọc tối thiểu, nhập số tiền/phương thức/tham chiếu; xác nhận đã kiểm tra giao dịch. Khi thành công, phiếu giữ toàn bộ lịch phòng và chốt giá.
3. Phiếu đã xác nhận có **Nhận cọc bổ sung**, **Đổi lịch nhận/trả**, **Nhận phòng** và **Hủy đặt phòng**. Đổi lịch giữ đơn giá đã chốt, kiểm tra lịch và mức cọc theo lịch mới.
4. **Nhận phòng** chỉ trong đúng ngày nhận dự kiến; mọi phòng phải sẵn sàng và không còn khách cũ. Phòng đang dọn cần quản trị sửa trạng thái sang Sẵn sàng trong **Phòng khách sạn** sau khi kiểm tra thực tế.
5. Phiếu đang lưu trú có **Gia hạn lưu trú**: ngày trả mới phải sau ngày cũ và sau hôm nay. Thêm đêm theo đơn giá đã chốt, kiểm tra lại tất cả phòng, không tự thu thêm cọc.
6. **Hủy đặt phòng** cần lý do; chỉ dùng với phiếu nháp/đã xác nhận. Lịch được giải phóng ngay. Cọc còn giữ chuyển thành chờ hoàn.
7. Chọn bộ lọc **Chờ hoàn cọc** trong danh sách. Quản trị mở phiếu và **Duyệt & ghi nhận hoàn cọc**, nhập phương thức/lý do và xác minh đã hoàn toàn bộ. Lễ tân xem được trạng thái, không có quyền ghi hoàn.
8. Xem **Sổ cọc & hoàn tiền** và lịch sử để đối chiếu số tiền, thời gian và người ghi. Tải lại trang vẫn đọc được dữ liệu đã lưu.

Khi kết nối gián đoạn sau lúc gửi lệnh, giao diện giữ yêu cầu trong phiên tab và có nút **Kiểm tra & gửi lại an toàn**. Dùng nút này để lấy kết quả của cùng yêu cầu; không tự lập khoản thu mới. Máy chủ lưu mã yêu cầu, nội dung và biên nhận cùng giao dịch nghiệp vụ.

## Mặc định nghiệp vụ đang áp dụng

- Cọc tối thiểu 30% tiền phòng, làm tròn lên đồng (DEPOSIT_PERCENT); tổng cọc không vượt tiền phòng. Giá 0 hoặc tỷ lệ cọc 0 cho xác nhận không ghi khoản tiền 0 vào sổ.
- Hủy trước nhận phòng không có phí; quản trị xác nhận hoàn toàn bộ cọc. Cọc còn giữ về 0 sau hoàn; sổ thu và sổ hoàn đều được giữ.
- Tiền mặt/chuyển khoản/thẻ chỉ ghi nhận giao dịch đã được nhân viên kiểm tra ngoài hệ thống, chưa tích hợp ngân hàng.
- Ngày theo Việt Nam; tính đêm theo ngày lịch, tối đa 365 đêm. Nhận/trả tất cả phòng trong một phiếu đồng thời. 14:00/12:00 là giờ dự kiến trong kế hoạch, bản này không tính phụ thu theo giờ và không chặn giờ trong ngày nhận.
- Đến sớm/muộn khác ngày dự kiến cần đổi lịch trước. Lịch mới không được ở quá khứ. Không tự hoàn tất khách quá ngày trả; phòng vẫn occupied và ngăn giao cho khách kế tiếp.
- Đổi lịch trước nhận phòng giữ giá; nếu cọc chưa đủ theo tổng mới, cần thu thêm trước; nếu cọc vượt tổng mới, xử lý hủy/hoàn và lập phiếu mới. Bản này không có hoàn một phần khi rút ngắn lịch.
- Gia hạn khi đang ở giữ giá, tăng tiền phòng; chưa thu thêm cọc bắt buộc. Phần còn thiếu sẽ tính ở thanh toán tuần 4.
- Không sửa phòng occupied, không gán occupied thủ công. Xác nhận/dọn phòng/bảo trì/ngừng phòng được kiểm soát cùng cơ chế giao dịch.

Đây là mặc định cụ thể hóa kế hoạch sáu tuần, không phải quy định đã được giảng viên xác nhận riêng.

## Cách bảo vệ dữ liệu

Xác nhận và các thao tác đổi lịch/nhận phòng/hủy chạy trong MongoDB transaction. Trước khi kiểm tra lịch, máy chủ ghi vào schedule_version của các phòng theo thứ tự cố định. Các thao tác danh mục tác động lịch dùng chung các phòng và điểm ghi phối hợp trên loại phòng; xác nhận cũng kiểm tra lại khách đang hoạt động. Nhờ đó hai booking khác nhau không chỉ đọc cùng một ảnh chụp phòng trống rồi cùng thành công.

Giá và thông tin khách được xem lại qua confirmation-quote. Mã báo giá gắn với phiếu, version, lịch và dữ liệu hiện tại; nếu thay đổi giữa lúc xem và xác nhận, máy chủ từ chối để nhân viên đọc lại.

requestId là UUID trong phạm vi một booking; hash gắn với nội dung lệnh và tài khoản. Cùng requestId/nội dung/tài khoản trả lại biên nhận cũ, không ghi lại. Dùng lại mã với nội dung/tài khoản khác trả 409. Phản hồi gồm biên nhận bất biến và item là trạng thái hiện tại của phiếu (có thể đã có thao tác sau đó). Giới hạn 1.000 lệnh mỗi phiếu để giới hạn kích thước document. Lệnh thất bại không lưu dấu hoàn thành; có thể gửi lại cùng mã.

## Kiểm thử và dữ liệu thực hành

48/48 bài kiểm thử tích hợp đạt ở lần chạy cuối ngày 06/09/2026: 15 nền tảng, 17 tuần 2, 16 tuần 3. TypeScript và build giao diện/máy chủ cũng đạt. Các bài tuần 3 chạy yêu cầu API và transaction thật trên replica set tạm riêng, không sử dụng database Atlas hoặc database phát triển.

Đã kiểm tra: hai nhân viên tranh một phòng; nhiều phòng thất bại không giữ/thu một phần; xác nhận đồng thời với bảo trì hoặc ngừng loại phòng; gửi lặp cùng yêu cầu; gửi cùng mã khác nội dung/người; cọc vượt giới hạn; version cũ; quyền hoàn; hủy giải phóng lịch; check-in đúng ngày/phòng dọn xong; rollback khi ghi phiếu lỗi sau cập nhật phòng; gia hạn đụng lịch hoặc tranh với booking mới; giữ snapshot giá; lịch giáp ranh; khách/phòng/loại bị thay đổi trước xác nhận.

Hai phiếu kiểm tra qua Brave trên database cục bộ, đều ghi nhãn `[Mẫu tuần 3]`:

- `DP-20260905-E0B71361`: khách mẫu 02, phòng 101/102, nhận 05/09/2026, ban đầu trả 06/09, cọc 360.000đ; đã nhận phòng và gia hạn đến 07/09. Tiền phòng sau gia hạn 2.400.000đ, cọc còn giữ 360.000đ. Tải lại giữ trạng thái đang lưu trú.
- `DP-20260905-8444B8F2`: khách mẫu 03, phòng 103, cọc 180.000đ; đã hủy và quản trị ghi hoàn đúng 180.000đ. Tải lại thấy hai dòng thu/hoàn và cọc còn giữ 0.

Đây là dữ liệu giả lập, không phải khoản tiền thật; không chép hai phiếu mẫu lên Atlas. Phòng 101/102 ở bản cục bộ đang occupied để tiếp tục thực hành tuần 4.

## Phần còn lại

Tuần 4: ghi dịch vụ phát sinh, khuyến mãi, tính phí, check-out/thu tiền, hóa đơn/phiếu in và điều chỉnh. Tuần 5: báo cáo. Bản tuần 3 chưa có nút hoàn tất trả phòng, nên chỉ thực hành với dữ liệu demo.
