# Sự kiện Hội Sinh viên CTUT · Thiết kế 3.0.0

Ngày 20/11/2026. Nền tảng sự kiện của Hội Sinh viên CTUT, dành cho người nhận thiệp cá nhân/nhóm và người quản trị nội dung. Bản 3.0.0 kế thừa bố cục editorial, K2D tiếng Việt, vật liệu giấy/dệt, opening và điều khiển nhạc Liquid Glass đã có. Không dựng lại ứng dụng.

## Nhận diện và nội dung

Tên nền tảng: **Sự kiện Hội Sinh viên CTUT**. Header, footer, metadata và trạng thái hệ thống dùng tên này. Logo Hội lấy từ assets chính thức hiện có, giữ màu/tỉ lệ/transparency; không vẽ lại logo. Dải logo thiệp giữ thứ tự **Đoàn → Hội → CTUT**. Hình giấy ở trang chủ tiếp nối vật liệu thiệp, bỏ motif sách phục vụ nhận diện cũ.

Tên nền tảng không thay tên đơn vị tổ chức trong nội dung sự kiện. Salutation, tên, chức vụ/mô tả, cá nhân/nhóm và primary alias vẫn lấy từ snapshot người nhận. Không sửa nội dung lịch sử để xóa tên cũ. Logo cũ còn trong kho assets lịch sử nhưng không còn được component đang dùng tham chiếu.

Hướng duy nhất: trang trọng, ấm, tập trung vào người nhận; ENERGY 2 / RHYTHM 2 / MOTION 3. Không dùng sự kiện, con số hoặc lời chứng thực giả trong sản phẩm. Screenshots dùng fixture có nhãn kiểm thử.

## Typography và bố cục

K2D là font duy nhất, tự host Latin/Vietnamese ở weight 400/500/600/700 với `font-display: swap`. Chỉ preload hai subset weight 500; license SIL OFL ở `public/fonts/OFL.txt`. Không ép toàn bộ chữ bằng universal `!important`.

| Vai trò | Quy mô |
|---|---|
| Display | `clamp(3rem, 6.7vw, 6.5rem)` |
| Tiêu đề trang | `clamp(2.125rem, 5vw, 4.75rem)`; quản trị gọn hơn |
| Tiêu đề phần | `clamp(1.75rem, 3.3vw, 3rem)` |
| Nội dung | 1rem, line-height 1.65; văn bản dài 1.85 |
| Controls | 0.9375rem, weight 500; vùng bấm tối thiểu 44px |

Spacing 4/8/12/16/24/32/48/64/96px. Radius controls 6px, panel 12px; thiệp giữ mép giấy. SiteLayout có skip link, navigation và menu mobile bằng dialog. AdminShell giữ sidebar/drawer, breadcrumbs và guard quyền nội dung. Form dài có anchor, save bar, dirty state và cảnh báo rời trang.

## Hai loại thiệp

Editor dùng radio có tên và giải thích rõ: Thiệp mời để mời tham dự, có thời gian/địa điểm; Thiệp chúc để gửi lời chúc, không cần các trường đó. Khi đổi sang Thiệp chúc, giữ dữ liệu thời gian/địa điểm trong form và database, ẩn các nhóm không áp dụng và hiển thị thông báo. Đổi lại Thiệp mời phải vượt validation hiện hành, giờ 24h theo UTC+7.

Thiệp mời dùng “Trân trọng kính mời”; Thiệp chúc dùng “Trân trọng chúc mừng”, CTA “Mở thiệp chúc”. Cả hai giữ người nhận, tiêu đề, mô tả, quote, chương trình nếu có và phần kết. Thiệp chúc không tạo section lịch, countdown, địa điểm, ảnh địa điểm hay bản đồ. Không thay lời văn người dùng bằng replace toàn văn.

Danh sách và dashboard ghi “Thiệp chúc”, không gán sắp diễn ra/đã kết thúc. Bộ lọc dùng ngày tạo cho Thiệp chúc, ngày diễn ra cho Thiệp mời; có nhãn giải thích. Sắp xếp ưu tiên đang diễn ra → sắp diễn ra → Thiệp chúc mới nhất → đã kết thúc mới nhất.

## Màu của từng sự kiện

Nhóm **Giao diện** gồm năm presets Xanh Hội, Lá xanh, Đỏ son, Tím mực, Hổ phách; input màu tùy chỉnh; nút khôi phục mặc định; preview vật liệu. Preview không ghi dữ liệu. Schema duy nhất: `{version:1, primary:'#RRGGBB'}`, validation ở frontend và SQL, không nhận CSS hoặc key khác.

Mặc định `#174b78`. `themeStyle` suy ra chữ/nền/đường nhấn và nút; màu rất sáng được điều chỉnh để nền nút vẫn tương phản với chữ trắng. Vẫn giữ SVG linen, thớ giấy, ánh sáng có hướng, foil và chiều sâu. Theme scope trong route sự kiện và preview; cleanup khi chuyển về home/dashboard. Các màu báo lỗi/thành công giữ ý nghĩa chung.

Theme đọc trực tiếp từ sự kiện: đổi màu đã lưu sẽ áp dụng cho mọi thiệp của sự kiện. Theme **không** thay cơ chế snapshot người nhận. Dữ liệu theme thiếu/lỗi khi đọc fallback về Xanh Hội; payload sai khi ghi bị từ chối.

## Chuyển động và nhạc

Giữ tokens 120/180/300/550/900ms, easing `cubic-bezier(.2,.7,.2,1)`. Mở thiệp chuyển focus về tên người nhận, hai lớp giấy chỉ trang trí; cleanup timer khi unmount. Không scroll hijacking.

`InvitationChapter` nằm trong normal flow: không sticky, margin âm hoặc transform toàn section. Reveal chỉ gắn vào thành phần bên trong qua `useChapterScroll`; hoàn tất trong tối đa 180px cuộn, biên độ 28px desktop/16px mobile. Cuộn ngược đảo tiến trình tự nhiên. Fallback dùng passive scroll listener/rAF theo nhu cầu; cleanup listener/ResizeObserver/styles. Thiếu API, print và reduced motion giữ nội dung đọc được. Keyboard focus làm hiện thành phần ngay.

Nhạc khởi tạo 25%, thử autoplay theo chính sách trình duyệt, tiếp tục từ gesture mở thiệp hoặc nút Play. Không phát lại nếu người dùng chủ động pause. Giữ signed URL refresh và giải phóng nguồn khi unmount. Liquid Glass chỉ ở điều khiển nhạc: blur, viền và phản chiếu với opaque fallback; orb 52px desktop/48px mobile. Tab qua Play → Mute → Volume, Escape trả focus; hỗ trợ reduced transparency/motion.

## Tài khoản và khả năng tiếp cận

Admin nhập email, hệ thống tự phân biệt tài khoản hiện có và email mới; quyền mặc định Editor. Không có select invite/grant. Nút disabled trong request, chống double-click, thông báo kết quả ngay trong dialog; Escape/focus restoration khi không busy. Các trạng thái đã cấp quyền, chờ nhận lời mời, chưa xác nhận email, đang xử lý, lỗi một phần và cần khôi phục khác nhau. Có danh sách yêu cầu cần kiểm tra. Không khẳng định email đã đến hộp thư.

Session và quyền Admin kiểm lại ở server/RPC; không dựa vào ẩn nút. Retry không tự gửi lại email; revoke vô hiệu hóa worker cũ, retry của yêu cầu vừa bị thu hồi không tự cấp lại. Chi tiết kỹ thuật và giới hạn nằm trong [hướng dẫn vận hành](docs/OPERATIONS.md), không đưa vào luồng thao tác thông thường.

Trạng thái gửi lời mời được đọc khi mở dialog: đang kiểm tra, đang tắt, đã mở hoặc không kiểm tra được. Khi đang tắt, Admin vẫn thêm tài khoản có sẵn; thông báo email mới không hứa gửi thành công. Lỗi chưa bắt đầu thao tác dùng “Thử lại”; kết quả chưa xác định/lỗi một phần dùng “Kiểm tra và khôi phục”. Khoảng cách riêng form là 1rem, bỏ margin đoạn văn chồng lên grid để nút thao tác vẫn nằm trong viewport ở 320/390/430px. Các vùng thông báo giữ `role=status`; native dialog giữ focus/Escape.

## Phương pháp và bằng chứng

Design-team đã đọc catalog, dùng hệ thiết kế hiện có làm hướng. Hallmark dùng hướng dẫn nhất quán cho component, không chạy scaffold/theme mới; better-accessibility dùng semantics, focus và error recovery; Anti-slop `during` theo global preference và audit cuối. Không gọi dịch vụ tạo ảnh, thêm GSAP hoặc external AI worker. Không tuyên bố đã chạy Hallmark sloplint.

Kiểm tra Chrome/Playwright ở 320/390/430/768/1024/1440/1920px, keyboard, axe, reduced motion, scroll thuận/ngược và các trạng thái. Kết quả và giới hạn: [release notes](docs/releases/v3.0.0.md#kiem-thu). Ảnh/log trong `.local/hsv-v3/`, ignored. Các biên bản cũ nằm trong lịch sử Git; release notes và hướng dẫn vận hành là tài liệu hiện hành.

## Điểm danh và quản trị sự kiện

Phần mở rộng ngày 23/11/2026 giữ hệ thiết kế HSV, K2D, nền giấy và màu của sự kiện. Design-team dùng hướng hiện có; Hallmark áp dụng tính nhất quán component, better-accessibility cho dialog/focus và Anti-slop `during` để rà lại. Không dựng theme, nhận diện hay kiến trúc mới. Với thao tác điểm danh: ENERGY 1 / RHYTHM 1 / MOTION 1 để ưu tiên đọc, nhập và quét; thiệp bên dưới giữ chuyển động hiện hành.

- Danh sách quản trị có công tắc kèm trạng thái bằng chữ, khóa khi đang ghi và khôi phục khi lỗi. Editor chỉ đọc trạng thái công khai để không lẫn với nội dung chưa lưu.
- Sáu mục điều hướng gom các nhóm nội dung hiện có; thanh bám dưới header, cuộn ngang trên mobile và dùng offset đo từ kích thước thực tế để không che tiêu đề/focus.
- Chọn thiệp mặc định và Điểm danh là các fieldset cùng cơ chế Lưu/dirty/leave guard. Không dùng autosave cho cấu hình. Nền bản đồ, ghim và vòng tròn là công cụ chọn vị trí; không thay bản đồ hiển thị trên thiệp.
- Popup dùng native dialog, vùng nhập có nhãn, chữ 16px, focus rõ, Escape/trả focus, chiều cao theo viewport và safe area. Camera chỉ khởi động sau thao tác; đóng hoặc ẩn tab giải phóng stream. Kết quả/lỗi có chữ và nút thử lại.
- QR đen trên nền trắng có quiet zone để quét, độc lập màu sự kiện. Màn hình trình chiếu đặt QR làm điểm nhìn chính, có nút tạm dừng và tự bỏ mã hết hạn. Không thêm ảnh hoặc chuyển động trang trí.

Audit trong phạm vi thay đổi: bố cục ở 320/390/768/1440px, bàn phím/Escape, focus restoration, viewport bàn phím mô phỏng 320×420, axe dialog, vòng tròn ghim và lỗi/mất mạng. Ảnh từng trạng thái ở `.local/attendance/`; ma trận và giới hạn ở [vận hành](docs/OPERATIONS.md#diem-danh). Đây là bằng chứng trình duyệt và mock media, chưa phải xác nhận camera/GPS hay screen reader trên máy thật.

Delivery Gate cho phần mở rộng:

- Hard Gate PASS trong phạm vi thay đổi: ma trận browser kiểm tra không tràn viewport, nhãn/focus/Escape, thao tác thật với mock, trạng thái lỗi và cleanup camera; production build thành công. Bảng kết quả có vùng cuộn ngang được đặt tên và nhận focus.
- Purpose-Gate PASS: dùng token HSV hiện có; màu chỉ trạng thái/thao tác, vòng tròn biểu diễn bán kính, QR đen/trắng phục vụ quét. Không thêm asset, hiệu ứng hay section trang trí.
- Liveliness PASS: ENERGY 1 / RHYTHM 1 / MOTION 1; K2D, giấy ấm và xanh Hội giữ nhận diện; mỗi trạng thái có một thao tác chính. Đối chiếu ảnh cấu hình, trình chiếu và popup ở bốn chiều rộng.
- Craftsmanship PASS trong phạm vi kiểm thử: lưu cấu hình theo dirty state, khôi phục sau lỗi, kết quả thực từ API, sửa trên cùng hàng, tải scanner/bản đồ khi cần. Không dùng bằng chứng mock để khẳng định xác minh danh tính, chặn ẩn danh hay hoạt động camera/GPS thật.

### Danh sách sự kiện và thao tác quản trị — 23/11/2026

Hướng thiết kế kế thừa HSV: K2D, giấy ấm, xanh Hội; ENERGY 2 / RHYTHM 1 / MOTION 1 trong danh sách. Mục tiêu là tìm và mở đúng sự kiện nhanh hơn, giảm chiều cao quản trị, giữ công khai và nhân bản dễ truy cập. Không thay hình thức thiệp, media, màu riêng từng sự kiện hoặc cấu trúc editor.

Design-team phối hợp better-interface với sáu module accessibility, layout, writing, typography, colors và UI. Hallmark dùng nguyên tắc nhất quán trong hệ hiện có, không scaffold/theme hoặc chạy sloplint. Anti-slop `during` theo global preference, kiểm lại ở bước giao. Không dùng external AI worker, dịch vụ tạo ảnh hoặc dependency mới.

| Quan sát trước sửa | Cải tiến đã triển khai | Kiểm chứng |
|---|---|---|
| Các ô thống kê chỉ đọc chiếm nhiều chiều cao; trạng thái lặp trong bộ lọc riêng | Số lượng nằm trong nút lọc Tất cả / Đã công khai / Chưa công khai / Sắp diễn ra; có trạng thái `aria-pressed` | Lọc phối hợp tên, trạng thái, tháng, năm; dữ liệu rỗng có lối tạo hoặc bỏ lọc |
| Mỗi sự kiện là panel cao với bốn nút ngang; thông tin nhận diện đứng sau công tắc | Danh sách chung, tiêu đề liên kết đi trước ngày và mã; công khai, chỉnh sửa và nhân bản hiện trực tiếp; Thao tác chứa xem, copy link, kết quả và xóa | Bàn phím/Tab/Enter/Escape, clipboard, hủy xóa, focus restoration, không ghi dữ liệu khi hủy |
| Trang chủ chỉ lọc tháng/năm; quay lại danh sách làm mất lựa chọn | Tìm tên/mã không dấu, lọc trạng thái; bộ lọc lưu trong query URL, giữ khi reload hoặc Back; một nút xóa tất cả | Thiệp chúc theo ngày tạo, Thiệp mời theo ngày diễn ra; bản nháp không xuất hiện |
| Focus sau khi hủy xóa chưa quay về nút mở; toast thành công mặc định có tương phản 4.25:1 | Confirm trả focus rõ ràng; toast quản trị dùng cặp màu trạng thái HSV | Browser keyboard và axe, gồm trạng thái toast đang hiển thị |
| Gõ nhanh có thể mất ký tự khi React Router cập nhật URL; fade danh sách làm giảm tương phản trong lúc xuất hiện | Đồng bộ cập nhật ô nhập với URL, kiểm tên truy cập riêng cho input; danh sách công khai hiển thị ngay, bỏ Reveal riêng ở Home | `pressSequentially`, thao tác Chrome DevTools trên Vite với từ khóa không dấu, axe bốn chiều rộng |

So sánh cùng fixture, không phải số liệu người dùng thực: ở 1440 px, hàng đầu giảm 243 xuống 149 px; ở 390 px giảm 337 xuống 278 px và vị trí hàng đầu từ y=992 xuống y=676. Bằng chứng trước/sau và số đo trong `.local/uiux/`, ignored. Kiểm tra ở 320/390/768/1440 px, chữ phóng 200%, reduced motion, nội dung dài, loading/empty/error/retry và các luồng chức năng. Chi tiết kết quả hiện hành trong [vận hành](docs/OPERATIONS.md#uiux-danh-sach).

Purpose gate: xanh đánh dấu lựa chọn, số lượng là dữ liệu thật, đường phân cách giúp đối chiếu từng sự kiện; bóng chỉ dùng cho bảng thao tác nổi. Giữ title đầy đủ, mã xuống dòng khi dài, controls có nhãn và vùng bấm tối thiểu 44 px. Không thêm animation vào thao tác tìm/lọc thường xuyên. Audit chỉ bao phủ luồng danh sách và thành phần liên quan; không thay thế kiểm tra screen reader, bàn phím ảo hoặc thiết bị thật.

Delivery gate trong phạm vi này: typecheck/lint/build và 168 unit/SQL đạt; lượt tái kiểm 22 browser đạt cả desktop/mobile sau sửa, không còn lỗi trong nhóm sửa. Hard gate kiểm nhãn/focus/Escape, tương phản bằng axe, viewport và chữ 200% với `font-size` thực đo 32 px. Craftsmanship kiểm các trạng thái loading/empty/error/retry, bộ lọc phối hợp/reload/Back, clipboard và hủy xóa. K2D và hệ giấy/xanh Hội giữ nhận diện; không thêm tài nguyên hay hiệu ứng chỉ để trang trí. Các giới hạn thực tế được giữ rõ trong tài liệu vận hành.

Phạm vi chốt của better-interface là luồng tìm/lọc/mở/thao tác sự kiện trên Home và Dashboard, dùng React/CSS và tokens trong tài liệu này. Không mở rộng kết luận sang toàn bộ editor hoặc các trang quản trị khác.

| Mảng rà soát | Bằng chứng đã đối chiếu | Kết quả trong phạm vi |
|---|---|---|
| Accessibility | `EventSearch`, `EventActions`, `Confirm`; ca keyboard/focus/clipboard/hủy xóa và axe trong `usability.spec.ts` | Không còn lỗi đã phát hiện; chưa kiểm screen reader thật |
| Layout | `admin.css`, `public.css`; ảnh 320/390/768/1440, menu mở và chữ 200% | Không tràn ngang trong các ca kiểm; giữ thao tác truy cập được |
| Writing | Nhãn và trạng thái Home/Dashboard; ca empty/loading/error/retry | Nêu rõ hành động và đường thử lại hoặc bỏ bộ lọc |
| Typography | K2D hiện có, tiêu đề/mã dài; ca doubled text và ảnh `admin-text-200*` | Nội dung dài xuống dòng, chữ phóng vẫn đọc và thao tác được |
| Colors | Tokens HSV; axe trên danh sách, menu và toast sau sửa | Lỗi tương phản toast đã sửa và tái kiểm đạt |
| UI | `EventActions`, `useEventListFilters`; ca reduced motion, gõ nhanh, reload/Back | Thao tác phản hồi ngay; giữ bộ lọc và focus theo luồng đã kiểm |

Kết luận UI: **Approve trong phạm vi trên**; không còn phát hiện HIGH đang mở trong các ca đã kiểm. Đây không phải phê duyệt phát hành: SQL nhân bản/thời lượng, policy mật khẩu backend và kiểm thiết bị thật vẫn có trạng thái riêng trong tài liệu vận hành.

### README trên GitHub

README dùng logo chính thức, xanh Hội và giấy ấm từ hệ thiết kế này. Hình bìa SVG chỉ minh họa loại thiệp/màu, không thay bằng chứng giao diện; bản mobile có bố cục riêng. Nội dung chính là chữ Markdown/HTML có thể chọn, tìm và đọc bằng công cụ hỗ trợ. Typography do GitHub quyết định; không tải font hoặc dùng CSS tùy ý. ENERGY 2 / RHYTHM 1 / MOTION 1: tài liệu tĩnh, ưu tiên đọc và đi đến hướng dẫn.

Bốn mức nội dung: giới thiệu nền tảng, tính năng, chạy/kiểm thử, tài liệu vận hành. Badge CI có liên kết và nhãn đúng phạm vi kiểm thử; trạng thái deploy được ghi riêng. Logo Đoàn/Hội/CTUT giữ thứ tự tương đối. Hình bìa nằm trong docs/assets để không tăng payload ứng dụng.
