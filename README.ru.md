<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Локальная рабочая среда с ИИ для программирования с открытым исходным кодом.</strong></p>
<p align="center">Объедините диалоги, редактирование кода, терминал, браузер, Skills и автоматизацию в одном настольном приложении.</p>
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

## Основные преимущества

LFCODE сохраняет весь процесс разработки в одном месте:

- **Сессии** — Организуйте длинные диалоги, продолжайте работу и просматривайте историю каждой задачи.
- **Редактор и терминал** — Переходите между изменениями, командами и результатами, не покидая рабочую среду.
- **Браузер и автоматизация** — Запускайте браузерные сценарии и повторяемые задачи в едином контексте.
- **Skills и расширения** — Расширяйте возможности с помощью Skills, MCP, плагинов и собственных инструментов.

## Предварительный просмотр

Эти изображения представляют четыре ключевых направления и позднее будут заменены реальными снимками экрана.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Сессии</strong></td>
    <td align="center"><strong>Редактор и терминал</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Браузер и автоматизация</strong></td>
    <td align="center"><strong>Skills и расширения</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Быстрый старт

### Установка в Windows

Откройте [Releases](https://github.com/lfyxhappy/lfcode/releases), скачайте `lfcode-win-x64.exe` из последнего выпуска и запустите установщик.

### Основная команда

`lfcode` — официальная команда CLI:

```bash
lfcode
lfcode --help
```

### Запуск из исходного кода

Для локальной разработки нужен Bun. Выполните в терминале:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Архитектура и расширение

Репозиторий представляет собой Bun workspace monorepo. Ядро находится в `packages/lfcode`, веб-интерфейс — в `packages/app`, хост Electron — в `packages/desktop`, общие компоненты UI — в `packages/ui`, а JavaScript SDK — в `packages/sdk/js`. LFCODE расширяется через Skills, инструменты MCP, плагины, команды и автоматизацию.

## Совместимость

Для работы старых сценариев некоторые исторические идентификаторы и псевдоним `opencode` всё ещё поддерживаются. В новой документации и повседневной работе используйте название LFCODE и команду `lfcode`.

## Участие и поддержка

Мы приветствуем вклад в проект. Используйте [Issues](https://github.com/lfyxhappy/lfcode/issues) для ошибок и предложений, а [Releases](https://github.com/lfyxhappy/lfcode/releases) — для загрузок и списка изменений.

LFCODE распространяется по [лицензии MIT](LICENSE).
