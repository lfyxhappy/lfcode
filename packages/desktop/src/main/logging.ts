import log from "electron-log/main.js"
import { readFileSync } from "node:fs"
import { readdir, stat, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"

const MAX_LOG_AGE_DAYS = 7
const TAIL_LINES = 1000
let cleanupStarted = false

export function initLogging() {
  log.transports.file.maxSize = 5 * 1024 * 1024
  return log
}

export function startLogCleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  void cleanup()
}

export function tail(): string {
  try {
    const path = log.transports.file.getFile().path
    const contents = readFileSync(path, "utf8")
    const lines = contents.split("\n")
    return lines.slice(Math.max(0, lines.length - TAIL_LINES)).join("\n")
  } catch {
    return ""
  }
}

async function cleanup() {
  const path = log.transports.file.getFile().path
  const dir = dirname(path)
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000

  const entries = await readdir(dir).catch(() => [])
  await Promise.all(entries.map(async (entry) => {
    const file = join(dir, entry)
    const info = await stat(file).catch(() => undefined)
    if (!info?.isFile()) return
    if (info.mtimeMs >= cutoff) return
    await unlink(file).catch(() => undefined)
  }))
}
