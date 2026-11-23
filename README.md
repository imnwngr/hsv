<p align="center">
  <img src="public/logos/logo-hoi-192.webp" width="72" height="72" alt="Hội Sinh viên Việt Nam">
</p>

<h1 align="center">Sự kiện Hội Sinh viên CTUT</h1>

<p align="center">
  Nền tảng quản lý và chia sẻ sự kiện của Hội Sinh viên CTUT.<br>
  Từ nội dung sự kiện đến lời gửi dành riêng cho từng người nhận.
</p>

<p align="center">
  <strong>3.0.0</strong> &nbsp; · &nbsp;
  <a href="#hai-loai-thiep">Hai loại thiệp</a> &nbsp; · &nbsp;
  <a href="#chay-local">Chạy local</a> &nbsp; · &nbsp;
  <a href="docs/releases/v3.0.0.md">Release&nbsp;notes</a>
</p>

<p align="center">
  <a href="https://github.com/imnwngr/hsv/actions/workflows/deploy.yml?query=branch%3Amain"><img src="https://github.com/imnwngr/hsv/actions/workflows/deploy.yml/badge.svg?branch=main" alt="Kết quả kiểm thử CI trên main"></a>
</p>

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/cover-mobile.svg">
  <img src="docs/assets/cover.svg" width="1200" alt="Hai loại thiệp với chất liệu giấy, xanh Hội và đỏ son. Mỗi sự kiện, một dấu ấn.">
</picture>

> [!NOTE]
> Source 3.0.0 đã vào `main` và vượt qua CI. **Frontend Pages chưa phát hành v3** tại lần đối chiếu 20/11/2026; badge xanh thể hiện kiểm thử, không xác nhận deploy. Theo dõi [trạng thái và điều kiện phát hành](docs/OPERATIONS.md#trang-thai).

<a id="hai-loai-thiep"></a>
## Hai loại thiệp, cùng một nơi quản lý

| Thiệp mời | Thiệp chúc |
| :--- | :--- |
| **Trân trọng kính mời** | **Trân trọng chúc mừng** |
| Dành cho lời mời tham dự sự kiện. | Dành cho lời chúc gửi đến cá nhân hoặc tập thể. |
| Có ngày, giờ bắt đầu/kết thúc và địa điểm. | Không yêu cầu hoặc hiển thị lịch, địa điểm, bản đồ. |

Cả hai giữ lời xưng hô, tên, chức vụ hoặc mô tả của người nhận. Mô tả sự kiện, quote, chương trình và phần kết dùng chung cấu trúc. Khi đổi loại trong editor, dữ liệu đã nhập được giữ để có thể đổi lại.

### Màu riêng cho mỗi sự kiện

Chọn Xanh Hội, Lá xanh, Đỏ son, Tím mực, Hổ phách hoặc một màu tùy chỉnh. Xem trước trên chất liệu giấy và dệt, khôi phục mặc định khi cần, rồi lưu cùng sự kiện. Màu áp dụng cho các thiệp thuộc sự kiện đó; thông tin người nhận vẫn giữ theo snapshot.

### Nội dung dành cho từng người nhận

Tạo sự kiện → chọn loại và màu → chọn khách mời → lưu → công khai ở danh sách quản trị → sao chép link riêng. Danh bạ hỗ trợ cá nhân/nhóm, sắp xếp và primary alias. Người nhận mở thiệp với hiệu ứng giấy, nội dung theo nhịp cuộn và điều khiển nhạc Liquid Glass; chế độ giảm chuyển động vẫn giữ nội dung đọc được.

### Quản trị có phân quyền

Editor quản lý nội dung; Admin quản lý thêm quyền Editor. Admin nhập email trong một luồng: tài khoản đã có được cấp quyền, email mới đi qua lời mời khi server cho phép. Giao diện phân biệt chờ nhận lời mời, lỗi một phần và cần khôi phục. Quyền được kiểm tra tại server/RLS; retry không tự gửi lại email.

### Điểm danh và điều hướng sự kiện

Phần mở rộng từ `hsv4` đã được gộp vào `main` qua PR #2; nhánh cũ đã xóa. Có công tắc công khai lưu ngay tại danh sách quản trị, sáu mục điều hướng bám theo editor và thiệp mặc định cho mỗi sự kiện. Điểm danh dành cho thiệp nhóm của Thiệp mời: hai đợt theo lịch, ghim/bán kính xác nhận, QR động, kết quả và sửa thông tin ngay trong thiệp. Quản trị xem lịch sử sửa và xuất CSV để nhập Google Sheets/Excel. Có nhân bản sự kiện, Plus Code, thời lượng mặc định 10 phút/đợt và bán kính mặc định 50 m; danh sách quản trị gọn hơn với tìm kiếm không dấu và bộ lọc giữ trong URL.

**SQL đã áp dụng ngày 23/11/2026:** đủ ba migration nền điểm danh, thời lượng và nhân bản trên backend đang kết nối. Snapshot trước/sau, hash và mã migration nằm trong [phiên bản SQL](supabase/releases/README.md). Không chạy lại SQL khi pull. Pages theo workflow `main`; Edge `attendance-location` chưa deploy. Không có dependency mới. Xem [trạng thái và kiểm chứng](docs/OPERATIONS.md#editor-polish).

[Release v3.0.0](https://github.com/imnwngr/hsv/releases/tag/v3.0.0) ghim mốc merge PR #1 tại `5d66357`, không bao gồm phần mở rộng HSV4. Chưa tạo release v4.0.0.

<a id="chay-local"></a>
## Chạy local

Cần **Node.js 24**, npm và một môi trường Supabase đã có schema v3, được phép sử dụng. Kho này không tự tạo database hoặc seed production khi khởi động.

```sh
git clone https://github.com/imnwngr/hsv.git
cd hsv
npm ci
```

Sao chép `.env.example` thành `.env.local`, điền hai giá trị của môi trường được cấp:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Các biến `VITE_*` được đưa vào frontend. Chỉ dùng publishable key; không đặt service-role key, mật khẩu hoặc token quản trị vào đây. `.env.local` đã được Git ignore. Google Maps API key/Map ID là tùy chọn; cấu hình và hạn chế khóa xem [vận hành](docs/OPERATIONS.md#cau-hinh).

```sh
npm run dev
```

Mở **http://localhost:5173/hsv/**, đăng nhập quản trị tại **http://localhost:5173/hsv/admin/login**. Nếu cổng đã bận, dùng URL Vite in ra và giữ phần `/hsv/`. Với một Supabase project trống, đọc [chuẩn bị môi trường mới](docs/OPERATIONS.md#moi-truong-moi) trước.

## Kiểm thử và build

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

CI trên `main` đã xác nhận **139 unit tests**, **171 browser tests** và **12 nhóm native account checks**; 35 browser checks không chạy lặp trong project mobile. Browser suite dùng API/Storage mock; native checks chạy Supabase và Mailpit trên runner tách biệt. Xem [phạm vi bằng chứng](docs/releases/v3.0.0.md#kiem-thu) để phân biệt với production.

<details>
<summary><strong>Cấu trúc source và công nghệ</strong></summary>

```text
src/                 React 19, TypeScript, Router, TanStack Query
  components/        Thành phần giao diện dùng chung
  features/          API sự kiện, danh bạ, thiệp và Auth
  pages/             Trang công khai và quản trị
  styles/            Typography, vật liệu, màu, chuyển động
supabase/            SQL, migrations lịch sử và Edge Function
tests/               Unit, SQL và browser tests
scripts/             Kiểm tra backend, native sandbox và QA
docs/                Vận hành, nguồn assets, release notes
```

Vite 8 và Tailwind CSS 4 xây dựng frontend. Supabase cung cấp PostgreSQL, Auth, Storage và Edge Function `manage-editors`. Rich text dùng Tiptap; các trang quản trị được tải theo route. Font K2D được tự host, có subset tiếng Việt.

</details>

## Phát hành

Địa chỉ Pages: **https://imnwngr.github.io/hsv/**. Workflow chỉ deploy từ `main` tại repo này khi verify/native checks PASS, `HSV_V3_PRODUCTION_READY=true` và backend capability phù hợp. Không dùng việc merge hoặc badge CI xanh thay cho kiểm tra deployment.

Database không được tự migrate từ frontend. Hai migration v3 đã có trong history production; không chạy lại theo tên file. Đường dẫn `/bookclub/` hiện không có bridge chuyển hướng đã kiểm chứng. Quy trình phát hành, callback và containment nằm trong [hướng dẫn vận hành](docs/OPERATIONS.md).

## Tài liệu

| Cần tìm | Đọc tại |
| :--- | :--- |
| Thiết kế, hai loại thiệp, màu và chuyển động | [Hệ thiết kế](DESIGN.md) |
| Schema hiện tại, môi trường, Auth, migration và Pages | [Vận hành](docs/OPERATIONS.md) |
| Thay đổi và giới hạn của bản 3.0.0 | [Release notes](docs/releases/v3.0.0.md) |
| Nguồn logo, font và dữ liệu kiểm thử | [Nguồn assets](docs/ASSETS.md) |

Các kế hoạch và biên bản nghiệm thu đã hoàn tất được giữ trong lịch sử Git, không tiếp tục nằm ở cây source hiện hành. Log, screenshot kiểm thử và backup không được commit.

<p align="center">
  <img src="public/logos/logo-doan-192.webp" width="48" height="48" alt="Đoàn Thanh niên">
  &nbsp;&nbsp;
  <img src="public/logos/logo-hoi-192.webp" width="48" height="48" alt="Hội Sinh viên">
  &nbsp;&nbsp;
  <img src="public/logos/logo-ctut-192.webp" width="48" height="48" alt="Trường Đại học Kỹ thuật – Công nghệ Cần Thơ">
</p>
