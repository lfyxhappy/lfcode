<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">Ο open source AI agent προγραμματισμού.</p>
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

> Αυτό το README αντικατοπτρίζει την τρέχουσα κατάσταση του αποθετηρίου Lfcode, ώστε οι σύνδεσμοι λήψης, τα release assets και οι σημειώσεις συμβατότητας να παραμένουν σωστά.

### Επισκόπηση

Το Lfcode είναι ένα monorepo Bun workspace που εξελίχθηκε από το opencode. Διατηρεί το ιστορικό compatibility surface και συνεχίζει να προσφέρει το brand Lfcode, εφαρμογή desktop, web UI, SDK και υποστήριξη GitHub Action.

### Κύρια σημεία

- Πιο πλήρης διαχείριση συνεδριών: λίστα, κατάσταση, δημιουργία, ενημέρωση, διαγραφή, fork, share, unshare, σύνοψη, compact, diff, revert και unrevert.
- Περισσότεροι τρόποι αλληλεπίδρασης: αποστολή μηνυμάτων, ασύγχρονο `prompt`, `shell`, εντολές και πρόβλεψη του επόμενου prompt.
- Διαχείριση Skills: τοπική λίστα Skills, ανακάλυψη, εγκατάσταση, εισαγωγή, δημιουργία, ανανέωση και έλεγχος καταλόγων.
- Ενσωμάτωση GitHub Action: εκκίνηση αυτοματοποιημένης εργασίας από σχόλια issue ή PR με `/lfcode`, `/opencode` ή `/oc`.
- Ιστορική συμβατότητα: διατήρηση της CLI εντολής `opencode`, των μεταβλητών περιβάλλοντος `LFCODE_*` και του πρωτοκόλλου `lfcode://`.

### Εγκατάσταση

Τα δημόσια downloads δημοσιεύονται στη σελίδα [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Desktop: το τρέχον release pipeline δημοσιεύει installer για Windows με όνομα `lfcode-win-x64.exe`.
- Πηγαίος κώδικας: χρησιμοποιήστε Bun από τη ρίζα του αποθετηρίου για τοπική ανάπτυξη.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Συμβατότητα

Ορισμένα runtime identifiers εξακολουθούν να χρησιμοποιούν το ιστορικό όνομα `opencode` για συμβατότητα.

- CLI εντολή: `opencode`
- Κατάλογος ρυθμίσεων: `~/.lfcode`
- Μεταβλητές περιβάλλοντος: `LFCODE_*`
- Σχήμα πρωτοκόλλου desktop: `lfcode://`

### Δομή αποθετηρίου

- `packages/lfcode`: core runtime και session engine
- `packages/app`: web UI
- `packages/desktop`: Electron desktop host
- `packages/ui`: κοινά UI components
- `packages/sdk/js`: JavaScript SDK

### Τεκμηρίωση

Η τρέχουσα πηγή τεκμηρίωσης βρίσκεται στο [packages/web/src/content/docs](packages/web/src/content/docs).

### Επαλήθευση

Εκτελέστε τους κύριους ελέγχους από τη ρίζα του workspace:

```bash
bun run lint
bun run typecheck
```

### Υποστήριξη

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
