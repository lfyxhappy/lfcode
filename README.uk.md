<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Логотип Lfcode">
    </picture>
  </a>
</p>
<p align="center">Open-source AI-агент для кодування, побудований на opencode.</p>
<p align="center">Зберігає історичну сумісність і розширює керування сесіями, Skills та інтеграцію з GitHub Action.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Останній реліз" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Статус збірки" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
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

> Цей локалізований README відображає поточний стан репозиторію Lfcode, щоб посилання на завантаження, файли релізів і примітки щодо сумісності залишалися точними.

### Огляд

Lfcode — це Bun workspace monorepo, побудований на основі opencode. Він зберігає історичну сумісність і продовжує постачати бренд Lfcode, десктопний застосунок, веб-інтерфейс, SDK та підтримку GitHub Action.

### Основні можливості

- Повніше керування сесіями: список, статус, створення, оновлення, видалення, fork, share, unshare, summarize, compact, diff, revert та unrevert
- Більше способів взаємодії: надсилання повідомлень, асинхронний `prompt`, `shell`, команди та прогноз наступного prompt
- Керування Skills: локальний список Skills, виявлення, встановлення, імпорт, створення, оновлення та перегляд каталогів
- Інтеграція з GitHub Action: запуск автоматизованої роботи з коментарів issue або PR через `/lfcode`, `/opencode` або `/oc`
- Історична сумісність: збережено команду CLI `opencode`, змінні середовища `LFCODE_*` і протокол `lfcode://`

### Встановлення

Публічні завантаження публікуються на сторінці [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Desktop: поточний release pipeline публікує Windows installer з назвою `lfcode-win-x64.exe`
- Source: використовуйте Bun з кореня репозиторію для локальної розробки

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Сумісність

Деякі ідентифікатори runtime досі використовують історичну назву `opencode` заради сумісності.

- Команда CLI: `opencode`
- Каталог конфігурації: `~/.lfcode`
- Змінні середовища: `LFCODE_*`
- Схема desktop-протоколу: `lfcode://`

### Структура репозиторію

- `packages/lfcode`: основний runtime і движок сесій
- `packages/app`: веб UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: спільні UI-компоненти
- `packages/sdk/js`: JavaScript SDK

### Документація

Поточне джерело документації знаходиться в [packages/web/src/content/docs](packages/web/src/content/docs).

### Перевірка

Запускайте основні перевірки з кореня workspace:

```bash
bun run lint
bun run typecheck
```

### Підтримка

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
