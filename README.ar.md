<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>مساحة عمل مفتوحة المصدر للبرمجة بالذكاء الاصطناعي، تعمل محليًا أولًا.</strong></p>
<p align="center">اجمع المحادثات وتحرير الشيفرة والطرفية والمتصفح والمهارات وسير العمل الآلي في بيئة سطح مكتب واحدة.</p>
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

## القيمة الأساسية

صُمم LFCODE ليُبقي دورة التطوير كاملة في مكان واحد:

- **الجلسات** — نظّم المحادثات الطويلة، واستأنف العمل، وراجع تاريخ كل مهمة.
- **تحرير الشيفرة والطرفية** — انتقل بين التعديلات والأوامر ونتائج التنفيذ دون مغادرة مساحة العمل.
- **المتصفح والأتمتة** — نفّذ سير عمل المتصفح والمهام القابلة للتكرار من السياق نفسه.
- **المهارات والإضافات** — وسّع السلوك عبر Skills وMCP والإضافات والأدوات المخصصة.

## معاينة الوظائف

توضح هذه المعاينات المجالات الأربعة الأساسية؛ ستستبدل بلقطات حقيقية لاحقًا.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>الجلسات</strong></td>
    <td align="center"><strong>تحرير الشيفرة والطرفية</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>المتصفح والأتمتة</strong></td>
    <td align="center"><strong>المهارات والإضافات</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## البدء السريع

### التثبيت على Windows

افتح صفحة [Releases](https://github.com/lfyxhappy/lfcode/releases)، ونزّل `lfcode-win-x64.exe` من أحدث إصدار، ثم شغّل المثبّت.

### الأمر الرئيسي

`lfcode` هو أمر سطر الأوامر الرسمي:

```bash
lfcode
lfcode --help
```

### التشغيل من المصدر

يتطلب التطوير المحلي Bun. نفّذ الأوامر التالية من الطرفية:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## البنية وقابلية التوسعة

المستودع مساحة عمل Bun متعددة الحزم. توجد النواة في `packages/lfcode`، وواجهة الويب في `packages/app`، وتطبيق Electron في `packages/desktop`، والمكونات المشتركة في `packages/ui`، وSDK JavaScript في `packages/sdk/js`. يمكن توسيع LFCODE عبر Skills وأدوات MCP والإضافات والأوامر وسير العمل الآلي.

## التوافق

للحفاظ على سير العمل القديم، ما زالت بعض المعرّفات والاسم المستعار `opencode` مدعومة. في الوثائق الجديدة والاستخدام اليومي، استخدم اسم LFCODE والأمر `lfcode`.

## المساهمة والدعم

نرحب بالمساهمات. استخدم [Issues](https://github.com/lfyxhappy/lfcode/issues) للإبلاغ عن الأخطاء أو اقتراح التحسينات، وراجع [Releases](https://github.com/lfyxhappy/lfcode/releases) للتنزيلات وسجل التغييرات.

يُنشر LFCODE بموجب [رخصة MIT](LICENSE).
