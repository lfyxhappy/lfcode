import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

const manifestName = ".lfcode-stage.json"

export async function directorySize(dir: string): Promise<number> {
  const info = await stat(dir)
  if (!info.isDirectory()) return info.size
  const entries = await readdir(dir, { withFileTypes: true })
  const sizes = await Promise.all(entries.map((entry) => directorySize(path.join(dir, entry.name))))
  return sizes.reduce((sum, size) => sum + size, 0)
}

export async function buildStageStamp(source: string, entries: string[]) {
  const items = await Promise.all(entries.map((entry) => collectStageEntry(source, entry)))
  return JSON.stringify({
    version: 1,
    source,
    items,
  })
}

export async function reuseStagedRuntime(
  target: string,
  validate: (dir: string) => boolean,
  source: string,
  stamp: string,
) {
  if (!validate(target)) return false
  const manifest = await readStageManifest(target)
  return manifest?.source === source && manifest.stamp === stamp
}

export async function writeStageManifest(target: string, source: string, stamp: string) {
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, manifestName), JSON.stringify({ source, stamp }))
}

async function readStageManifest(target: string) {
  const manifestPath = path.join(target, manifestName)
  if (!existsSync(manifestPath)) return
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"))
    if (typeof parsed?.source !== "string") return
    if (typeof parsed?.stamp !== "string") return
    return parsed as { source: string; stamp: string }
  } catch {
    return
  }
}

async function collectStageEntry(source: string, entry: string): Promise<unknown> {
  const absolute = path.join(source, entry)
  if (!existsSync(absolute)) return { path: entry, missing: true }
  const info = await stat(absolute)
  if (info.isDirectory()) {
    const children = await readdir(absolute, { withFileTypes: true })
    return {
      path: entry,
      type: "dir",
      children: await Promise.all(
        children
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((child) => collectStageEntry(source, path.join(entry, child.name))),
      ),
    }
  }
  return {
    path: entry,
    type: "file",
    size: info.size,
    mtimeMs: info.mtimeMs,
  }
}
