<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">L'agent de codage IA open source.</p>
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

> Ce README reflète l'état actuel du dépôt Lfcode afin que les liens de téléchargement, les artefacts de publication et les notes de compatibilité restent exacts.

### Présentation

Lfcode est un monorepo Bun workspace issu d'opencode. Il conserve la surface de compatibilité historique tout en continuant à fournir l'identité Lfcode, une application de bureau, une interface web, un SDK et une intégration GitHub Action.

### Points forts

- Gestion de session plus complète : liste, statut, création, mise à jour, suppression, fork, partage, retrait du partage, synthèse, compactage, diff, revert et unrevert.
- Plusieurs modes d'interaction : envoi de messages, `prompt` asynchrone, `shell`, commandes et prédiction du prochain prompt.
- Gestion des Skills : liste locale, découverte, installation, import, création, rafraîchissement et inspection des répertoires.
- Intégration GitHub Action : déclencher un travail automatisé depuis les commentaires de issues ou de PR avec `/lfcode`, `/opencode` ou `/oc`.
- Compatibilité historique : conserver la commande CLI `opencode`, les variables d'environnement `LFCODE_*` et le protocole `lfcode://`.

### Installation

Les téléchargements publics sont publiés sur la page [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Bureau : le pipeline de publication actuel génère un installateur Windows nommé `lfcode-win-x64.exe`.
- Source : utilisez Bun depuis la racine du dépôt pour le développement local.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Compatibilité

Plusieurs identifiants d'exécution continuent d'utiliser le nom historique `opencode` pour la compatibilité.

- Commande CLI : `opencode`
- Répertoire de configuration : `~/.lfcode`
- Variables d'environnement : `LFCODE_*`
- Schéma de protocole de bureau : `lfcode://`

### Structure du dépôt

- `packages/lfcode` : noyau d'exécution et moteur de sessions
- `packages/app` : interface web
- `packages/desktop` : hôte de bureau Electron
- `packages/ui` : composants UI partagés
- `packages/sdk/js` : SDK JavaScript

### Documentation

La source actuelle de la documentation se trouve dans [packages/web/src/content/docs](packages/web/src/content/docs).

### Validation

Lancez les vérifications principales du dépôt depuis la racine du workspace :

```bash
bun run lint
bun run typecheck
```

### Support

- Issues : [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases : [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)