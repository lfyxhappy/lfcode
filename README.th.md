<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>พื้นที่ทำงานเขียนโค้ดด้วย AI แบบ local-first และโอเพนซอร์ส</strong></p>
<p align="center">รวมแชต การแก้ไขโค้ด เทอร์มินัล เบราว์เซอร์ Skills และระบบอัตโนมัติไว้ในสภาพแวดล้อมเดสก์ท็อปเดียว</p>
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

## คุณค่าหลัก

LFCODE รวมกระบวนการพัฒนาทั้งหมดไว้ในที่เดียว:

- **เซสชัน** — จัดระเบียบบทสนทนายาว กลับมาทำงานต่อ และตรวจสอบประวัติของแต่ละงาน
- **ตัวแก้ไขและเทอร์มินัล** — สลับระหว่างการแก้ไข คำสั่ง และผลลัพธ์โดยไม่ต้องออกจากพื้นที่ทำงาน
- **เบราว์เซอร์และระบบอัตโนมัติ** — เรียกใช้เวิร์กโฟลว์เบราว์เซอร์และงานที่ทำซ้ำได้ในบริบทเดียวกัน
- **Skills และส่วนขยาย** — เพิ่มความสามารถด้วย Skills, MCP, ปลั๊กอิน และเครื่องมือของคุณเอง

## ตัวอย่างฟีเจอร์

ภาพเหล่านี้แสดงสี่ส่วนหลัก และจะเปลี่ยนเป็นภาพหน้าจอจริงในภายหลัง

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>เซสชัน</strong></td>
    <td align="center"><strong>ตัวแก้ไขและเทอร์มินัล</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>เบราว์เซอร์และระบบอัตโนมัติ</strong></td>
    <td align="center"><strong>Skills และส่วนขยาย</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## เริ่มต้นอย่างรวดเร็ว

### ติดตั้งบน Windows

เปิด [Releases](https://github.com/lfyxhappy/lfcode/releases) ดาวน์โหลด `lfcode-win-x64.exe` จากรุ่นล่าสุด แล้วเรียกใช้ตัวติดตั้ง

### คำสั่งหลัก

`lfcode` คือคำสั่ง CLI อย่างเป็นทางการ:

```bash
lfcode
lfcode --help
```

### เรียกใช้จากซอร์ส

การพัฒนาในเครื่องต้องใช้ Bun ให้เรียกใช้ในเทอร์มินัล:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## สถาปัตยกรรมและการขยาย

ที่เก็บนี้เป็น Bun workspace monorepo โดย runtime อยู่ใน `packages/lfcode`, web UI อยู่ใน `packages/app`, Electron host อยู่ใน `packages/desktop`, UI ที่ใช้ร่วมกันอยู่ใน `packages/ui` และ JavaScript SDK อยู่ใน `packages/sdk/js` คุณสามารถขยาย LFCODE ด้วย Skills, เครื่องมือ MCP, ปลั๊กอิน คำสั่ง และเวิร์กโฟลว์อัตโนมัติ

## ความเข้ากันได้

เพื่อให้เวิร์กโฟลว์เดิมยังทำงาน ตัวระบุเก่าบางส่วนและ alias `opencode` ยังรองรับอยู่ สำหรับเอกสารใหม่และการใช้งานประจำวัน ให้ใช้ชื่อ LFCODE และคำสั่ง `lfcode`

## การมีส่วนร่วมและการสนับสนุน

ยินดีรับการมีส่วนร่วม ใช้ [Issues](https://github.com/lfyxhappy/lfcode/issues) สำหรับรายงานข้อผิดพลาดและข้อเสนอ และดู [Releases](https://github.com/lfyxhappy/lfcode/releases) สำหรับการดาวน์โหลดและรายการเปลี่ยนแปลง

LFCODE เผยแพร่ภายใต้ [สัญญาอนุญาต MIT](LICENSE)
