<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Không gian lập trình AI mã nguồn mở, ưu tiên chạy cục bộ.</strong></p>
<p align="center">Đưa trò chuyện, chỉnh sửa mã, terminal, trình duyệt, Skills và tự động hóa vào cùng một môi trường desktop.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases">Download</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="https://github.com/lfyxhappy/lfcode/issues">Issues</a>
</p>

<p align="center">
  <a href="README.en.md">English</a> |
  <a href="README.md">简体中文</a> |
  <a href="README.zh.md">简体中文（备用）</a> |
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

## Giá trị cốt lõi

LFCODE giữ toàn bộ quy trình phát triển tại một nơi:

- **Phiên làm việc** — Sắp xếp hội thoại dài, tiếp tục công việc và xem lại lịch sử của từng tác vụ.
- **Trình sửa mã và terminal** — Chuyển giữa thay đổi, lệnh và kết quả mà không rời không gian làm việc.
- **Trình duyệt và tự động hóa** — Chạy quy trình trình duyệt và các tác vụ lặp lại trong cùng ngữ cảnh.
- **Skills và phần mở rộng** — Mở rộng khả năng bằng Skills, MCP, plugin và công cụ riêng.

## Xem trước tính năng

Các hình này đại diện cho bốn khu vực chính và sẽ được thay bằng ảnh chụp thật sau này.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Phiên làm việc</strong></td>
    <td align="center"><strong>Trình sửa mã và terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Trình duyệt và tự động hóa</strong></td>
    <td align="center"><strong>Skills và phần mở rộng</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Bắt đầu nhanh

### Cài đặt trên Windows

Mở [Releases](https://github.com/lfyxhappy/lfcode/releases), tải `lfcode-win-x64.exe` từ bản phát hành mới nhất rồi chạy trình cài đặt.

### Lệnh chính

`lfcode` là lệnh CLI chính thức:

```bash
lfcode
lfcode --help
```

### Chạy từ mã nguồn

Phát triển cục bộ cần Bun. Chạy trong terminal:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Kiến trúc và khả năng mở rộng

Kho mã là một Bun workspace monorepo. Runtime nằm ở `packages/lfcode`, giao diện web ở `packages/app`, Electron host ở `packages/desktop`, UI dùng chung ở `packages/ui`, và JavaScript SDK ở `packages/sdk/js`. Có thể mở rộng LFCODE bằng Skills, công cụ MCP, plugin, lệnh và quy trình tự động.

## Tương thích

Để duy trì quy trình cũ, một số định danh lịch sử và bí danh `opencode` vẫn được hỗ trợ. Với tài liệu mới và sử dụng hằng ngày, hãy dùng tên LFCODE và lệnh `lfcode`.

## Đóng góp và hỗ trợ

Mọi đóng góp đều được hoan nghênh. Dùng [Issues](https://github.com/lfyxhappy/lfcode/issues) cho lỗi và đề xuất, và xem [Releases](https://github.com/lfyxhappy/lfcode/releases) để tải xuống và đọc thay đổi.

LFCODE được phát hành theo [giấy phép MIT](LICENSE).
