<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Lokalno orijentisan AI radni prostor otvorenog koda za programiranje.</strong></p>
<p align="center">Objedinite razgovore, uređivanje koda, terminal, preglednik, Skills i automatizaciju u jednom desktop okruženju.</p>
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

## Glavne vrijednosti

LFCODE drži cijeli razvojni tok na jednom mjestu:

- **Sesije** — Organizujte duge razgovore, nastavite rad i pregledajte historiju svakog zadatka.
- **Uređivač i terminal** — Prelazite između izmjena, naredbi i rezultata bez napuštanja radnog prostora.
- **Preglednik i automatizacija** — Pokrećite tokove preglednika i ponovljive zadatke iz istog konteksta.
- **Skills i proširenja** — Proširite mogućnosti kroz Skills, MCP, dodatke i vlastite alate.

## Pregled mogućnosti

Ovi prikazi predstavljaju četiri glavna područja i kasnije će biti zamijenjeni stvarnim snimcima.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Sesije</strong></td>
    <td align="center"><strong>Uređivač i terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Preglednik i automatizacija</strong></td>
    <td align="center"><strong>Skills i proširenja</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Brzi početak

### Instalacija na Windows

Otvorite [Releases](https://github.com/lfyxhappy/lfcode/releases), preuzmite `lfcode-win-x64.exe` iz najnovijeg izdanja i pokrenite instalaciju.

### Glavna naredba

`lfcode` je službena CLI naredba:

```bash
lfcode
lfcode --help
```

### Pokretanje iz izvornog koda

Za lokalni razvoj potreban je Bun. U terminalu pokrenite:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Arhitektura i proširenja

Repozitorij je Bun workspace monorepo. Jezgra je u `packages/lfcode`, web UI u `packages/app`, Electron host u `packages/desktop`, zajednički UI u `packages/ui`, a JavaScript SDK u `packages/sdk/js`. LFCODE se proširuje kroz Skills, MCP alate, dodatke, naredbe i automatizovane tokove.

## Kompatibilnost

Radi starih tokova rada, neki historijski identifikatori i alias `opencode` ostaju podržani. Za novu dokumentaciju i svakodnevni rad koristite naziv LFCODE i naredbu `lfcode`.

## Doprinos i podrška

Doprinosi su dobrodošli. Koristite [Issues](https://github.com/lfyxhappy/lfcode/issues) za greške i prijedloge, a [Releases](https://github.com/lfyxhappy/lfcode/releases) za preuzimanja i promjene.

LFCODE je objavljen pod [MIT licencom](LICENSE).
