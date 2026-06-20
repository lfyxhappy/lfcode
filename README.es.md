<p align="center">
  <a href="https://github.com/lfyxhappy/lfcode">
    <picture>
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/brand/lfcode-wordmark-light.svg" alt="Lfcode logo">
    </picture>
  </a>
</p>
<p align="center">El agente de programacion con IA de codigo abierto.</p>
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

> Este README refleja el estado actual del repositorio de Lfcode para que los enlaces de descarga, los artefactos de publicación y las notas de compatibilidad sigan siendo correctos.

### Descripción general

Lfcode es un monorepo de Bun workspace que evolucionó a partir de opencode. Conserva la superficie de compatibilidad histórica y sigue ofreciendo la marca Lfcode, una app de escritorio, una interfaz web, un SDK y soporte para GitHub Actions.

### Aspectos destacados

- Gestión de sesiones más completa: listar, estado, crear, actualizar, eliminar, bifurcar, compartir, quitar el uso compartido, resumir, compactar, diff, revertir y restaurar.
- Más modos de interacción: envío de mensajes, `prompt` asíncrono, `shell`, comandos y predicción del siguiente prompt.
- Gestión de Skills: listar, descubrir, instalar, importar, crear, actualizar y revisar directorios de Skills locales.
- Integración con GitHub Actions: activa trabajo automatizado desde comentarios en issues o PRs con `/lfcode`, `/opencode` o `/oc`.
- Compatibilidad histórica: conserva el comando CLI `opencode`, las variables de entorno `LFCODE_*` y el protocolo `lfcode://`.

### Instalación

Las descargas públicas se publican en la página de [GitHub Releases](https://github.com/lfyxhappy/lfcode/releases).

- Escritorio: la canalización de publicación actual genera un instalador de Windows llamado `lfcode-win-x64.exe`.
- Código fuente: usa Bun desde la raíz del repositorio para el desarrollo local.

```bash
bun install
bun run dev
bun run dev:web
bun run dev:desktop
```

### Compatibilidad

Varios identificadores en tiempo de ejecución siguen usando el nombre histórico `opencode` por compatibilidad.

- Comando CLI: `opencode`
- Directorio de configuración: `~/.lfcode`
- Variables de entorno: `LFCODE_*`
- Esquema de protocolo de escritorio: `lfcode://`

### Estructura del repositorio

- `packages/lfcode`: núcleo de ejecución y motor de sesiones
- `packages/app`: interfaz web
- `packages/desktop`: host de escritorio Electron
- `packages/ui`: componentes de UI compartidos
- `packages/sdk/js`: SDK de JavaScript

### Documentación

La fuente actual de documentación está en [packages/web/src/content/docs](packages/web/src/content/docs).

### Validación

Ejecuta las comprobaciones principales del repositorio desde la raíz del workspace:

```bash
bun run lint
bun run typecheck
```

### Soporte

- Issues: [github.com/lfyxhappy/lfcode/issues](https://github.com/lfyxhappy/lfcode/issues)
- Releases: [github.com/lfyxhappy/lfcode/releases](https://github.com/lfyxhappy/lfcode/releases)