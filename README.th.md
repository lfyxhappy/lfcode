<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode โลโก้">
    </picture>
  </a>
</p>
<p align="center">เอเจนต์เขียนโค้ด AI แบบโอเพนซอร์สที่พัฒนาต่อยอดจาก opencode</p>
<p align="center">ยังคงรองรับจุดเชื่อมต่อแบบเดิม พร้อมเพิ่มการจัดการ session, Skills และ GitHub Action ให้ครบขึ้น</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="รุ่นล่าสุด" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="สถานะการ build" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
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

> README ฉบับแปลนี้อ้างอิงสถานะปัจจุบันของรีโพซิทอรี Lfcode เพื่อให้ลิงก์ดาวน์โหลด ไฟล์รีลีส และหมายเหตุด้านความเข้ากันได้ยังคงถูกต้อง

### ภาพรวม

Lfcode คือ Bun workspace monorepo ที่พัฒนาต่อยอดจาก opencode โดยยังคงความเข้ากันได้กับของเดิม และยังส่งมอบแบรนด์ Lfcode, แอปเดสก์ท็อป, Web UI, SDK และการรองรับ GitHub Action ต่อไป

### ฟีเจอร์เด่น

- การจัดการ session ที่ครบขึ้น: รายการ, สถานะ, สร้าง, อัปเดต, ลบ, fork, แชร์, ยกเลิกการแชร์, สรุป, บีบอัด, diff, revert และ unrevert
- รูปแบบการโต้ตอบที่หลากหลาย: ส่งข้อความ, `prompt` แบบ async, `shell`, คำสั่ง และการคาดเดา prompt ถัดไป
- การจัดการ Skills: รายการ Skills ในเครื่อง, ค้นพบ, ติดตั้ง, นำเข้า, สร้าง, รีเฟรช และดูโฟลเดอร์
- การเชื่อมต่อ GitHub Action: เริ่มงานอัตโนมัติจากคอมเมนต์ issue หรือ PR ด้วย `/lfcode`, `/opencode` หรือ `/oc`
- ความเข้ากันได้ย้อนหลัง: ยังเก็บคำสั่ง CLI `opencode`, ตัวแปรสภาพแวดล้อม `LFCODE_*` และโปรโตคอล `lfcode://`

### การติดตั้ง

ไฟล์ดาวน์โหลดสาธารณะเผยแพร่ที่หน้า [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases)

- เดสก์ท็อป: release ปัจจุบันเผยแพร่ Windows installer ชื่อ `lfcode-win-x64.exe`
- ซอร์สโค้ด: ใช้ Bun จาก root ของ repo สำหรับการพัฒนาในเครื่อง

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### ความเข้ากันได้

ตัวระบุ runtime บางส่วนยังใช้ชื่อ `opencode` เดิมเพื่อความเข้ากันได้

- คำสั่ง CLI: `opencode`
- โฟลเดอร์ตั้งค่า: `~/.lfcode`
- ตัวแปรสภาพแวดล้อม: `LFCODE_*`
- โปรโตคอลเดสก์ท็อป: `lfcode://`

### โครงสร้าง repository

- `packages/lfcode`: runtime หลักและ session engine
- `packages/app`: Web UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: คอมโพเนนต์ UI ที่ใช้ร่วมกัน
- `packages/sdk/js`: JavaScript SDK

### เอกสาร

แหล่งเอกสารปัจจุบันอยู่ที่ [packages/web/src/content/docs](packages/web/src/content/docs)

### การตรวจสอบ

รันการตรวจสอบหลักจาก root ของ workspace:

```bash
bun run lint
bun run typecheck
```

### การสนับสนุน

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
