#!/usr/bin/env bun
import { $ } from "bun"

if (process.platform !== "win32") {
  console.log("Skipping fast Windows package on non-Windows platform.")
  process.exit(0)
}

const env = {
  ...process.env,
  LFCODE_FAST_PACKAGE: "true",
}

console.log("[package:win:fast] cleaning dist")
await $`bun run clean:dist`.env(env)
console.log("[package:win:fast] refreshing packaged config")
await $`bun run preserve-config`.env(env)
console.log("[package:win:fast] building application")
await $`bun run build`.env(env)
console.log("[package:win:fast] staging bundled Python")
await $`bun ./scripts/prepare-bundled-python.ts`.env(env)
console.log("[package:win:fast] staging bundled Git")
await $`bun ./scripts/prepare-bundled-git.ts`.env(env)
console.log("[package:win:fast] preparing CodeGraph runtime")
await $`bun ./scripts/codegraph-runtime.ts`.env(env)
console.log("[package:win:fast] running electron-builder")
await $`bunx electron-builder --win --dir --publish never --config electron-builder.config.ts`.env(env)
