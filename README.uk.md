<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Локальне середовище з відкритим кодом для програмування за допомогою ШІ.</strong></p>
<p align="center">Об'єднайте діалоги, редагування коду, термінал, браузер, Skills та автоматизацію в одному настільному середовищі.</p>
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

## Основні переваги

LFCODE зберігає весь процес розробки в одному місці:

- **Сесії** — Упорядковуйте довгі діалоги, продовжуйте роботу та переглядайте історію кожного завдання.
- **Редактор і термінал** — Переходьте між змінами, командами й результатами, не залишаючи робоче середовище.
- **Браузер і автоматизація** — Запускайте браузерні сценарії та повторювані завдання в одному контексті.
- **Skills і розширення** — Розширюйте можливості за допомогою Skills, MCP, плагінів і власних інструментів.

## Попередній перегляд

Ці зображення представляють чотири ключові напрями й згодом будуть замінені реальними знімками екрана.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Сесії</strong></td>
    <td align="center"><strong>Редактор і термінал</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Браузер і автоматизація</strong></td>
    <td align="center"><strong>Skills і розширення</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Швидкий старт

### Встановлення у Windows

Відкрийте [Releases](https://github.com/lfyxhappy/lfcode/releases), завантажте `lfcode-win-x64.exe` з останнього випуску та запустіть інсталятор.

### Основна команда

`lfcode` — офіційна команда CLI:

```bash
lfcode
lfcode --help
```

### Запуск із вихідного коду

Для локальної розробки потрібен Bun. Виконайте в терміналі:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Архітектура та розширення

Репозиторій є Bun workspace monorepo. Ядро міститься в `packages/lfcode`, вебінтерфейс — у `packages/app`, хост Electron — у `packages/desktop`, спільний UI — у `packages/ui`, а JavaScript SDK — у `packages/sdk/js`. LFCODE розширюється через Skills, інструменти MCP, плагіни, команди й автоматизацію.

## Сумісність

Щоб старі робочі процеси продовжували працювати, деякі історичні ідентифікатори та псевдонім `opencode` усе ще підтримуються. У новій документації та щоденній роботі використовуйте назву LFCODE і команду `lfcode`.

## Внесок і підтримка

Ми вітаємо внески. Використовуйте [Issues](https://github.com/lfyxhappy/lfcode/issues) для помилок і пропозицій, а [Releases](https://github.com/lfyxhappy/lfcode/releases) — для завантажень і переліку змін.

LFCODE поширюється за [ліцензією MIT](LICENSE).
