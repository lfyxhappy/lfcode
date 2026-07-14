<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Um workspace de programação com IA, local-first e de código aberto.</strong></p>
<p align="center">Reúna conversas, edição de código, terminal, navegador, Skills e automações em um único ambiente desktop.</p>
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

## Principais benefícios

O LFCODE mantém todo o fluxo de desenvolvimento em um só lugar:

- **Sessões** — Organize conversas longas, retome o trabalho e acompanhe o histórico de cada tarefa.
- **Editor e terminal** — Alterne entre alterações, comandos e resultados sem sair do workspace.
- **Navegador e automação** — Execute fluxos de navegador e tarefas repetíveis no mesmo contexto.
- **Skills e extensões** — Amplie o comportamento com Skills, MCP, plugins e ferramentas próprias.

## Prévia dos recursos

Estas prévias representam as quatro áreas principais e serão substituídas por capturas reais.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Sessões</strong></td>
    <td align="center"><strong>Editor e terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Navegador e automação</strong></td>
    <td align="center"><strong>Skills e extensões</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Início rápido

### Instalação no Windows

Abra [Releases](https://github.com/lfyxhappy/lfcode/releases), baixe `lfcode-win-x64.exe` da versão mais recente e execute o instalador.

### Comando principal

`lfcode` é o comando oficial da CLI:

```bash
lfcode
lfcode --help
```

### Executar a partir do código-fonte

O desenvolvimento local requer Bun. No terminal, execute:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Arquitetura e extensibilidade

O repositório é um monorepo Bun: o runtime fica em `packages/lfcode`, a interface web em `packages/app`, o host Electron em `packages/desktop`, a UI compartilhada em `packages/ui` e o SDK JavaScript em `packages/sdk/js`. O LFCODE pode ser ampliado com Skills, ferramentas MCP, plugins, comandos e automações.

## Compatibilidade

Para manter fluxos antigos funcionando, alguns identificadores históricos e o alias `opencode` continuam compatíveis. Em documentação nova e no uso diário, prefira o nome LFCODE e o comando `lfcode`.

## Contribuição e suporte

Contribuições são bem-vindas. Use [Issues](https://github.com/lfyxhappy/lfcode/issues) para bugs e sugestões, e consulte [Releases](https://github.com/lfyxhappy/lfcode/releases) para downloads e mudanças.

O LFCODE é distribuído sob a [licença MIT](LICENSE).
