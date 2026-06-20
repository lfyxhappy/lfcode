<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">오픈 소스 AI 코딩 에이전트입니다.</p>
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

> 이 README는 현재 Lfcode 저장소 상태를 반영하므로 다운로드 링크, 릴리스 산출물, 호환성 노트가 항상 정확하게 유지됩니다.

### 개요

Lfcode는 opencode에서 발전한 Bun workspace 기반 모노레포입니다. 기존 호환성을 유지하면서 Lfcode 브랜드, 데스크톱 앱, 웹 UI, SDK, GitHub Action 연동을 제공합니다.

### 주요 기능

- 더 완전한 세션 관리: 목록, 상태, 생성, 업데이트, 삭제, 분기, 공유, 공유 해제, 요약, 압축, diff, revert, unrevert 지원.
- 다양한 상호작용 방식: 메시지 전송, 비동기 `prompt`, `shell`, 명령, 다음 프롬프트 예측.
- Skills 관리: 로컬 Skills 목록, 검색, 설치, 가져오기, 생성, 새로고침, 디렉터리 확인.
- GitHub Action 연동: 이슈 또는 PR 댓글에서 `/lfcode`, `/opencode`, `/oc`으로 자동 작업 트리거.
- 기존 호환성: `opencode` CLI 명령, `LFCODE_*` 환경 변수, `lfcode://` 프로토콜 유지.

### 설치

공개 다운로드는 [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases) 페이지에 게시됩니다.

- 데스크톱: 현재 릴리스 파이프라인은 `lfcode-win-x64.exe`라는 Windows 설치 파일을 배포합니다.
- 소스: 로컬 개발은 저장소 루트에서 Bun을 사용하세요.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### 호환성

호환성을 위해 몇 가지 런타임 식별자는 여전히 역사적인 `opencode` 이름을 사용합니다.

- CLI 명령: `opencode`
- 설정 디렉터리: `~/.lfcode`
- 환경 변수: `LFCODE_*`
- 데스크톱 프로토콜 스킴: `lfcode://`

### 저장소 구조

- `packages/lfcode`: 핵심 런타임과 세션 엔진
- `packages/app`: 웹 UI
- `packages/desktop`: Electron 데스크톱 호스트
- `packages/ui`: 공용 UI 컴포넌트
- `packages/sdk/js`: JavaScript SDK

### 문서

현재 문서 소스는 [packages/web/src/content/docs](packages/web/src/content/docs)에 있습니다.

### 검증

워크스페이스 루트에서 주요 검사를 실행하세요:

```bash
bun run lint
bun run typecheck
```

### 지원

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)