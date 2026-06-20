<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Логотип Lfcode">
    </picture>
  </a>
</p>
<p align="center">Open-source AI-агент для кодирования, построенный на opencode.</p>
<p align="center">Сохраняет историческую совместимость и расширяет управление сессиями, Skills и интеграцию с GitHub Action.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="Последний релиз" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Статус сборки" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
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

> Этот локализованный README отражает текущее состояние репозитория Lfcode, чтобы ссылки на загрузку, релизные файлы и заметки о совместимости оставались точными.

### Обзор

Lfcode — это Bun workspace monorepo, построенный на основе opencode. Он сохраняет историческую совместимость и продолжает поставлять бренд Lfcode, десктопное приложение, веб-интерфейс, SDK и поддержку GitHub Action.

### Основные возможности

- Более полное управление сессиями: список, статус, создание, обновление, удаление, fork, sharing, unshare, summarize, compact, diff, revert и unrevert.
- Несколько способов взаимодействия: отправка сообщений, асинхронный `prompt`, `shell`, команды и прогноз следующего prompt.
- Управление Skills: локальный список Skills, обнаружение, установка, импорт, создание, обновление и просмотр каталогов.
- Интеграция GitHub Action: запуск автоматической работы из комментариев issue или PR через `/lfcode`, `/opencode` или `/oc`.
- Историческая совместимость: сохранены команда CLI `opencode`, переменные окружения `LFCODE_*` и протокол `lfcode://`.

### Установка

Публичные загрузки публикуются на странице [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Desktop: текущий release pipeline публикует Windows installer с именем `lfcode-win-x64.exe`.
- Source: используйте Bun из корня репозитория для локальной разработки.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Совместимость

Некоторые идентификаторы runtime по-прежнему используют историческое имя `opencode` ради совместимости.

- Команда CLI: `opencode`
- Каталог конфигурации: `~/.lfcode`
- Переменные окружения: `LFCODE_*`
- Схема desktop-протокола: `lfcode://`

### Структура репозитория

- `packages/lfcode`: основной runtime и движок сессий
- `packages/app`: web UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: общие UI-компоненты
- `packages/sdk/js`: JavaScript SDK

### Документация

Текущий источник документации находится в [packages/web/src/content/docs](packages/web/src/content/docs).

### Проверка

Запускайте основные проверки из корня workspace:

```bash
bun run lint
bun run typecheck
```

### Поддержка

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
