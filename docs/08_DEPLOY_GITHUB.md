# Đưa Hotel Desk lên GitHub và chạy đầy đủ trên Internet

Kiến trúc triển khai dùng một Render Web Service để phục vụ cả React và Express, MongoDB Atlas để lưu dữ liệu. GitHub lưu mã nguồn và kích hoạt triển khai khi nhánh main thay đổi. GitHub Pages không được dùng vì không chạy API Node hoặc MongoDB.

## Những gì đã chuẩn bị trong mã nguồn

- `render.yaml` khai báo dịch vụ Node tại khu vực Singapore, lệnh build/start, health check và các biến cấu hình.
- Production tự dùng URL HTTPS do Render cấp, lắng nghe `0.0.0.0` và tin cậy đúng một reverse proxy.
- `SESSION_SECRET`, URI MongoDB và mật khẩu quản trị đầu tiên chỉ nằm trong biến bí mật của Render.
- Khi database hoàn toàn chưa có user, lần chạy production đầu tiên tạo một quản trị viên từ `BOOTSTRAP_ADMIN_*`. Các lần chạy sau không tạo lại và không đổi mật khẩu.
- Nếu database đã có bất kỳ tài khoản nào, biến bootstrap không can thiệp. Quản trị viên tạo tài khoản lễ tân từ web.
- `.env`, `.local`, `node_modules` và `dist` bị Git bỏ qua.

## 1. Tạo MongoDB Atlas

1. Đăng nhập MongoDB Atlas, tạo project và một cluster Shared/Free tại AWS Singapore nếu lựa chọn đó có sẵn.
2. Tạo **database user** riêng cho web, cấp quyền đọc/ghi database `hotel_group3`. Database user khác tài khoản đăng nhập Atlas.
3. Tạo mật khẩu dài, ngẫu nhiên. Nếu mật khẩu có ký tự đặc biệt trong URI, dùng chuỗi kết nối Atlas tạo sẵn hoặc URL-encode đúng ký tự.
4. Lấy URI trong **Connect → Drivers**, thêm tên database trước dấu `?`, dạng:

   `mongodb+srv://hotel_app:<PASSWORD>@<CLUSTER>/hotel_group3?retryWrites=true&w=majority`

5. Chưa đưa URI vào Git, file hay ảnh chụp. Giá trị này sẽ nhập vào biến `MONGODB_URI` của Render.

Atlas chỉ nhận kết nối từ IP/CIDR trong IP Access List. Sau khi tạo dịch vụ Render, mở **Connect → Outbound** của dịch vụ, sao chép toàn bộ outbound CIDR và thêm chúng vào **Atlas → Network Access**. Render có thể dùng bất kỳ IP nào trong các dải đó, vì vậy cần thêm đủ các dải của khu vực dịch vụ. Tránh dùng `0.0.0.0/0` nếu có thể cấu hình đúng outbound CIDR.

## 2. Triển khai Render từ GitHub

1. Đăng nhập Render bằng GitHub và cho Render đọc repository `Sang6215/hotel-management-group3`.
2. Mở **New → Blueprint**, chọn repository. Render tự đọc `render.yaml`.
3. Khi được hỏi biến bí mật:
   - `MONGODB_URI`: URI Atlas có database `hotel_group3`.
   - `BOOTSTRAP_ADMIN_PASSWORD`: mật khẩu quản trị đầu tiên, từ 12 đến 72 byte; không dùng mật khẩu demo cục bộ.
4. Tạo Blueprint. `SESSION_SECRET` được Render sinh ngẫu nhiên; không sửa thành mật khẩu đăng nhập.
5. Mở dịch vụ vừa tạo, lấy các outbound CIDR và thêm vào Atlas như mục 1. Nếu lần deploy đầu chưa kết nối database, bấm **Manual Deploy → Deploy latest commit** sau khi Atlas lưu IP Access List.
6. Khi health check đạt, mở URL `https://hotel-desk-group3...onrender.com`, đăng nhập bằng username `admin` và mật khẩu bootstrap đã nhập.
7. Từ **Tài khoản nội bộ**, tạo tài khoản lễ tân và gửi mật khẩu riêng cho người dùng. Sau đó nên đổi mật khẩu quản trị trong **Tài khoản của tôi**.

Render tự cấp `RENDER_EXTERNAL_URL`; web dùng URL đó để kiểm tra Origin. Khi gắn tên miền riêng, đặt thêm `APP_ORIGIN=https://ten-mien-cua-ban` rồi redeploy. Không thêm dấu đường dẫn sau tên miền.

## 3. Dữ liệu và phạm vi chức năng

Database online mới chỉ có quản trị viên ban đầu. Quản trị viên thêm loại phòng, phòng và dịch vụ trên web; quản trị hoặc lễ tân thêm khách và tạo phiếu đặt phòng nháp. Dữ liệu cục bộ trong `.local/mongo` không tự tải lên Atlas.

Bản online chạy toàn bộ chức năng **đã triển khai đến tuần 2**: đăng nhập/phân quyền, tài khoản, phòng/loại phòng, khách hàng, dịch vụ, tra phòng theo ngày và phiếu nháp nhiều phòng. Các nghiệp vụ tuần 3–5 như xác nhận giữ phòng, cọc, check-in, thanh toán, hóa đơn và báo cáo chưa có trong mã nguồn, nên việc deploy không làm chúng xuất hiện.

Ở gói Render miễn phí, dịch vụ có thể ngủ khi không dùng; lần mở sau một khoảng nghỉ có thể cần chờ khởi động. MongoDB Atlas giữ dữ liệu độc lập với vòng đời máy chủ Render.

## 4. Cập nhật sau này

Mỗi lần đẩy commit mới lên nhánh `main`, Render sẽ build và triển khai lại. MongoDB Atlas vẫn giữ dữ liệu. Không đổi hoặc xóa `SESSION_SECRET` tùy tiện vì các phiên đăng nhập hiện tại sẽ hết hiệu lực; việc đổi bí mật không xóa dữ liệu nghiệp vụ.

Trước khi đẩy thay đổi, chạy `pnpm typecheck`, `pnpm test` và `pnpm build`. Không commit `.env`, ảnh chứa URI, file `.local` hoặc mật khẩu.
