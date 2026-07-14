<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>로컬 우선 오픈 소스 AI 코딩 워크스페이스.</strong></p>
<p align="center">대화, 코드 편집, 터미널, 브라우저, Skills, 자동화 워크플로를 하나의 데스크톱 환경에 모읍니다.</p>
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

## 핵심 가치

LFCODE는 전체 개발 흐름을 한곳에 유지합니다.

- **세션** — 긴 대화를 정리하고 작업을 재개하며 각 작업의 기록을 확인합니다.
- **코드 편집기와 터미널** — 워크스페이스를 벗어나지 않고 변경, 명령, 실행 결과를 오갑니다.
- **브라우저와 자동화** — 같은 컨텍스트에서 브라우저 흐름과 반복 가능한 작업을 실행합니다.
- **Skills와 확장** — Skills, MCP, 플러그인, 사용자 도구로 기능을 확장합니다.

## 기능 미리보기

다음 이미지는 네 가지 핵심 영역을 나타내며 추후 실제 화면으로 교체됩니다.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>세션</strong></td>
    <td align="center"><strong>코드 편집기와 터미널</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>브라우저와 자동화</strong></td>
    <td align="center"><strong>Skills와 확장</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## 빠른 시작

### Windows 설치

[Releases](https://github.com/lfyxhappy/lfcode/releases)에서 최신 버전의 `lfcode-win-x64.exe`를 내려받아 설치 프로그램을 실행합니다.

### 기본 명령

`lfcode`가 공식 CLI 명령입니다.

```bash
lfcode
lfcode --help
```

### 소스에서 실행

로컬 개발에는 Bun이 필요합니다. 터미널에서 실행하세요.

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## 아키텍처와 확장성

저장소는 Bun workspace monorepo입니다. 핵심 런타임은 `packages/lfcode`, 웹 UI는 `packages/app`, Electron 호스트는 `packages/desktop`, 공유 UI는 `packages/ui`, JavaScript SDK는 `packages/sdk/js`에 있습니다. Skills, MCP 도구, 플러그인, 명령, 자동화 워크플로로 LFCODE를 확장할 수 있습니다.

## 호환성

기존 워크플로를 유지하기 위해 일부 역사적 식별자와 `opencode` 별칭은 계속 지원됩니다. 새 문서와 일상적인 사용에서는 LFCODE 이름과 `lfcode` 명령을 사용하세요.

## 기여와 지원

기여를 환영합니다. 버그와 제안은 [Issues](https://github.com/lfyxhappy/lfcode/issues), 다운로드와 변경 사항은 [Releases](https://github.com/lfyxhappy/lfcode/releases)를 확인하세요.

LFCODE는 [MIT License](LICENSE)로 배포됩니다.
