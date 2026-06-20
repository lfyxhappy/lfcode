<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">ওপেন সোর্স এআই কোডিং এজেন্ট।</p>
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

> এই README Lfcode রিপোজিটরির বর্তমান অবস্থা প্রতিফলিত করে, যাতে ডাউনলোড লিংক, রিলিজ অ্যাসেট এবং সামঞ্জস্য নোট সঠিক থাকে।

### পরিচিতি

Lfcode হলো একটি Bun workspace monorepo, যা opencode থেকে বিকশিত হয়েছে। এটি ঐতিহাসিক compatibility surface বজায় রেখে Lfcode ব্র্যান্ড, ডেস্কটপ অ্যাপ, ওয়েব UI, SDK, এবং GitHub Action সমর্থন দেয়।

### বৈশিষ্ট্য

- আরও পূর্ণাঙ্গ session management: তালিকা, status, create, update, delete, fork, share, unshare, summarize, compact, diff, revert, এবং unrevert সমর্থন।
- একাধিক interaction mode: message পাঠানো, asynchronous `prompt`, `shell`, commands, এবং next-prompt prediction।
- Skills management: local Skills তালিকা, discover, install, import, create, refresh, এবং directory inspection।
- GitHub Action integration: issue বা PR comment থেকে `/lfcode`, `/opencode`, বা `/oc` ব্যবহার করে automated কাজ শুরু।
- ঐতিহাসিক compatibility: `opencode` CLI command, `LFCODE_*` environment variables, এবং `lfcode://` protocol বজায় রাখা।

### ইনস্টলেশন

Public download গুলো [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases) পেজে প্রকাশিত হয়।

- Desktop: বর্তমান release pipeline `lfcode-win-x64.exe` নামের Windows installer প্রকাশ করে।
- Source: local development-এর জন্য repository root থেকে Bun ব্যবহার করুন।

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### সামঞ্জস্য

কিছু runtime identifier compatibility-এর জন্য এখনো ঐতিহাসিক `opencode` নাম ব্যবহার করে।

- CLI command: `opencode`
- Config directory: `~/.lfcode`
- Environment variables: `LFCODE_*`
- Desktop protocol scheme: `lfcode://`

### Repository structure

- `packages/lfcode`: core runtime এবং session engine
- `packages/app`: web UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: shared UI components
- `packages/sdk/js`: JavaScript SDK

### Documentation

বর্তমান documentation source আছে [packages/web/src/content/docs](packages/web/src/content/docs)-এ।

### Validation

Workspace root থেকে মূল checks চালান:

```bash
bun run lint
bun run typecheck
```

### Support

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
