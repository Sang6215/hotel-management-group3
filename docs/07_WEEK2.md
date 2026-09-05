# Tuần 2 — Danh mục, khách hàng và đặt phòng nháp

Triển khai và kiểm tra trên máy hiện tại ngày 05/09/2026. Phạm vi lấy từ dòng tuần 2 trong kế hoạch sáu tuần; có cả danh mục dịch vụ.

## Các phần đã dùng được

| Phần | Thao tác trên giao diện | Quyền |
|---|---|---|
| Loại phòng | Thêm/sửa mã, tên, giá theo đêm, sức chứa, tiện ích, mô tả, ngừng/kích hoạt lại | Quản trị sửa; cả hai vai trò xem |
| Phòng | Thêm/sửa số, tầng, loại, trạng thái, ngừng/kích hoạt lại; tìm và lọc | Quản trị sửa; cả hai vai trò xem |
| Dịch vụ | Thêm/sửa mã, tên, nhóm, đơn vị, giá, ngừng/kích hoạt lại | Quản trị sửa; cả hai vai trò xem |
| Khách hàng | Thêm/sửa, tìm điện thoại/giấy tờ/tên, ngừng/kích hoạt lại, xem lịch sử phiếu | Cả hai |
| Tra phòng | Chọn ngày nhận/trả, loại và sức chứa tối thiểu từng phòng | Cả hai |
| Phiếu nháp | Chọn hoặc thêm khách, nhiều phòng và số khách từng phòng; ghi chú, báo giá, lưu, sửa, mở lại | Cả hai |

Không xóa vật lý danh mục hoặc khách đã lưu. Muốn ngừng dùng, chỉnh Trạng thái; có thể mở lại. Các danh sách có tìm kiếm, phân trang, trạng thái tải/rỗng/lỗi.

## Thử ngay trong web

1. Chạy `Start-Hotel.ps1`, mở `http://127.0.0.1:5173/`, đăng nhập tài khoản mẫu trong README.
2. Mở **Loại phòng** để thêm giá và sức chứa; mở **Phòng khách sạn** để thêm phòng thuộc loại đó. Quản trị cũng chỉnh trạng thái dọn xong/bảo trì tại đây.
3. Mở **Khách hàng**, thêm hồ sơ hoặc dùng Khách mẫu 01–03. Số điện thoại và giấy tờ phải duy nhất.
4. Mở **Dịch vụ**, thêm/sửa đơn giá hoặc ngừng dùng một dịch vụ. Ghi nhận khách sử dụng dịch vụ sẽ được làm ở tuần 4.
5. Mở **Đặt phòng → Tạo đặt phòng**. Chọn khách, nhập ngày nhận/trả, bấm **Tìm phòng theo ngày**.
6. Chọn hai phòng, điền số khách từng phòng, kiểm tra tổng tiền phòng dự kiến và **Lưu phiếu nháp**.
7. Trang chi tiết hiện mã phiếu, khách, phòng, ngày, giá và lịch sử. Tải lại trang vẫn đọc được phiếu từ MongoDB.
8. Bấm **Sửa phiếu nháp** để đổi dữ liệu. Đổi ngày sẽ bỏ lựa chọn phòng cũ để tìm lại; lưu sửa sẽ báo giá lại theo danh mục.
9. Mở hồ sơ khách và **Lịch sử** để truy ngược các phiếu của khách đó.

Phiếu mẫu đã tạo qua giao diện trên máy này: `DP-20260910-8CAE2E6E`, Khách mẫu 01, phòng 101 và 102, từ 10/09/2026 đến 12/09/2026. Mỗi phòng 600.000đ/đêm × 2 đêm, tổng 2.400.000đ, cọc bằng 0. Ghi chú có nhãn `[Mẫu tuần 2]`. Đây là dữ liệu thực hành, không phải giao dịch khách thật.

## Quy tắc đang áp dụng

- Ngày nhận/trả là ngày lịch Việt Nam. API nhận YYYY-MM-DD, lưu mốc đầu ngày UTC+7; thời điểm nhận/trả thực tế sẽ được ghi riêng ở tuần 3–4. Số đêm lấy chênh lệch ngày, không chia chênh lệch giờ thực tế.
- Ngày trả sau ngày nhận, tối đa 365 đêm; không tạo/sửa lịch nháp trong quá khứ. Đây là giới hạn triển khai bản đầu.
- Điện thoại Việt Nam +84 hoặc 0084 được quy về 0; bỏ khoảng trắng/dấu phân cách. Giấy tờ chuẩn hóa viết hoa và bỏ khoảng trắng/dấu phân cách. Unique index chặn trùng cả khi gửi đồng thời.
- Lịch phòng xét khoảng [ngày nhận, ngày trả). Chỉ confirmed và checked_in giữ lịch. pending, cancelled, completed không giữ lịch.
- Phòng occupied/cleaning hiện tại vẫn có thể phù hợp trên lịch tương lai; giao phòng phải kiểm tra trạng thái thực tế ở tuần 3. Phòng maintenance được coi chưa có ngày mở lại, nên không đưa vào kết quả; các khoảng unavailable_periods cũng được kiểm tra giao nhau.
- Khi lưu nháp, máy chủ kiểm tra khách/phòng hoạt động, số khách nguyên dương theo sức chứa từng phòng, không trùng phòng; lấy giá từ danh mục. Không nhận giá, trạng thái confirmed hay khoản cọc do trình duyệt tự gửi.
- Nháp chụp thông tin khách và báo giá tại lần lưu. Sửa danh mục không sửa giá trong phiếu cũ; sửa lại phiếu nháp sẽ lấy báo giá mới. Giá chính thức vẫn phải chốt ở bước xác nhận tuần 3.
- Mỗi biểu mẫu sửa có version. Hai người sửa cùng bản cũ chỉ một lần lưu thành công; người còn lại nhận lỗi yêu cầu tải lại.
- Không sửa phòng đang occupied, không tự chọn occupied qua danh mục. Không đổi số/loại/ngừng phòng hoặc ngừng loại phòng còn booking confirmed/checked_in.
- Chỉ dữ liệu nháp được tạo qua giao diện tuần 2. Guard danh mục hiện tại chưa phải cơ chế đồng bộ đầy đủ với API xác nhận của tuần 3; khi thêm API đó phải dùng khóa lịch và transaction chung.

## Bằng chứng kiểm tra

- 32/32 kiểm thử tự động đạt: 15 bài nền tảng và 17 bài tuần 2. Mỗi bài nghiệp vụ chứa nhiều trường hợp hợp lệ và từ chối.
- TypeScript, build giao diện Vite và build máy chủ đều thành công.
- Các bài tuần 2 kiểm tra xác thực/CSRF/quyền, tạo/sửa danh mục, chuẩn hóa khách, trùng dữ liệu, tiền và sức chứa sai, ngày không tồn tại, năm nhuận, phân trang, tìm kiếm ký tự đặc biệt, snapshot/báo giá lại, sửa đồng thời, giáp ranh lịch, phòng bảo trì và dữ liệu ngừng dùng.
- Test chạy MongoDB replica set tạm riêng; không dùng database cục bộ của nhóm. Trạng thái confirmed/checked_in trong test do fixture tạo, không phải tuyên bố API xác nhận/check-in đã có.
- Trình duyệt: đăng nhập quản trị, chọn khách mẫu, tra 2 đêm, chọn 2 phòng, lưu phiếu và tải lại trang; thông tin và tổng 2.400.000đ được giữ nguyên. Trang chi tiết hiển thị rõ chưa giữ phòng/chưa thu cọc.
- API sức khỏe tại máy hiện tại trả `status: ok, phase: 2`.

## Phần tiếp theo

Tuần 3 đã thực hiện: [xác nhận, cọc, hủy/hoàn, check-in và gia hạn](09_WEEK3.md). Tuần 4 sẽ ghi dịch vụ thực tế, khuyến mãi, thanh toán và hóa đơn. Web đã có GitHub và demo Render + Atlas; chưa nghiệm thu trên máy của các thành viên khác.
