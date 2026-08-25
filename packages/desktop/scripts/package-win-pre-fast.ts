#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { cp, rm } from "node:fs/promises"
import { $ } from "bun"

if (process.platform !== "win32") {
  console.log("Skipping pre-release Windows package on non-Windows platform.")
  process.exit(0)
}

const env = {
  ...process.env,
  LFCODE_CHANNEL: "stable",
  LFCODE_FAST_PACKAGE: "true",
  LFCODE_PRE_RELEASE: "true",
}

console.log("[package:win:pre:fast] cleaning dist")
await $`bun run clean:dist`.env(env)
await rm("dist/win-unpacked", { recursive: true, force: true })
console.log("[package:win:pre:fast] refreshing packaged config")
await $`bun run preserve-config`.env(env)
console.log("[package:win:pre:fast] building application")
await $`bun run build`.env(env)
console.log("[package:win:pre:fast] applying blue pre-release icon")
await rm("resources/icons", { recursive: true, force: true })
await cp("icons/dev", "resources/icons", { recursive: true })
console.log("[package:win:pre:fast] staging bundled Python")
await $`bun ./scripts/prepare-bundled-python.ts`.env(env)
console.log("[package:win:pre:fast] staging bundled Git")
await $`bun ./scripts/prepare-bundled-git.ts`.env(env)
console.log("[package:win:pre:fast] preparing CodeGraph runtime")
await $`bun ./scripts/codegraph-runtime.ts`.env(env)
console.log("[package:win:pre:fast] running electron-builder")
await $`bunx electron-builder --win --dir --publish never --config electron-builder.config.ts`.env(env)
const archive = "dist/win-unpacked/resources/app.asar"
if (!existsSync(archive)) throw new Error(`Packaged app archive not found: ${archive}`)
const contents = await $`bunx asar list ${archive}`.text()
if (!contents.includes("\\out\\main\\index.js")) {
  throw new Error("Packaged app archive is missing the Electron main entrypoint")
}

// The shell tool parses PowerShell/Bash commands with web-tree-sitter at
// runtime. These assets are emitted by the node build and copied by the
// electron-vite plugin; accepting a package without them produces an ENOENT
// during the first shell call (and used to terminate the main process).
const requiredShellWasm = [
  "\\out\\main\\tree-sitter-",
  "\\out\\main\\tree-sitter-bash-",
  "\\out\\main\\tree-sitter-powershell-",
]
for (const prefix of requiredShellWasm) {
  if (!contents.split(/\r?\n/).some((entry) => entry.startsWith(prefix) && entry.endsWith(".wasm"))) {
    throw new Error(`Packaged app archive is missing required shell parser asset: ${prefix}*.wasm`)
  }
}
