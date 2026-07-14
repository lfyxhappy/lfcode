<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>লোকাল-ফার্স্ট, ওপেন-সোর্স AI কোডিং ওয়ার্কস্পেস।</strong></p>
<p align="center">চ্যাট, কোড এডিটিং, টার্মিনাল, ব্রাউজার, Skills এবং অটোমেশনকে একই ডেস্কটপ পরিবেশে আনুন।</p>
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

## মূল সুবিধা

LFCODE পুরো ডেভেলপমেন্ট প্রবাহকে এক জায়গায় রাখে:

- **সেশন** — দীর্ঘ কথোপকথন সাজান, কাজ আবার শুরু করুন এবং প্রতিটি কাজের ইতিহাস দেখুন।
- **কোড এডিটিং ও টার্মিনাল** — ওয়ার্কস্পেস না ছেড়েই পরিবর্তন, কমান্ড ও রান ফলাফলের মধ্যে চলুন।
- **ব্রাউজার ও অটোমেশন** — একই প্রসঙ্গ থেকে ব্রাউজার ও পুনরাবৃত্ত কাজের ওয়ার্কফ্লো চালান।
- **Skills ও এক্সটেনশন** — Skills, MCP, প্লাগইন ও নিজস্ব টুল দিয়ে আচরণ বাড়ান।

## ফিচার প্রিভিউ

এই প্রিভিউগুলো চারটি প্রধান ক্ষেত্র দেখায়; পরে প্রকৃত স্ক্রিনশট যোগ হবে।

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>সেশন</strong></td>
    <td align="center"><strong>কোড এডিটিং ও টার্মিনাল</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>ব্রাউজার ও অটোমেশন</strong></td>
    <td align="center"><strong>Skills ও এক্সটেনশন</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## দ্রুত শুরু

### Windows-এ ইনস্টল

[Releases](https://github.com/lfyxhappy/lfcode/releases) খুলুন, সর্বশেষ রিলিজ থেকে `lfcode-win-x64.exe` ডাউনলোড করে ইনস্টলার চালান।

### প্রধান কমান্ড

`lfcode` হলো আনুষ্ঠানিক CLI কমান্ড:

```bash
lfcode
lfcode --help
```

### সোর্স থেকে চালানো

লোকাল ডেভেলপমেন্টে Bun প্রয়োজন। টার্মিনালে চালান:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## আর্কিটেকচার ও এক্সটেনশন

এটি একটি Bun workspace monorepo। মূল runtime `packages/lfcode`, web UI `packages/app`, Electron host `packages/desktop`, shared UI `packages/ui`, এবং JavaScript SDK `packages/sdk/js`-এ আছে। Skills, MCP tools, plugins, commands ও automation workflow দিয়ে LFCODE বাড়ানো যায়।

## সামঞ্জস্য

পুরোনো workflow সচল রাখতে কিছু ঐতিহাসিক identifier এবং `opencode` alias এখনও সমর্থিত। নতুন নথি ও দৈনন্দিন ব্যবহারে LFCODE নাম এবং `lfcode` কমান্ড ব্যবহার করুন।

## অবদান ও সহায়তা

অবদান স্বাগত। বাগ বা প্রস্তাবের জন্য [Issues](https://github.com/lfyxhappy/lfcode/issues), আর ডাউনলোড ও পরিবর্তনের জন্য [Releases](https://github.com/lfyxhappy/lfcode/releases) দেখুন।

LFCODE [MIT License](LICENSE)-এর অধীনে প্রকাশিত।
