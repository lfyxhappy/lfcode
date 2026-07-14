<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset=".github/readme/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/readme/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/readme/lfcode-wordmark-light.svg" alt="LFCODE">
    </picture>
  </a>
</p>
<p align="center"><strong>Un espacio de programación con IA, local-first y de código abierto.</strong></p>
<p align="center">Reúne chat, edición de código, terminal, navegador, Skills y automatización en un solo entorno de escritorio.</p>
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

## Ventajas principales

LFCODE mantiene todo el flujo de desarrollo en un mismo lugar:

- **Sesiones** — Organiza conversaciones largas, retoma el trabajo y consulta el historial de cada tarea.
- **Editor y terminal** — Alterna entre cambios, comandos y resultados sin salir del espacio de trabajo.
- **Navegador y automatización** — Ejecuta flujos del navegador y tareas repetibles desde el mismo contexto.
- **Skills y extensiones** — Amplía las funciones con Skills, MCP, complementos y herramientas propias.

## Vista previa de funciones

Estas vistas representan las cuatro áreas principales y más adelante se sustituirán por capturas reales.

<table>
  <tr>
    <td><img src=".github/readme/preview-sessions.svg" alt="Sessions preview"></td>
    <td><img src=".github/readme/preview-editor-terminal.svg" alt="Editor and terminal preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Sesiones</strong></td>
    <td align="center"><strong>Editor y terminal</strong></td>
  </tr>
  <tr>
    <td><img src=".github/readme/preview-browser-automation.svg" alt="Browser automation preview"></td>
    <td><img src=".github/readme/preview-skills-extensions.svg" alt="Skills and extensions preview"></td>
  </tr>
  <tr>
    <td align="center"><strong>Navegador y automatización</strong></td>
    <td align="center"><strong>Skills y extensiones</strong></td>
  </tr>
</table>

<a id="quick-start"></a>
## Inicio rápido

### Instalación en Windows

Abre [Releases](https://github.com/lfyxhappy/lfcode/releases), descarga `lfcode-win-x64.exe` de la versión más reciente y ejecuta el instalador.

### Comando principal

`lfcode` es el comando oficial de la CLI:

```bash
lfcode
lfcode --help
```

### Ejecutar desde el código fuente

El desarrollo local requiere Bun. Ejecuta en la terminal:

```bash
git clone https://github.com/lfyxhappy/lfcode.git
cd lfcode
bun install
bun run dev
```

## Arquitectura y extensibilidad

El repositorio es un monorepo Bun. El runtime está en `packages/lfcode`, la interfaz web en `packages/app`, el host Electron en `packages/desktop`, la UI compartida en `packages/ui` y el SDK de JavaScript en `packages/sdk/js`. LFCODE se amplía con Skills, herramientas MCP, complementos, comandos y automatizaciones.

## Compatibilidad

Para mantener los flujos antiguos, siguen disponibles algunos identificadores históricos y el alias `opencode`. En la documentación nueva y el uso diario, utiliza el nombre LFCODE y el comando `lfcode`.

## Contribución y soporte

Las contribuciones son bienvenidas. Usa [Issues](https://github.com/lfyxhappy/lfcode/issues) para errores y propuestas, y consulta [Releases](https://github.com/lfyxhappy/lfcode/releases) para descargas y cambios.

LFCODE se publica bajo la [licencia MIT](LICENSE).
