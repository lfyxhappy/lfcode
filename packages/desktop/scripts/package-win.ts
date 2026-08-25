#!/usr/bin/env bun
import { $ } from "bun"

if (process.platform !== "win32") {
  console.log("Skipping Windows package on non-Windows platform.")
  process.exit(0)
}

console.log("[package:win] preserving runtime data")
await $`bun run preserve-runtime`

try {
  console.log("[package:win] cleaning dist")
  await $`bun run clean:dist`
  console.log("[package:win] refreshing packaged config")
  await $`bun run preserve-config`
  console.log("[package:win] building application")
  await $`bun run build`
  console.log("[package:win] staging bundled Python")
  await $`bun ./scripts/prepare-bundled-python.ts`
  console.log("[package:win] staging bundled Git")
  await $`bun ./scripts/prepare-bundled-git.ts`
  console.log("[package:win] preparing CodeGraph runtime")
  await $`bun ./scripts/codegraph-runtime.ts`
  console.log("[package:win] running electron-builder")
  await $`electron-builder --win --publish never --config electron-builder.config.ts`
} finally {
  console.log("[package:win] restoring runtime data")
  await $`bun run restore-runtime`
}

console.log("[package:win] pruning dist")
await $`bun ./scripts/prune-win-dist.ts`
console.log("[package:win] cleaning bundled Python")
await $`bun ./scripts/cleanup-bundled-python.ts`
console.log("[package:win] cleaning bundled Git")
await $`bun ./scripts/cleanup-bundled-git.ts`
