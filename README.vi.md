<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Logo Lfcode">
    </picture>
  </a>
</p>
<p align="center">Tác nhân lập trình AI mã nguồn mở được phát triển trên opencode.</p>
<p align="center">Giữ nguyên các điểm tương thích lịch sử, đồng thời mở rộng quản lý phiên, Skills và tích hợp GitHub Action.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Bản phát hành mới nhất" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Trạng thái build" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> |
  <a href="README.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Lfcode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/lfyxhappy/lfcode)

---

> README bản địa hóa này phản ánh trạng thái hiện tại của kho Lfcode để các liên kết tải xuống, file phát hành và ghi chú tương thích luôn chính xác.

### Tổng quan

Lfcode là một Bun workspace monorepo được xây dựng dựa trên opencode. Dự án vẫn giữ các điểm tương thích lịch sử, đồng thời tiếp tục cung cấp thương hiệu Lfcode, ứng dụng desktop, web UI, SDK và hỗ trợ GitHub Action.

### Tính năng nổi bật

- Quản lý session đầy đủ hơn: danh sách, trạng thái, tạo, cập nhật, xóa, fork, chia sẻ, bỏ chia sẻ, tóm tắt, nén, diff, revert và unrevert
- Nhiều cách tương tác hơn: gửi tin nhắn, `prompt` bất đồng bộ, `shell`, lệnh và dự đoán prompt tiếp theo
- Quản lý Skills: danh sách Skills cục bộ, khám phá, cài đặt, nhập, tạo, làm mới và xem thư mục
- Tích hợp GitHub Action: kích hoạt tự động từ bình luận issue hoặc PR bằng `/lfcode`, `/opencode` hoặc `/oc`
- Tương thích lịch sử: vẫn giữ lệnh CLI `opencode`, biến môi trường `LFCODE_*` và giao thức `lfcode://`

### Cài đặt

Các bản tải xuống công khai được đăng tại trang [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Desktop: quy trình phát hành hiện tại xuất bản bộ cài Windows tên `lfcode-win-x64.exe`
- Source: dùng Bun từ thư mục gốc của repo để phát triển cục bộ

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Tương thích

Một số định danh runtime vẫn dùng tên lịch sử `opencode` để tương thích.

- Lệnh CLI: `opencode`
- Thư mục cấu hình: `~/.lfcode`
- Biến môi trường: `LFCODE_*`
- Giao thức desktop: `lfcode://`

### Cấu trúc kho

- `packages/lfcode`: runtime cốt lõi và session engine
- `packages/app`: web UI
- `packages/desktop`: host desktop Electron
- `packages/ui`: các thành phần UI dùng chung
- `packages/sdk/js`: JavaScript SDK

### Tài liệu

Nguồn tài liệu hiện tại nằm ở [packages/web/src/content/docs](packages/web/src/content/docs).

### Xác minh

Chạy các kiểm tra chính từ thư mục gốc của workspace:

```bash
bun run lint
bun run typecheck
```

### Hỗ trợ

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
