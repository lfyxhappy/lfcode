<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">وكيل البرمجة بالذكاء الاصطناعي مفتوح المصدر.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
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

> يعكس هذا README الحالة الحالية لمستودع Lfcode حتى تبقى روابط التنزيل وملفات الإصدارات وملاحظات التوافق دقيقة.

### نظرة عامة

Lfcode هو monorepo مبني على Bun workspace وتطوّر من opencode. يحافظ على سطح التوافق التاريخي ويقدّم علامة Lfcode التجارية، وتطبيق سطح مكتب، وواجهة ويب، وSDK، ودعم GitHub Action.

### أبرز المزايا

- إدارة جلسات أوسع: عرض القائمة، الحالة، الإنشاء، التحديث، الحذف، التفريع، المشاركة، إلغاء المشاركة، التلخيص، الضغط، diff، revert، وunrevert.
- أوضاع تفاعل متعددة: إرسال الرسائل، `prompt` غير المتزامن، `shell`، الأوامر، وتوقع prompt التالي.
- إدارة Skills: عرض Skills المحلية، اكتشافها، تثبيتها، استيرادها، إنشاؤها، تحديثها، وفحص المجلدات.
- تكامل GitHub Action: تشغيل العمل الآلي من تعليقات issues أو PR باستخدام `/lfcode` أو `/opencode` أو `/oc`.
- توافق تاريخي: الإبقاء على أمر CLI `opencode` ومتغيرات البيئة `LFCODE_*` والبروتوكول `lfcode://`.

### التثبيت

تُنشر التنزيلات العامة على صفحة [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- سطح المكتب: تنشر قناة الإصدارات الحالية ملف تثبيت Windows باسم `lfcode-win-x64.exe`.
- المصدر: استخدم Bun من جذر المستودع للتطوير المحلي.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### التوافق

تستخدم عدة معرفات تشغيلية الاسم التاريخي `opencode` من أجل التوافق.

- أمر CLI: `opencode`
- دليل الإعدادات: `~/.lfcode`
- متغيرات البيئة: `LFCODE_*`
- مخطط بروتوكول سطح المكتب: `lfcode://`

### بنية المستودع

- `packages/lfcode`: النواة ومحرك الجلسات
- `packages/app`: واجهة الويب
- `packages/desktop`: مضيف سطح المكتب Electron
- `packages/ui`: مكونات UI مشتركة
- `packages/sdk/js`: SDK الخاص بـ JavaScript

### الوثائق

مصدر الوثائق الحالي موجود في [packages/web/src/content/docs](packages/web/src/content/docs).

### التحقق

شغّل الفحوصات الرئيسية من جذر مساحة العمل:

```bash
bun run lint
bun run typecheck
```

### الدعم

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
