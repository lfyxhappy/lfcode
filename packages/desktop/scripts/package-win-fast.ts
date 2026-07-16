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

await $`bun run clean:dist`.env(env)
await $`bun run preserve-config`.env(env)
await $`bun run build`.env(env)
await $`bun ./scripts/prepare-bundled-python.ts`.env(env)
await $`bun ./scripts/prepare-bundled-git.ts`.env(env)
await $`electron-builder --win --dir --publish never --config electron-builder.config.ts`.env(env)
