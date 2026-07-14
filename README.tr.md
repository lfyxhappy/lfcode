<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Yerel öncelikli, açık kaynaklı bir yapay zekâ kodlama çalışma alanı.</strong></p>
<p align="center">Sohbeti, kod düzenlemeyi, terminali, tarayıcıyı, Skills'i ve otomasyonu tek bir masaüstü ortamında birleştirin.</p>
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

## Temel değerler

LFCODE tüm geliştirme akışını tek bir yerde tutar:

- **Oturumlar** — Uzun konuşmaları düzenleyin, çalışmaya devam edin ve her görevin geçmişini inceleyin.
- **Düzenleyici ve terminal** — Çalışma alanından ayrılmadan değişiklikler, komutlar ve sonuçlar arasında geçiş yapın.
- **Tarayıcı ve otomasyon** — Tarayıcı akışlarını ve tekrarlanabilir görevleri aynı bağlamda çalıştırın.
- **Skills ve uzantılar** — Skills, MCP, eklentiler ve kendi araçlarınızla yetenekleri genişletin.

## Özellik önizlemeleri

Bu önizlemeler dört ana alanı temsil eder ve ileride gerçek ekran görüntüleriyle değiştirilecektir.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Oturumlar</strong></td>
    <td align="center"><strong>Düzenleyici ve terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Tarayıcı ve otomasyon</strong></td>
    <td align="center"><strong>Skills ve uzantılar</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Hızlı başlangıç

### Windows kurulumu

[Releases](https://github.com/lfyxhappy/lfcode/releases) sayfasını açın, en son sürümden `lfcode-win-x64.exe` dosyasını indirin ve yükleyiciyi çalıştırın.

### Ana komut

`lfcode` resmi CLI komutudur:

```bash
lfcode
lfcode --help
```

### Kaynak koddan çalıştırma

Yerel geliştirme için Bun gerekir. Terminalde çalıştırın:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Mimari ve genişletilebilirlik

Depo bir Bun workspace monorepo'sudur. Çalışma zamanı `packages/lfcode`, web arayüzü `packages/app`, Electron sunucusu `packages/desktop`, ortak arayüz `packages/ui` ve JavaScript SDK `packages/sdk/js` içindedir. LFCODE; Skills, MCP araçları, eklentiler, komutlar ve otomasyonlarla genişletilebilir.

## Uyumluluk

Eski iş akışlarını korumak için bazı tarihsel tanımlayıcılar ve `opencode` takma adı desteklenmeye devam eder. Yeni belgelerde ve günlük kullanımda LFCODE adını ve `lfcode` komutunu kullanın.

## Katkı ve destek

Katkılara açığız. Hata ve öneriler için [Issues](https://github.com/lfyxhappy/lfcode/issues), indirmeler ve değişiklikler için [Releases](https://github.com/lfyxhappy/lfcode/releases) sayfasını kullanın.

LFCODE [MIT Lisansı](LICENSE) ile yayımlanır.
