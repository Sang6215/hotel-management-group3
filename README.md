# Hotel Desk của Nhóm 3

Hiện đã triển khai tuần 4 (Phase 4): ghi dịch vụ theo phòng, khuyến mãi, xem trước chi phí, trả phòng/thu hoặc hoàn tiền, hóa đơn nội bộ có bản in và điều chỉnh có quyền quản trị. Giữ nguyên các chức năng tuần 1–3, sổ thu/hoàn, lịch sử thao tác và cơ chế chống gửi lặp.

Hướng dẫn thao tác và nghiệm thu: [Tuần 4](docs/10_WEEK4.md), [Tuần 3](docs/09_WEEK3.md), [Tuần 2](docs/07_WEEK2.md).

Kho mã và hướng dẫn chạy online: [triển khai GitHub + Render + MongoDB Atlas](docs/08_DEPLOY_GITHUB.md).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FSang6215%2Fhotel-management-group3)

Nguồn nghiệp vụ: [bản Word hiện tại](<D:/Học tập/noSql/Group3_Quản lý khách sạn_Phase1.docx>) và [kế hoạch sáu tuần](../KE_HOACH_PHAT_TRIEN_WEB.md).

## Chạy ngay trên máy hiện tại

Trong PowerShell, mở thư mục `hotel-web` rồi chạy:

```powershell
.\Start-Hotel.ps1
```

Nếu chính sách PowerShell không cho chạy tệp, chỉ cho phép trong tiến trình khởi động này:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Hotel.ps1
```

Mở [web cục bộ](http://127.0.0.1:5173). Giữ cửa sổ chạy dự án mở; nhấn Ctrl+C để dừng. Nếu cổng đã được dùng bởi phiên chạy trước, mở trang đang chạy hoặc dừng đúng phiên cũ trước khi chạy lại.

| Vai trò mẫu | Tên đăng nhập | Mật khẩu ban đầu |
|---|---|---|
| Quản trị viên | admin | AdminDemo2026! |
| Lễ tân | letan | LetanDemo2026! |

Các tài khoản trên chỉ dành cho dữ liệu thực hành cục bộ. Trang đăng nhập có nút điền sẵn ở chế độ phát triển; bản build không chứa các nút này. Nếu đã đổi mật khẩu, lần khởi động sau giữ mật khẩu mới, không tự khôi phục mật khẩu mẫu.

## Chạy trên máy của thành viên khác

Cài Node.js LTS từ 22.12 trở lên và pnpm 10.15.1, sao chép mã nguồn cùng `pnpm-lock.yaml`, rồi chạy:

```text
pnpm install --frozen-lockfile
pnpm dev
```

Không cần cài Docker hoặc MongoDB service để thực hành. Khi không cấu hình MONGODB_URI, trình chạy tải MongoDB 8.0.15 từ máy chủ chính thức của MongoDB, khởi động một replica set và lưu dữ liệu tại `.local/mongo`. Lần đầu trên Windows tải khoảng 755 MB và cần Internet; các lần sau dùng lại binary. Thư viện có tên mongodb-memory-server nhưng cấu hình phát triển này dùng storage engine WiredTiger và đường dẫn dữ liệu cố định, nên dữ liệu được lưu trên đĩa.

Không sao chép node_modules hoặc `.local` giữa các máy. Mỗi người có dữ liệu cục bộ riêng. Repository chung: https://github.com/Sang6215/hotel-management-group3 (private, nhánh main). Hướng dẫn này đã chạy trên máy hiện tại; các máy khác cần thực hiện bước nghiệm thu ở cuối tài liệu.

Nếu nhóm đã có replica set khác, sao chép `.env.example` thành `.env` và điền MONGODB_URI. Khi dùng URI riêng, `pnpm dev` không tự chèn tài khoản mẫu; chỉ chạy `pnpm db:seed` nếu database đó được nhóm dành riêng cho thực hành. Seed tạo tài khoản còn thiếu, chỉ tạo danh mục và khách mẫu khi collection tương ứng rỗng; không ghi đè mật khẩu hoặc tái tạo số phòng/mã danh mục cũ sau khi đã đổi tên.

## Phần đã hoạt động

- Đăng nhập, đăng xuất và phục hồi phiên khi tải lại trang.
- Hai vai trò admin/staff, kiểm tra tại API.
- Cookie phiên HttpOnly và SameSite Strict, CSRF, giới hạn đăng nhập sai, mật khẩu băm bcrypt.
- Đổi mật khẩu; phiên khác hết hiệu lực. Khóa/mở tài khoản lễ tân; phiên cũ không được dùng lại.
- Quản trị tạo tài khoản, xem danh sách có phân trang; không cho khóa tài khoản quản trị trong bản này.
- Tổng quan đọc số liệu từ database; quản lý phòng/loại phòng, giá, sức chứa, tiện ích và trạng thái; tìm kiếm, lọc và phân trang.
- Tám collection nghiệp vụ cùng schema/index ban đầu, thêm sessions cho phiên đăng nhập.
- Quản lý danh mục dịch vụ, gồm 6 dịch vụ mẫu. Danh mục ngừng sử dụng vẫn được giữ lại.
- Thêm/sửa/tìm khách hàng, chuẩn hóa và chống trùng điện thoại/giấy tờ, xem lịch sử phiếu đặt. Có 3 khách mẫu khi database chưa có khách.
- Tra phòng theo khoảng ngày; loại lịch confirmed/checked_in bị trùng, phòng bảo trì, phòng/loại phòng ngừng hoạt động. Ngày trả của lượt trước bằng ngày nhận của lượt sau được phép trên lịch.
- Tạo/sửa phiếu nháp nhiều phòng, kiểm tra sức chứa từng phòng, tính giá máy chủ, chụp thông tin khách và giá dự kiến, lưu lịch sử chỉnh sửa.
- Biểu mẫu sửa gửi version; dữ liệu cũ bị từ chối để tránh ghi đè thay đổi của người khác.

Trang Phòng khách sạn thể hiện trạng thái hiện tại; phần Tạo đặt phòng tra lịch theo ngày. Phiếu pending không giữ lịch. Chi tiết phiếu có xác nhận/cọc, nhận phòng, hủy/hoàn, đổi lịch, gia hạn, dịch vụ và trả phòng. Trả phòng đồng thời lập hóa đơn, ghi tiền và chuyển mọi phòng sang đang dọn. Quản trị xác nhận dọn xong trước khi giao phòng tiếp. Báo cáo thống kê thuộc tuần 5, chưa triển khai.

## Cấu trúc dự án

| Thư mục | Nội dung |
|---|---|
| client | React, giao diện và gọi API |
| server | Express, xác thực, schema MongoDB và dữ liệu mẫu |
| shared | Kiểu dữ liệu dùng chung |
| scripts | Chạy cục bộ, seed, kiểm tra transaction |
| tests | Kiểm thử tích hợp với replica set riêng |
| docs | Nghiệp vụ, dữ liệu, API, phác thảo và biên bản kiểm thử |
| .local | Dữ liệu và binary cục bộ; không đưa lên Git |
| dist | Bản build; tạo lại bằng lệnh build |

## Lệnh kiểm tra

```text
pnpm typecheck
pnpm test
pnpm build
pnpm db:check
```

Test tự khởi động replica set tạm riêng và tự dọn dữ liệu do test tạo; không dùng URI database phát triển. `db:check` cần MongoDB đã chạy, xác nhận replica set, commit và rollback bằng bản ghi chẩn đoán riêng; bản ghi được dọn ngay sau kiểm tra. Collection kỹ thuật rỗng `_phase1_probe` có thể còn lại.

Kết quả nền tảng ở [biên bản Phase 1](docs/05_VERIFICATION.md); bộ kiểm tra hiện có 78 bài. Phạm vi và kết quả mới nhất ở [nghiệm thu tuần 4](docs/10_WEEK4.md).

## Bản build và triển khai sau này

`pnpm build` tạo `dist/client` và `dist/server`. `pnpm start` phục vụ cả giao diện đã build lẫn API; cần MongoDB riêng đang chạy. Lệnh này không tự tải MongoDB hay dữ liệu mẫu. Để triển khai thật, đặt NODE_ENV=production, MONGODB_URI và SESSION_SECRET bí mật ít nhất 32 ký tự; đặt HTTPS APP_ORIGIN hoặc dùng RENDER_EXTERNAL_URL do Render cấp. TRUST_PROXY chỉ đặt 1 nếu thực tế có đúng một proxy tin cậy. Database trống cần BOOTSTRAP_ADMIN_PASSWORD ở lần chạy đầu. Các nút đăng nhập mẫu không xuất hiện trong bản build.

Chế độ cục bộ chỉ lắng nghe 127.0.0.1. MongoDB đi kèm không bật xác thực vì chỉ dùng trên máy phát triển. Bản demo online dùng Render + Atlas tại https://hotel-desk-group3.onrender.com; database online độc lập với `.local`. Đừng đổi HOST cục bộ sang địa chỉ công khai rồi dùng nguyên tài khoản mẫu. Font có bản dự phòng hệ thống khi không tải được Google Fonts.

## Tài liệu Phase 1

1. [Phạm vi và quy tắc nghiệp vụ](docs/01_SCOPE_AND_RULES.md).
2. [Mô hình dữ liệu và quyết định kỹ thuật](docs/02_DATA_MODEL.md).
3. [Hợp đồng API và quyền](docs/03_API_CONTRACT.md).
4. [Phác thảo màn hình và luồng sử dụng](docs/04_WIREFRAMES.md).
5. [Kiểm thử và nghiệm thu](docs/05_VERIFICATION.md).
6. [Việc tiếp theo và phân công](docs/06_NEXT_STEPS.md).

## Nghiệm thu trên máy khác

Khởi động theo hướng dẫn → đăng nhập admin → xem 12 phòng → tạo một tài khoản lễ tân thử → đăng nhập tài khoản đó → xác nhận không có màn quản trị → khóa tài khoản từ admin → xác nhận phiên lễ tân hết hiệu lực → khởi động lại để kiểm tra dữ liệu còn. Không cần sửa Word để chạy các bước này.
