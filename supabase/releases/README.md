# Phiên bản SQL HSV

Mỗi lần nâng cấp có một snapshot trước thay đổi và một bộ SQL riêng. `hsv4` là tên đợt phát hành/nhánh; không tự đổi version package frontend 3.0.0.

| Thư mục | Nội dung | Cách dùng |
|---|---|---|
| [hsv3-before-hsv4](hsv3-before-hsv4/) | Định nghĩa lấy từ backend trước nâng cấp ngày 23/11/2026 | Đối chiếu và phục hồi schema ứng dụng vào môi trường trống tương thích |
| [hsv4](hsv4/) | Ba bước nâng cấp, preflight/postflight và manifest | Chỉ chạy bước còn thiếu theo thứ tự trong manifest |
| [role-management](role-management/) | Snapshot quyền trước nâng cấp và SQL quản lý Admin/Editor | Xem `manifest.json` để biết trạng thái áp dụng SQL/Edge/Pages; không chạy lại migration |

Trạng thái áp dụng và mã migration thực tế nằm trong [manifest hsv4](hsv4/manifest.json). Không suy ra trạng thái database từ tên branch, việc pull hoặc sự tồn tại của file SQL. Không chạy cả thư mục `supabase/migrations`: lịch sử cũ có tên file khác version trên server và một số schema đã được thiết lập trước migration ledger hiện tại.

## Bản lưu trước nâng cấp

`hsv3-before-hsv4/schema.json` giữ nguyên định nghĩa function, hash PostgreSQL, cấu trúc bảng/cột/constraint/index, RLS/policies, quyền, timezone và lịch sử migration. `grants.json` bổ sung table/schema grants và event trigger của platform. `restore-app-schema.sql` khôi phục phần ứng dụng vào **schema trống**, có guard từ chối khi bảng events đã tồn tại. Kiểm thử `tests/hsv4-release.test.ts` chạy phục hồi rồi nâng cấp trong database synthetic.

Đây là backup **định nghĩa/cấu hình SQL**, không phải backup dữ liệu toàn bộ database: không chứa bản ghi Auth, khách mời, điểm danh, mật khẩu, token thực, Storage files hoặc cấu hình Auth/SMTP/Edge secrets. Supabase auth/storage schemas và roles phải có sẵn ở môi trường phục hồi. Policies Storage, event trigger và default ACL của platform được lưu metadata để đối chiếu, không tự ghi đè khi phục hồi. Muốn phục hồi cả dữ liệu cần backup dữ liệu/PITR riêng của Supabase.

## Triển khai một phiên bản

1. Đối chiếu project/ref với `.env.local` và manifest; chạy `preflight.sql`, đọc lịch sử migration. Nếu một bước đã có thì bỏ qua; trạng thái một phần hoặc khác baseline phải đối chiếu trước.
2. Lưu metadata bằng `scripts/capture-hsv-schema.sql` vào thư mục phiên bản trước; không đưa dữ liệu cá nhân hoặc secrets vào Git. Giữ snapshot cũ bất biến.
3. Chạy unit/SQL và concurrency synthetic bằng đúng file release. Kiểm hash file theo manifest (SHA-256 của UTF-8 đã chuẩn hóa CRLF thành LF).
4. Dùng Supabase `apply_migration` cho từng bước thiếu. Ghi lại version server trả về trong manifest; bản mirror trong `supabase/migrations/` dùng chính version đó. Không chạy lại SQL đã áp dụng.
5. Chạy `postflight.sql`, `node --env-file=.env.local scripts/check-hsv-backend.mjs`, đối chiếu quyền và checksum dữ liệu trước/sau. Lưu snapshot sau áp dụng trong thư mục release mới.

Nếu một bước lỗi, transaction của bước đó rollback; đọc lại ledger và schema trước khi tiếp tục. Những bước trước đã thành công vẫn giữ nguyên. Không reset database hoặc xóa migration ledger. Nếu cần trở về frontend cũ, phải đánh giá tương thích API; không chạy bản restore v3 đè lên database v4. Dùng định nghĩa đã lưu để chuẩn bị migration khôi phục có chủ đích, giữ nguyên dữ liệu đã phát sinh.

## HSV4

Thứ tự: `01-attendance.sql` → `02-attendance-duration.sql` → `03-duplicate-event.sql`. Backend kiểm tra ngày 23/11/2026 chưa có cả nền điểm danh, nên cần đủ ba bước. Sự kiện cũ giữ `attendance_config = NULL` (tắt), không tự chọn thiệp mặc định và không nhân bản dữ liệu.

Đợt này chỉ nâng cấp SQL và push nhánh `hsv4`; không deploy Pages hoặc Edge. `attendance-location` chưa triển khai, nên mở rộng link Maps rút gọn trên server vẫn chưa sẵn sàng; Plus Code, link tọa độ tường minh và chọn ghim thủ công vẫn có luồng riêng. Mật khẩu 6 ký tự là giới hạn frontend; policy Supabase Auth không được thay đổi trong đợt SQL này.
