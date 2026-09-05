# Phác thảo màn hình và luồng sử dụng

Phác thảo này xác định bố cục và dữ liệu để nhóm lập trình. Các màn hình Phase 1 đã có giao diện; ba màn hình nghiệp vụ cuối là thiết kế cho giai đoạn tiếp theo.

## 1. Đăng nhập đã hoạt động

```text
┌──────────────────────────────┬────────────────────────────────┐
│ HOTEL DESK · NHÓM 3           │ Đăng nhập                      │
│                              │ Tên đăng nhập                  │
│ Giới thiệu cổng nội bộ        │ [________________________]     │
│ và hai vai trò                │ Mật khẩu                 [mắt] │
│                              │ [________________________]     │
│                              │ [Thông báo lỗi nếu có]         │
│                              │ [Vào không gian làm việc]      │
└──────────────────────────────┴────────────────────────────────┘
```

Form có label, autocomplete, nút hiện/ẩn mật khẩu, loading và lỗi. Nút điền tài khoản mẫu chỉ có trong chế độ phát triển. Điện thoại giữ form chính và thu gọn phần giới thiệu.

## 2. Khung làm việc đã hoạt động

```text
┌─────────────────┬─────────────────────────────────────────────┐
│ HOTEL DESK      │ Vị trí hiện tại           Ngày | Đăng xuất  │
│ Tổng quan       ├─────────────────────────────────────────────┤
│ Phòng khách sạn │ Tổng quan khách sạn                         │
│                 │ Ghi chú phần đã hoạt động trong Phase 1     │
│ Giai đoạn sau   │ [Tổng phòng] [Sẵn sàng] [Khách] [Booking]    │
│ Đặt phòng       │                                             │
│ Khách hàng      │ Phòng trong khách sạn        [Xem tất cả]   │
│ Hóa đơn         │ [101]        [102]        [103]        ...  │
│ Báo cáo         │                                             │
│                 │ [Hoạt động lưu trú]      [Quyền của bạn]    │
│ Tài khoản admin │                                             │
│ Hồ sơ của tôi   │                                             │
└─────────────────┴─────────────────────────────────────────────┘
```

Các con số lấy từ MongoDB. Khách/booking chưa có dữ liệu thì hiển thị 0. Không có biểu đồ doanh thu giả. Danh mục tương lai có nhãn rõ và chưa thể thao tác.

## 3. Phòng và tài khoản đã hoạt động

Phòng: ô tìm số/tên loại → lọc tầng → số kết quả → thẻ phòng có số, loại, sức chứa, tầng, giá và trạng thái bằng chữ. Phase 1 chưa có chọn ngày hoặc nút đặt phòng.

Tài khoản: danh sách phân trang với tên, username, vai trò, trạng thái, khóa/mở staff. Nút tạo mở hộp thoại họ tên, username, vai trò, mật khẩu ban đầu. Hồ sơ cá nhân có form đổi mật khẩu và xác nhận lại.

## 4. Tạo booking dự kiến cho Phase 2 và 3

```text
[Ngày nhận] [Ngày trả] [Số khách] [Loại phòng] [Tra cứu]

Khách hàng                           Phòng khả dụng
[Tìm SĐT / giấy tờ] [Thêm khách]      [ ] 101 | Standard | 600.000
Họ tên và thông tin liên hệ          [ ] 201 | Deluxe   | 900.000

Phòng đã chọn + số khách mỗi phòng   Tóm tắt đặt phòng
                                    Ngày, số đêm, giá dự kiến
                                    Cọc dự kiến và số tiền đã nhận
                       [Lưu nháp]    [Xác nhận đặt phòng]
```

Không cho xác nhận nếu chưa chọn khách/phòng hoặc phòng vừa bị đặt. Lưu nháp không giữ lịch. Thông báo trùng lịch phải nêu phòng và yêu cầu tra lại; dữ liệu khách vừa nhập cần được giữ.

## 5. Chi tiết lưu trú dự kiến cho Phase 3 và 4

Phần đầu: mã booking, trạng thái, khách, ngày, phòng và các nút hợp lệ theo trạng thái. Các nhóm nội dung: thông tin đặt phòng, cọc/hoàn, dịch vụ, lịch sử. Check-in có bước kiểm tra phòng đã sẵn sàng. Ghi dịch vụ cần chọn đúng phòng thuộc booking, số lượng và hiển thị đơn giá máy chủ.

## 6. Thanh toán dự kiến cho Phase 4

```text
BOOKING BK...                         Khách ... / Phòng ...
Tiền phòng                            2.400.000 đ
Dịch vụ                                 100.000 đ
[Mã khuyến mãi] [Áp dụng]              -200.000 đ
TỔNG HÓA ĐƠN                          2.300.000 đ
Cọc đã thu                             -500.000 đ
CÒN PHẢI THU                          1.800.000 đ

Phương thức [Tiền mặt / Chuyển khoản / Thẻ]
Mã tham chiếu [___________________]
[Quay lại]                    [Xác nhận đã nhận tiền]
```

Sau xác nhận: cùng một kết quả hóa đơn khi gửi lặp; booking completed; phòng cleaning. Nếu dữ liệu vừa thay đổi, yêu cầu xem lại tổng mới. Nếu cần hoàn tiền, đổi nhãn thành số cần hoàn và yêu cầu quản trị xử lý.

## 7. Quy tắc giao diện chung

Tiếng Việt, số tiền định dạng VND, ngày hiển thị địa phương. Mỗi màn hình có trạng thái tải/rỗng/lỗi. Bàn phím truy cập được form và nút; hộp thoại giữ focus và đóng bằng Escape. Trạng thái luôn có chữ, không phụ thuộc màu. Khi màn hình hẹp, menu thu gọn và các thẻ xếp lại; bảng được cuộn ngang trong vùng riêng.
