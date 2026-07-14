<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Ένα local-first, ανοικτού κώδικα περιβάλλον προγραμματισμού με AI.</strong></p>
<p align="center">Συνδυάστε συνομιλίες, επεξεργασία κώδικα, τερματικό, πρόγραμμα περιήγησης, Skills και αυτοματισμούς σε ένα περιβάλλον επιφάνειας εργασίας.</p>
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

## Βασικά πλεονεκτήματα

Το LFCODE διατηρεί ολόκληρη τη ροή ανάπτυξης σε ένα σημείο:

- **Συνεδρίες** — Οργανώστε μεγάλες συνομιλίες, συνεχίστε την εργασία και δείτε το ιστορικό κάθε εργασίας.
- **Επεξεργαστής και τερματικό** — Μεταβείτε μεταξύ αλλαγών, εντολών και αποτελεσμάτων χωρίς να φύγετε από το περιβάλλον.
- **Περιήγηση και αυτοματισμός** — Εκτελέστε ροές περιήγησης και επαναλαμβανόμενες εργασίες στο ίδιο πλαίσιο.
- **Skills και επεκτάσεις** — Επεκτείνετε τις δυνατότητες με Skills, MCP, πρόσθετα και δικά σας εργαλεία.

## Προεπισκόπηση λειτουργιών

Οι προεπισκοπήσεις δείχνουν τους τέσσερις βασικούς τομείς και αργότερα θα αντικατασταθούν από πραγματικά στιγμιότυπα.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Συνεδρίες</strong></td>
    <td align="center"><strong>Επεξεργαστής και τερματικό</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Περιήγηση και αυτοματισμός</strong></td>
    <td align="center"><strong>Skills και επεκτάσεις</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Γρήγορη εκκίνηση

### Εγκατάσταση στα Windows

Ανοίξτε τη σελίδα [Releases](https://github.com/lfyxhappy/lfcode/releases), κατεβάστε το `lfcode-win-x64.exe` από την τελευταία έκδοση και εκτελέστε το πρόγραμμα εγκατάστασης.

### Κύρια εντολή

Η `lfcode` είναι η επίσημη εντολή CLI:

```bash
lfcode
lfcode --help
```

### Εκτέλεση από τον πηγαίο κώδικα

Η τοπική ανάπτυξη απαιτεί Bun. Εκτελέστε στο τερματικό:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Αρχιτεκτονική και επεκτάσεις

Το αποθετήριο είναι Bun workspace monorepo. Ο πυρήνας βρίσκεται στο `packages/lfcode`, το web UI στο `packages/app`, ο Electron host στο `packages/desktop`, το κοινό UI στο `packages/ui` και το JavaScript SDK στο `packages/sdk/js`. Το LFCODE επεκτείνεται με Skills, εργαλεία MCP, πρόσθετα, εντολές και αυτοματισμούς.

## Συμβατότητα

Για να συνεχίσουν να λειτουργούν παλιές ροές, υποστηρίζονται ακόμη ορισμένα ιστορικά αναγνωριστικά και το ψευδώνυμο `opencode`. Στη νέα τεκμηρίωση και στην καθημερινή χρήση προτιμήστε το LFCODE και την εντολή `lfcode`.

## Συνεισφορά και υποστήριξη

Οι συνεισφορές είναι ευπρόσδεκτες. Χρησιμοποιήστε τα [Issues](https://github.com/lfyxhappy/lfcode/issues) για σφάλματα και προτάσεις και τα [Releases](https://github.com/lfyxhappy/lfcode/releases) για λήψεις και αλλαγές.

Το LFCODE διατίθεται με την [άδεια MIT](LICENSE).
