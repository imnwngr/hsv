<p align="center">
  <img src="public/logos/logo-hoi-192.webp" width="72" height="72" alt="Hội Sinh viên Việt Nam">
</p>

<h1 align="center">Sự kiện Hội Sinh viên CTUT</h1>

<p align="center">
  Quản lý sự kiện, gửi thiệp riêng cho từng người nhận<br>
  và điểm danh ngay trong thiệp nhóm.
</p>

<p align="center">
  <a href="https://imnwngr.github.io/hsv/">Mở ứng dụng</a> ·
  <a href="https://imnwngr.github.io/hsv/admin/">Trang quản trị</a> ·
  <a href="https://github.com/imnwngr/hsv/releases/tag/v4.0.0">Phiên bản 4.0.0</a> ·
  <a href="docs/OPERATIONS.md">Vận hành</a>
</p>

<p align="center">
  <a href="https://github.com/imnwngr/hsv/actions/workflows/deploy.yml?query=branch%3Amain"><img src="https://github.com/imnwngr/hsv/actions/workflows/deploy.yml/badge.svg?branch=main" alt="Kết quả CI trên main"></a>
</p>

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/cover-mobile.svg">
  <img src="docs/assets/cover.svg" width="1200" alt="Thiệp mời và thiệp chúc với chất liệu giấy và màu riêng của sự kiện.">
</picture>

Ứng dụng dành cho Hội Sinh viên Trường Đại học Kỹ thuật – Công nghệ Cần Thơ. Ban tổ chức quản lý nội dung, khách mời và kết quả điểm danh; người nhận mở thiệp bằng liên kết riêng, không cần tài khoản sinh viên.

## Thiệp và sự kiện

| Chức năng | Cách sử dụng |
| --- | --- |
| Thiệp mời | Có thời gian, địa điểm, lời mời cá nhân hóa và điểm danh tùy chọn cho thiệp nhóm. |
| Thiệp chúc | Gửi lời chúc đến cá nhân hoặc đơn vị; không yêu cầu lịch, địa điểm hoặc điểm danh. |
| Danh bạ khách mời | Quản lý cá nhân/nhóm, thứ tự và primary alias. Thiệp giữ bản chụp thông tin người nhận tại lúc lưu. |
| Giao diện riêng | Chọn màu có sẵn hoặc tùy chỉnh; giữ nền giấy, font K2D, hiệu ứng mở thiệp và nhạc nền. |
| Thiệp mở từ trang chủ | Chọn một người hoặc đơn vị trong editor để sự kiện công khai mở thẳng thiệp của họ. Chưa chọn hoặc thiệp không còn hợp lệ thì hiện giới thiệu sự kiện. |

Liên kết thiệp dùng `/hsv/thiep-moi/:eventCode/:guestAlias` hoặc `/hsv/thiep-chuc/:eventCode/:guestAlias`. Resolver kiểm tra loại thiệp, primary alias và trạng thái công khai trước khi trả nội dung.

Trong trang quản trị, công tắc công khai lưu ngay và khôi phục trạng thái nếu lỗi. Editor có sáu mục điều hướng bám theo khi cuộn; nội dung và cấu hình vẫn lưu bằng nút **Lưu**, kèm cảnh báo khi rời trang với thay đổi chưa lưu.

Nhân bản giữ nội dung, khách mời, snapshot và media, tạo sự kiện mới ở trạng thái chưa công khai, không sao chép lượt điểm danh. Mã tự tăng theo `su-kien-copy`, `su-kien-copy-2`; nhân bản từ `su-kien-copy` tạo `su-kien-copy-copy`. Danh sách xếp theo thời gian bắt đầu, bản sao cùng giờ nằm ngay trên nguồn. Tìm kiếm không dấu và bộ lọc được giữ trong URL.

## Điểm danh trong thiệp nhóm

Điểm danh chỉ hoạt động với sự kiện **Thiệp mời đã công khai**, đã bật tính năng, thiệp thuộc đối tượng nhóm và đang trong đợt mở theo giờ máy chủ. Thiệp cá nhân và Thiệp chúc không được ghi nhận; backend kiểm tra các điều kiện này.

| Cấu hình mới | Mặc định | Có thể chỉnh |
| --- | --- | --- |
| Bật điểm danh | Tắt | Bật sau khi xác nhận ghim và lịch hợp lệ |
| Bán kính | 50 m | 10 đến 1.000 m |
| Hai đợt | 10 phút mỗi đợt | Thời lượng chung từ 1 đến 60 phút, giờ mở riêng từng đợt |
| Thay QR | Mỗi 5 giây | 3 đến 60 giây |
| Múi giờ | Việt Nam, UTC+7 | Ngày lấy theo sự kiện, nhập giờ trong editor |

Với sự kiện 08:00–10:00, mặc định đợt 1 là **08:55–09:05**, đợt 2 là **09:50–10:00**. Hai đợt phải theo thứ tự, không chồng nhau và nằm trong thời gian sự kiện. Cấu hình đã lưu được giữ; dữ liệu cũ thiếu trường thời lượng tiếp tục dùng 15 phút mỗi đợt.

Ban tổ chức chọn ghim trên bản đồ hoặc nhập Plus Code Google Maps, kiểm tra bán kính rồi xác nhận. Tọa độ điểm danh lưu riêng với địa điểm hiển thị trên thiệp. Trang trình chiếu riêng tự cập nhật QR theo máy chủ, không tiếp tục hiện mã hết hạn khi mất kết nối.

Sinh viên nhập họ tên/MSSV, lấy vị trí mới rồi quét QR trong popup. Website chỉ xin quyền sau thao tác bắt đầu. Kết quả hiển thị thời điểm máy chủ ghi nhận; người dùng có thể sửa họ tên/MSSV nhiều lần trên cùng bản ghi, giữ nguyên các lượt đã hoàn thành. Quản trị xem kết quả, lịch sử sửa và xuất CSV để nhập Google Sheets hoặc Excel.

Liên kết điểm danh gắn với hồ sơ trình duyệt và khóa xác thực. Đây không phải xác minh duy nhất điện thoại hay danh tính: website không thể chặn chắc chắn mọi chế độ ẩn danh, GPS có thể sai hoặc bị giả, và xóa dữ liệu trình duyệt có thể làm mất khả năng điểm danh đợt sau. Xem [quy tắc thời gian, vị trí và giới hạn](docs/OPERATIONS.md#diem-danh).

## Tài khoản và quyền

| Vai trò | Quyền |
| --- | --- |
| Admin | Quản lý nội dung và tài khoản; thêm Admin/Editor, nâng Editor thành Admin, hạ hoặc thu hồi Admin khác. |
| Editor | Quản lý sự kiện, thiệp, danh bạ và điểm danh; chỉ đọc danh sách vai trò, không đổi quyền hoặc tự thu hồi. |

Hệ thống giữ ít nhất một Admin hoạt động, kể cả khi nhiều người thay quyền đồng thời. Quyền được kiểm tra ở Edge Function và database, không chỉ qua việc ẩn nút.

Khi thêm tài khoản, Admin chọn vai trò và nhập email. Tài khoản có sẵn được cấp quyền trực tiếp; email mới nhận lời mời khi máy chủ đã bật gửi email. Luồng khôi phục giữ vai trò đã chọn và không tự gửi lại lời mời sau lỗi mạng.

## Chạy local

Cần **Node.js 24**, npm và môi trường Supabase đã cấu hình schema phù hợp. Dùng project test riêng khi thử thao tác ghi.

```sh
git clone https://github.com/imnwngr/hsv.git
cd hsv
npm ci
```

Sao chép `.env.example` thành `.env.local`, điền cấu hình môi trường được phép dùng:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

`VITE_*` được đưa vào frontend; không đặt service-role key, mật khẩu hoặc token quản trị ở đây. `.env.local` được Git ignore. Hai biến Google Maps trong `.env.example` là tùy chọn; xem [cấu hình và giới hạn khóa](docs/OPERATIONS.md#cau-hinh).

```sh
npm run dev
```

Mở **http://localhost:5173/hsv/**, đăng nhập tại **http://localhost:5173/hsv/admin/login**. Nếu cổng bận, dùng URL Vite in ra và giữ `/hsv/`.

Thiếu hai biến Supabase, trang đăng nhập sẽ báo chưa cấu hình dịch vụ. Với project mới, làm theo [hướng dẫn chuẩn bị môi trường](docs/OPERATIONS.md#moi-truong-moi); chạy Vite không tự tạo schema hay seed dữ liệu. Luồng quản lý tài khoản production giới hạn origin Pages, nên kiểm thử luồng này từ localhost cần sandbox tương ứng.

## Kiểm thử và build

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

`npm run test:e2e` chạy bộ browser đầy đủ với backend mock. `npm run test:e2e:visual` chạy cùng bộ test và bật thêm ảnh ma trận giao diện. Log, screenshot và trace nằm trong các thư mục ignored như `.local/`, `test-results/` và `playwright-report/`.

[CI gần nhất của phần chức năng 4.0.0](https://github.com/imnwngr/hsv/actions/runs/45146853915) đạt 190 unit/SQL/Edge, 45 browser trong lượt chạy tập trung, cùng kiểm thử native Auth/Edge/PostgreSQL/SMTP trên môi trường riêng; 9 ca browser được bỏ qua để không lặp ma trận. Typecheck, lint, build và deploy đều thành công. Lượt tập trung không thay thế một lần chạy toàn bộ browser suite. Phạm vi và giới hạn có trong [release notes](docs/releases/v4.0.0.md).

## Source và triển khai

```text
src/
  components/        Thành phần giao diện dùng chung
  features/          Sự kiện, khách mời, Auth và điểm danh
  pages/             Trang công khai và quản trị
  styles/            Bố cục, vật liệu, màu và chuyển động
supabase/
  functions/         Edge Functions
  migrations/        Bản ghi SQL theo lịch sử triển khai
  releases/          Snapshot, SQL nâng cấp và manifest trạng thái
tests/               Unit, SQL, Edge và Playwright
scripts/             Kiểm tra backend, sandbox và concurrency
docs/                Vận hành, assets và release notes
```

Frontend dùng React 19, TypeScript, Vite 8, TanStack Query và Tiptap. Supabase cung cấp PostgreSQL, Auth, Storage và Edge Functions. Các trang quản trị, bản đồ và scanner được tải khi cần; font K2D tự host có tiếng Việt.

GitHub Pages phục vụ ứng dụng tại **https://imnwngr.github.io/hsv/**. Workflow deploy từ `main` sau các bước kiểm tra và kiểm tra capability backend; biến gate hiện có vẫn mang tên `HSV_V3_PRODUCTION_READY`.

**Pull source hoặc tạo release không tự cập nhật database.** SQL điểm danh, thời lượng, nhân bản và quản lý Admin/Editor đã áp dụng trên backend hiện tại. Đối chiếu [manifest và snapshot SQL](supabase/releases/README.md) trước mọi lần nâng cấp; không chạy lại toàn bộ thư mục migrations. Snapshot trong Git lưu định nghĩa/cấu hình, không chứa bản sao dữ liệu người dùng hay secrets.

Edge `manage-editors` đã triển khai ở v8. Edge `attendance-location` để mở rộng link Maps rút gọn chưa triển khai; Plus Code, tọa độ tường minh và chọn ghim thủ công có luồng riêng. Bucket lịch sử và các RPC capability giữ nguyên tên để tương thích.

## Tài liệu

| Nội dung | Đường dẫn |
| --- | --- |
| Thay đổi và kiểm chứng phiên bản 4.0.0 | [Release notes 4.0.0](docs/releases/v4.0.0.md) |
| Auth, database, điểm danh và quy trình triển khai | [Hướng dẫn vận hành](docs/OPERATIONS.md) |
| Snapshot trước/sau và trạng thái từng migration | [Phiên bản SQL](supabase/releases/README.md) |
| Nhận diện, bố cục, tương tác và accessibility | [Hệ thiết kế](DESIGN.md) |
| Nguồn logo, font và dữ liệu kiểm thử | [Nguồn assets](docs/ASSETS.md) |
| Mốc lịch sử trước điểm danh và quản lý Admin | [Release notes 3.0.0](docs/releases/v3.0.0.md) |
