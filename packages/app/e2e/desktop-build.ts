import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const desktopOutSentinel = `${root}/packages/desktop/out/main/index.js`
const buildKey = createHash("sha1").update(root).digest("hex").slice(0, 12)
const buildLockDir = join(tmpdir(), `lfcode-desktop-build-${buildKey}.lock`)
const desktopBuildInputs = [
  "package.json",
  "bun.lock",
  "packages/app/package.json",
  "packages/desktop/package.json",
  "packages/ui/package.json",
  "packages/app/src",
  "packages/desktop/src",
  "packages/desktop/scripts",
  "packages/ui/src",
]

let desktopBuildPromise: Promise<void> | undefined

export function ensureDesktopBuild() {
  desktopBuildPromise ??= ensureDesktopBuildShared()
  return desktopBuildPromise
}

async function ensureDesktopBuildShared() {
  if (await isDesktopBuildReady()) return

  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const lockAcquired = await mkdir(buildLockDir).then(
      () => true,
      () => false,
    )
    if (lockAcquired) {
      try {
        if (await isDesktopBuildReady()) return
        await buildDesktop()
        return
      } finally {
        await rm(buildLockDir, { recursive: true, force: true }).catch(() => {})
      }
    }
    if (await isDesktopBuildReady()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Timed out waiting for shared desktop build")
}

async function isDesktopBuildReady() {
  if (process.env.PLAYWRIGHT_FORCE_DESKTOP_BUILD === "1") return false

  const out = await stat(desktopOutSentinel).catch(() => undefined)
  if (!out) return false

  const latestInputMtime = await readLatestInputMtime()
  return out.mtimeMs >= latestInputMtime
}

async function buildDesktop() {
  await execFileAsync("bun", ["run", "build"], {
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
    },
  })
}

async function readLatestInputMtime() {
  const mtimes = await Promise.all(desktopBuildInputs.map((input) => readEntryMtime(resolve(root, input))))
  return Math.max(...mtimes, 0)
}

async function readEntryMtime(path: string): Promise<number> {
  const entry = await stat(path).catch(() => undefined)
  if (!entry) return 0
  if (!entry.isDirectory()) return entry.mtimeMs

  const children = await readdir(path, { withFileTypes: true }).catch(() => [])
  if (children.length === 0) return entry.mtimeMs
  const childMtimes = await Promise.all(
    children
      .filter((child) => child.name !== "node_modules" && child.name !== "dist" && child.name !== "out")
      .map((child) => readEntryMtime(join(path, child.name))),
  )
  return Math.max(entry.mtimeMs, ...childMtimes)
}
