# SQL rebuild v1.1: chỉ giữ cho lịch sử và test

**Không chạy REBUILD.sql, 01-reset.sql hoặc seed trong thư mục này trên production.** Đợt rebuild cũ đã hoàn tất. Các file ở đây không tạo schema HSV 3.0.0 và không phải quy trình nâng cấp hoặc bootstrap project mới.

Source SQL được giữ vì các test database/transaction còn đọc chúng để dựng baseline synthetic và kiểm tra rollback/guard. Snapshot Auth/Storage trong các test không phải dữ liệu production.

Schema hiện hành có hai loại thiệp, theme, Editor, rich text, nhạc và operation ledger được bổ sung sau v1.1. Đọc [hướng dẫn vận hành hiện tại](../../docs/OPERATIONS.md) để đối chiếu schema, migration history và môi trường mới. Không chạy lại migrations chỉ vì tên file khác timestamp trong history.

Inventory và biên bản thực thi cũ vẫn có trong lịch sử Git; chúng không phải xác nhận trạng thái database hiện tại.
