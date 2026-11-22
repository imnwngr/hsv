# Nguồn assets và fixture

## Logo tổ chức

PNG trong `public/logos/` được tải nguyên bản từ `https://bookclub.io.vn/logo-doan.png`, `/logo-hoi.png`, `/logo-ctut.png` và `/logo-bookclub.png`. Chủ dự án đã xác nhận quyền sử dụng trong dự án khi nâng cấp v1.1.0. Không suy diễn thành giấy phép phát hành lại logo rộng hơn phạm vi đã được xác nhận.

WebP 192px là các bản tối ưu cho hiển thị từ PNG; logo tổ chức không được vẽ lại. Giao diện HSV dùng Đoàn → Hội → CTUT và logo Hội ở nhận diện nền tảng. Logo BookClub còn trong assets lịch sử, không được component hiện tại tham chiếu.

## Font K2D

K2D của Cadson Demak, phân phối không sửa đổi theo **SIL Open Font License 1.1**. Giữ nguyên [OFL.txt](../public/fonts/OFL.txt) cùng font.

Nguồn: [Google Fonts K2D](https://fonts.google.com/specimen/K2D) và [google/fonts/ofl/k2d](https://github.com/google/fonts/tree/main/ofl/k2d). Tải từ CSS2 API chính thức và `fonts.gstatic.com` ngày 11/11/2026: K2D v13, normal weights 400/500/600/700, subset Latin và tiếng Việt, WOFF2.

Ứng dụng tự host font. Chỉ preload hai subset weight 500; các weight khác tải theo nhu cầu với `font-display: swap`. README dùng typography của GitHub; hình bìa dùng font hệ thống, không tải thêm font bên ngoài.

## Hình bìa README

[cover.svg](assets/cover.svg) và [cover-mobile.svg](assets/cover-mobile.svg) là minh họa vector cho hai loại thiệp và bảng màu hiện có. Chúng không phải screenshot hay dữ liệu của sự kiện thật. SVG không chứa script, font hoặc ảnh tải từ bên thứ ba; logo chính thức được tham chiếu riêng từ assets đã có. Hình bìa đặt trong `docs/`, không được Vite copy vào build ứng dụng.

## Fixture kiểm thử

`tests/fixtures/background-silence.mp3` có 40 MPEG audio frames synthetic, im lặng, không chứa nhạc bên thứ ba hoặc dữ liệu cá nhân. Browser E2E decode bytes thật, kiểm `currentTime`, loop và pause; không mock `HTMLMediaElement`. Storage signing/transport vẫn là mock, không chứng minh quyền RLS production, âm thanh trên thiết bị thật hoặc quyền autoplay.

Tái tạo bytes bằng Node.js:

```js
import fs from "node:fs";
const frame = Buffer.alloc(417);
frame.set([255, 251, 144, 0]);
fs.writeFileSync(
  "tests/fixtures/background-silence.mp3",
  Buffer.concat(Array.from({ length: 40 }, () => frame)),
);
```

`tests/fixtures/venue.svg` là fixture ảnh. Dữ liệu trong tests và screenshots CI thuộc môi trường kiểm thử; không dùng làm danh bạ hoặc seed production. Artifacts kiểm thử không được commit.
