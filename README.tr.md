<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logosu">
    </picture>
  </a>
</p>
<p align="center">opencode üzerinde geliştirilmiş açık kaynaklı bir yapay zeka kodlama ajanı.</p>
<p align="center">Tarihsel uyumluluk noktalarını korurken oturum yönetimi, Skills yönetimi ve GitHub Action entegrasyonunu genişletir.</p>
<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode/releases"><img alt="En son sürüm" src="https://img.shields.io/github/v/release/lfyxhappy/lfcode?display_name=tag&style=flat-square" /></a>
  <a href="https://github.com/lfyxhappy/lfcode/actions/workflows/publish.yml"><img alt="Derleme durumu" src="https://img.shields.io/github/actions/workflow/status/lfyxhappy/lfcode/publish.yml?style=flat-square&branch=dev" /></a>
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

> Bu yerelleştirilmiş README, indirme bağlantılarının, sürüm dosyalarının ve uyumluluk notlarının doğru kalması için Lfcode deposunun güncel durumunu yansıtır.

### Genel Bakış

Lfcode, opencode üzerine inşa edilmiş bir Bun workspace monorepo’sudur. Tarihsel uyumluluğu korur ve Lfcode markasını, masaüstü uygulamasını, web UI’ını, SDK’yı ve GitHub Action desteğini sunmaya devam eder.

### Öne Çıkanlar

- Daha kapsamlı oturum yönetimi: liste, durum, oluşturma, güncelleme, silme, fork, paylaşma, paylaşımı kaldırma, özetleme, sıkıştırma, diff, revert ve unrevert
- Daha fazla etkileşim biçimi: mesaj gönderme, asenkron `prompt`, `shell`, komutlar ve sonraki prompt tahmini
- Skills yönetimi: yerel Skills listesi, keşif, kurulum, içe aktarma, oluşturma, yenileme ve klasör inceleme
- GitHub Action entegrasyonu: issue veya PR yorumlarından `/lfcode`, `/opencode` ya da `/oc` ile otomatik işi tetikleme
- Tarihsel uyumluluk: `opencode` CLI komutu, `LFCODE_*` ortam değişkenleri ve `lfcode://` protokolü korunur

### Kurulum

Genel indirmeler [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases) sayfasında yayımlanır.

- Masaüstü: mevcut release hattı `lfcode-win-x64.exe` adlı bir Windows yükleyicisi yayımlar
- Kaynak: yerel geliştirme için repo kökünden Bun kullanın

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Uyumluluk

Bazı runtime tanımlayıcıları uyumluluk için hâlâ tarihsel `opencode` adını kullanır.

- CLI komutu: `opencode`
- Yapılandırma dizini: `~/.lfcode`
- Ortam değişkenleri: `LFCODE_*`
- Masaüstü protokol şeması: `lfcode://`

### Depo Yapısı

- `packages/lfcode`: çekirdek runtime ve session engine
- `packages/app`: web UI
- `packages/desktop`: Electron masaüstü host’u
- `packages/ui`: paylaşılan UI bileşenleri
- `packages/sdk/js`: JavaScript SDK

### Dokümantasyon

Güncel doküman kaynağı [packages/web/src/content/docs](packages/web/src/content/docs) altında bulunur.

### Doğrulama

Workspace kökünden ana kontrolleri çalıştırın:

```bash
bun run lint
bun run typecheck
```

### Destek

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
