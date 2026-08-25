import { constants } from "node:fs"
import { copyFile, lstat, mkdir, readdir } from "node:fs/promises"
import path from "path"
import { Global } from "@/global"

export type LegacyMigration = {
  copied: string[]
  preserved: string[]
}

export function usesRootLayout() {
  const data = Global.Path.data
  const config = Global.Path.config
  return (
    path.basename(data) === "data" &&
    (process.env.LFCODE_DATA_DIR !== undefined ||
      (path.basename(config) === "config" && path.dirname(config) === path.dirname(data)))
  )
}

export function profileRoot() {
  return usesRootLayout() ? path.dirname(Global.Path.data) : Global.Path.config
}

export function root() {
  return path.join(profileRoot(), "plugins")
}

export function data(id: string) {
  return path.join(root(), id, "data")
}

export function isProfileRoot(dir: string) {
  return samePath(dir, profileRoot())
}

export async function migrateLegacyPlugins(input: { source?: string; target?: string } = {}): Promise<LegacyMigration> {
  const source = input.source ?? (usesRootLayout() ? path.join(profileRoot(), "config", "plugins") : root())
  const target = input.target ?? root()
  const copied: string[] = []
  const preserved: string[] = []
  if (samePath(source, target)) return { copied, preserved }
  await copyMissing(source, target, copied, preserved)
  return { copied, preserved }
}

async function copyMissing(source: string, target: string, copied: string[], preserved: string[]): Promise<void> {
  const sourceInfo = await lstat(source).catch(() => undefined)
  if (!sourceInfo || sourceInfo.isSymbolicLink()) return

  const targetInfo = await lstat(target).catch(() => undefined)
  if (sourceInfo.isDirectory()) {
    if (targetInfo && !targetInfo.isDirectory()) {
      preserved.push(target)
      return
    }
    await mkdir(target, { recursive: true })
    await Promise.all((await readdir(source)).map((entry) => copyMissing(path.join(source, entry), path.join(target, entry), copied, preserved)))
    return
  }

  if (!sourceInfo.isFile()) return
  if (targetInfo) {
    preserved.push(target)
    return
  }

  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(source, target, constants.COPYFILE_EXCL).then(
    () => copied.push(target),
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        preserved.push(target)
        return
      }
      throw error
    },
  )
}

function samePath(left: string, right: string) {
  const normalized = [path.resolve(left), path.resolve(right)]
  if (process.platform === "win32") return normalized[0].toLowerCase() === normalized[1].toLowerCase()
  return normalized[0] === normalized[1]
}

export * as PluginPath from "./path"
