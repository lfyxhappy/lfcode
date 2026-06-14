#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import path from "node:path"

const distDir = path.resolve(import.meta.dir, "../dist")

if (!existsSync(distDir)) process.exit(0)

function shouldRemove(name: string) {
  if (name === "builder-debug.yml") return true
  if (name === "latest.json") return true
  if (/^latest.*\.yml$/i.test(name)) return true
  if (/\.(exe|blockmap|dmg|zip|deb|rpm|AppImage)$/i.test(name)) return true
  if (/\.tar\.gz$/i.test(name)) return true
  return false
}

for (const entry of await readdir(distDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  if (!shouldRemove(entry.name)) continue
  await rm(path.join(distDir, entry.name), { force: true })
}

console.log(`Cleaned stale packaged artifacts from ${distDir}`)
