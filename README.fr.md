<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Un espace de développement IA open source, conçu d'abord pour le local.</strong></p>
<p align="center">Réunissez conversation, édition de code, terminal, navigateur, Skills et automatisation dans un même environnement de bureau.</p>
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

## Atouts essentiels

LFCODE regroupe l'ensemble du flux de développement au même endroit :

- **Sessions** — Organisez les longues conversations, reprenez le travail et consultez l'historique de chaque tâche.
- **Éditeur et terminal** — Passez des modifications aux commandes et aux résultats sans quitter l'espace de travail.
- **Navigateur et automatisation** — Exécutez des scénarios de navigation et des tâches répétables dans le même contexte.
- **Skills et extensions** — Étendez les capacités avec des Skills, MCP, des plugins et vos propres outils.

## Aperçu des fonctions

Ces aperçus représentent les quatre domaines principaux et seront remplacés plus tard par de vraies captures.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Sessions</strong></td>
    <td align="center"><strong>Éditeur et terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Navigateur et automatisation</strong></td>
    <td align="center"><strong>Skills et extensions</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Démarrage rapide

### Installation sous Windows

Ouvrez [Releases](https://github.com/lfyxhappy/lfcode/releases), téléchargez `lfcode-win-x64.exe` depuis la dernière version, puis lancez l'installateur.

### Commande principale

`lfcode` est la commande officielle de la CLI :

```bash
lfcode
lfcode --help
```

### Exécution depuis les sources

Le développement local nécessite Bun. Dans un terminal, exécutez :

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Architecture et extensibilité

Le dépôt est un monorepo Bun. Le moteur se trouve dans `packages/lfcode`, l'interface web dans `packages/app`, l'hôte Electron dans `packages/desktop`, l'UI partagée dans `packages/ui` et le SDK JavaScript dans `packages/sdk/js`. LFCODE s'étend grâce aux Skills, outils MCP, plugins, commandes et automatisations.

## Compatibilité

Pour préserver les anciens flux, certains identifiants historiques et l'alias `opencode` restent pris en charge. Dans la nouvelle documentation et au quotidien, utilisez le nom LFCODE et la commande `lfcode`.

## Contribution et assistance

Les contributions sont bienvenues. Utilisez [Issues](https://github.com/lfyxhappy/lfcode/issues) pour les bugs et propositions, et consultez [Releases](https://github.com/lfyxhappy/lfcode/releases) pour les téléchargements et changements.

LFCODE est distribué sous [licence MIT](LICENSE).
