#!/usr/bin/env bun
import { readdir, rm } from "node:fs/promises"
import path from "node:path"

const distDir = path.resolve(import.meta.dir, "../dist")

for (const entry of await readdir(distDir, { withFileTypes: true }).catch(() => [])) {
  if (entry.isFile() && /^lfcode-win-.*\.exe$/i.test(entry.name)) continue
  await rm(path.join(distDir, entry.name), { recursive: true, force: true })
}

console.log(`Pruned Windows dist artifacts to installer only: ${distDir}`)
