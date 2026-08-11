# Thunderbird AI Bridge

[English / danh sách đầy đủ ngôn ngữ](../../README.md)

## Đây là gì?

Thunderbird AI Bridge là cầu nối cục bộ giữa Thunderbird và các tác nhân AI, công cụ CLI, script và ứng dụng tùy chỉnh. Tiện ích mở rộng thực hiện thao tác trên hộp thư, còn chương trình cục bộ giao tiếp với nó qua giao thức HTTP nhỏ trên `127.0.0.1`.

**Không bắt buộc SuperCLI.** Host đầu tiên được tạo cho SuperCLI, nhưng bất kỳ chương trình nào triển khai giao thức mô tả trong [docs/PROTOCOL.md](../PROTOCOL.md) đều có thể sử dụng tiện ích.

## Tính năng

- liệt kê tài khoản và thư mục,
- tạo, đổi tên và xóa thư mục,
- tìm kiếm theo người gửi, người nhận/địa chỉ, chủ đề, toàn văn và ngày,
- đọc thư mà không cố ý thay đổi trạng thái đã đọc/chưa đọc,
- đọc thư dài theo từng phần,
- liệt kê và chuyển tệp đính kèm cho mô hình vision hoặc xử lý tài liệu,
- di chuyển thư, đưa vào Trash và khôi phục,
- xóa vĩnh viễn có xác minh IMAP,
- Empty Trash/EXPUNGE gốc của Thunderbird,
- nhập Outlook `.msg` sau khi chuyển thành `.eml`,
- thao tác hàng loạt theo lô giới hạn với continuation token.

## Bảo mật

Các thao tác nhạy cảm có lớp bảo vệ bổ sung. Hành động phá hủy yêu cầu `confirm: true`, xóa vĩnh viễn chỉ được thực hiện từ Trash và thư mục system/root được bảo vệ. Host cũng nên yêu cầu người dùng xác nhận rõ ràng.

Bridge được thiết kế cho sử dụng cục bộ. Không mở host trực tiếp ra LAN hoặc Internet.

## Build

Yêu cầu Thunderbird 128 trở lên.

```bash
python scripts/build_xpi.py
npm test
```

XPI được tạo tại `dist/thunderbird-ai-bridge.xpi` và có thể cài thủ công từ trình quản lý add-on của Thunderbird.

Trạng thái: thử nghiệm (`0.9.18`). Giao thức có thể thay đổi trước `1.0`.

Giấy phép MIT. Dự án độc lập, không liên kết chính thức với Mozilla hoặc Thunderbird.
