#!/usr/bin/env bun
import { $ } from "bun"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const target = "C:\\算法\\小应用\\Lfcodepre"
const preDataRoot = "C:\\Users\\liangfeng\\.lfcodepre"
const workspace = path.resolve(import.meta.dirname, "..", "..", "..")
const tavernSource = path.join(workspace, "packages", "tavern")
const tavernTarget = path.join(preDataRoot, "plugins", "lfcode-tavern")
const imageMakerSource = path.join(workspace, "packages", "imagemaker")
const imageMakerTarget = path.join(preDataRoot, "plugins", "lfcode-imagemaker")

if (process.platform !== "win32") {
  console.log("Skipping pre-release Windows sync on non-Windows platform.")
  process.exit(0)
}

await $`bun ./scripts/sync-win-use-copy.ts`.env({
  ...process.env,
  LFCODE_EXECUTABLE_NAME: "LfcodePre.exe",
  LFCODE_USE_COPY_DIR: target,
})

// Compose Skills were removed from discovery. Drop their obsolete pre-release
// cache so a synced test installation contains only the standard Skill layout.
await rm(path.join(preDataRoot, "data", "compose"), { recursive: true, force: true })

await mkdir(tavernTarget, { recursive: true })
await $`bun build --target=node --format=esm --outfile ${path.join(tavernTarget, "index.js")} ${path.join(tavernSource, "src", "index.ts")}`
await cp(path.join(tavernSource, "skills"), path.join(tavernTarget, "skills"), { recursive: true, force: true })

// The installed plugin has no source tree, so point its location entry at the
// bundled ESM file while preserving private Tavern data under data/.
const manifest = JSON.parse(await readFile(path.join(tavernSource, "package.json"), "utf8")) as Record<string, unknown>
const lfcode = manifest.lfcode as { entrypoints?: Record<string, unknown> } | undefined
if (!lfcode?.entrypoints?.location) {
  throw new Error("Tavern package must declare a location entrypoint")
}
lfcode.entrypoints.location = { path: "./index.js" }
await writeFile(path.join(tavernTarget, "package.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8")

await mkdir(imageMakerTarget, { recursive: true })
await $`bun build --target=node --format=esm --outfile ${path.join(imageMakerTarget, "index.js")} ${path.join(imageMakerSource, "src", "index.ts")}`
await rm(path.join(imageMakerTarget, "skills"), { recursive: true, force: true })
await cp(path.join(imageMakerSource, "skills"), path.join(imageMakerTarget, "skills"), { recursive: true, force: true })

const imageMakerManifest = JSON.parse(await readFile(path.join(imageMakerSource, "package.json"), "utf8")) as Record<string, unknown>
const imageMakerLfcode = imageMakerManifest.lfcode as { entrypoints?: Record<string, unknown> } | undefined
if (!imageMakerLfcode?.entrypoints?.location) {
  throw new Error("ImageMaker package must declare a location entrypoint")
}
imageMakerLfcode.entrypoints.location = { path: "./index.js" }
await writeFile(path.join(imageMakerTarget, "package.json"), JSON.stringify(imageMakerManifest, null, 2) + "\n", "utf8")
