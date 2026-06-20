<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">AI agent za kodiranje otvorenog koda.</p>
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

> Ovaj README odražava trenutno stanje Lfcode repozitorija kako bi linkovi za preuzimanje, release asseti i napomene o kompatibilnosti ostali tačni.

### Pregled

Lfcode je Bun workspace monorepo koji je nastao iz opencode-a. Zadržava istorijsku kompatibilnost i isporučuje Lfcode brend, desktop aplikaciju, web UI, SDK i GitHub Action podršku.

### Istaknuto

- Potpunije upravljanje sesijama: lista, status, kreiranje, ažuriranje, brisanje, fork, dijeljenje, ukidanje dijeljenja, sažetak, kompakcija, diff, revert i unrevert.
- Više načina interakcije: slanje poruka, asinhroni `prompt`, `shell`, komande i predviđanje sljedećeg prompta.
- Upravljanje Skillsima: lokalna lista Skillsa, otkrivanje, instalacija, import, kreiranje, osvježavanje i provjera direktorija.
- GitHub Action integracija: pokrenite automatizirani rad iz issue ili PR komentara pomoću `/lfcode`, `/opencode` ili `/oc`.
- Istorijska kompatibilnost: zadržani su `opencode` CLI naredba, `LFCODE_*` environment varijable i `lfcode://` protokol.

### Instalacija

Javni downloadi se objavljuju na stranici [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Desktop: trenutni release pipeline objavljuje Windows installer pod imenom `lfcode-win-x64.exe`.
- Source: za lokalni razvoj koristite Bun iz korijena repozitorija.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Kompatibilnost

Neki runtime identifikatori i dalje koriste historijsko ime `opencode` zbog kompatibilnosti.

- CLI naredba: `opencode`
- Konfiguracioni direktorij: `~/.lfcode`
- Environment varijable: `LFCODE_*`
- Desktop protokol: `lfcode://`

### Struktura repozitorija

- `packages/lfcode`: core runtime i session engine
- `packages/app`: web UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: zajedničke UI komponente
- `packages/sdk/js`: JavaScript SDK

### Dokumentacija

Trenutni izvor dokumentacije je u [packages/web/src/content/docs](packages/web/src/content/docs).

### Provjera

Pokrenite glavne provjere iz korijena workspace-a:

```bash
bun run lint
bun run typecheck
```

### Podrška

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
