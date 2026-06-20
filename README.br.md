<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">O agente de programacao com IA de codigo aberto.</p>
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

> Este README reflete o estado atual do repositório Lfcode para manter corretos os links de download, os artefatos de release e as notas de compatibilidade.

### Visão geral

Lfcode é um monorepo de Bun workspace que evoluiu a partir do opencode. Ele preserva a superfície de compatibilidade histórica e continua oferecendo a marca Lfcode, um aplicativo de desktop, uma interface web, um SDK e integração com GitHub Action.

### Destaques

- Gerenciamento de sessões mais completo: listar, status, criar, atualizar, excluir, fork, compartilhar, remover compartilhamento, resumir, compactar, diff, revert e unrevert.
- Mais modos de interação: envio de mensagens, `prompt` assíncrono, `shell`, comandos e previsão do próximo prompt.
- Gerenciamento de Skills: listar Skills locais, descobrir, instalar, importar, criar, atualizar e inspecionar diretórios.
- Integração com GitHub Action: acione trabalho automatizado em comentários de issue ou PR com `/lfcode`, `/opencode` ou `/oc`.
- Compatibilidade histórica: mantém o comando CLI `opencode`, as variáveis de ambiente `LFCODE_*` e o protocolo `lfcode://`.

### Instalação

Os downloads públicos são publicados na página de [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Desktop: o pipeline de release atual publica um instalador do Windows chamado `lfcode-win-x64.exe`.
- Fonte: use Bun a partir da raiz do repositório para desenvolvimento local.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Compatibilidade

Alguns identificadores em tempo de execução ainda usam o nome histórico `opencode` por compatibilidade.

- Comando CLI: `opencode`
- Diretório de configuração: `~/.lfcode`
- Variáveis de ambiente: `LFCODE_*`
- Protocolo de desktop: `lfcode://`

### Estrutura do repositório

- `packages/lfcode`: runtime principal e motor de sessões
- `packages/app`: UI web
- `packages/desktop`: host de desktop Electron
- `packages/ui`: componentes de UI compartilhados
- `packages/sdk/js`: SDK de JavaScript

### Documentação

A fonte atual da documentação fica em [packages/web/src/content/docs](packages/web/src/content/docs).

### Validação

Execute as verificações principais na raiz do workspace:

```bash
bun run lint
bun run typecheck
```

### Suporte

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)
