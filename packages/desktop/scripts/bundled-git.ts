import { copyFile, mkdir, readdir, rm } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { buildStageStamp, directorySize, reuseStagedRuntime, writeStageManifest } from "./bundled-stage"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const desktopDir = path.join(rootDir, "packages", "desktop")
const stageDir = path.join(desktopDir, ".bundled-git")
const directoryEntries = [
  "cmd",
  "mingw64/bin",
  "mingw64/etc",
  "mingw64/lib",
  "mingw64/libexec",
  "mingw64/share/git-core",
  "etc",
  "usr/bin",
  "usr/lib/ssh",
  "usr/lib/terminfo",
  "usr/libexec",
  "usr/share/terminfo",
  "usr/ssl",
] as const
const rootFiles = ["LICENSE.txt"] as const

export function bundledGitStageDir() {
  return stageDir
}

export function resolveBundledGitStageDir() {
  return isBundledGitDir(stageDir) ? stageDir : undefined
}

export function resolveBundledGitSourceDir() {
  if (process.platform !== "win32") return
  const candidates = [
    process.env.LFCODE_BUNDLED_GIT_DIR,
    ...resolveGitRootsFromWhere(),
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git") : undefined,
    process.env.ProgramW6432 ? path.join(process.env.ProgramW6432, "Git") : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Git") : undefined,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (isBundledGitDir(candidate)) return candidate
  }
}

export function isBundledGitDir(dir: string) {
  return (
    existsSync(path.join(dir, "cmd", "git.exe")) ||
    (existsSync(path.join(dir, "mingw64", "bin", "git.exe")) && existsSync(path.join(dir, "mingw64", "libexec")))
  )
}

export async function stageBundledGitRuntime() {
  if (process.platform !== "win32") return
  const source = resolveBundledGitSourceDir()
  if (!source) {
    throw new Error(
      "Git for Windows was not found on this Windows packaging machine. Install Git for Windows or set LFCODE_BUNDLED_GIT_DIR before packaging.",
    )
  }
  return stageBundledGitRuntimeFrom(source, stageDir)
}

export async function stageBundledGitRuntimeFrom(source: string, target: string) {
  const stamp = await buildStageStamp(source, [...directoryEntries, ...rootFiles])
  if (await reuseStagedRuntime(target, isBundledGitDir, source, stamp)) {
    return {
      source,
      stage: target,
      sizeBytes: await directorySize(target),
      reused: true,
    }
  }

  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })

  for (const entry of directoryEntries) {
    const src = path.join(source, entry)
    if (!existsSync(src)) continue
    const dest = path.join(target, entry)
    await copyDirectory(src, dest)
  }

  for (const file of rootFiles) {
    const src = path.join(source, file)
    if (!existsSync(src)) continue
    await mkdir(path.dirname(path.join(target, file)), { recursive: true })
    await copyFile(src, path.join(target, file))
  }

  await writeStageManifest(target, source, stamp)

  return {
    source,
    stage: target,
    sizeBytes: await directorySize(target),
    reused: false,
  }
}

function resolveGitRootsFromWhere() {
  if (process.platform !== "win32") return []
  try {
    const output = execFileSync("where.exe", ["git.exe"], { encoding: "utf8", windowsHide: true })
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const directory = path.dirname(line)
        const direct = path.resolve(directory, "..")
        const nested = path.resolve(directory, "..", "..")
        return [direct, nested]
      })
      .filter((item, index, list) => list.indexOf(item) === index)
  } catch {
    return []
  }
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name)
    const dest = path.join(target, entry.name)
    if (entry.isDirectory()) {
      await copyDirectory(src, dest)
      continue
    }
    await mkdir(path.dirname(dest), { recursive: true })
    await copyFile(src, dest)
  }
}

export function hasBundledGitRecommendedTools(dir: string) {
  return (
    existsSync(path.join(dir, "usr", "bin", "ssh.exe")) &&
    existsSync(path.join(dir, "usr", "bin", "less.exe")) &&
    (existsSync(path.join(dir, "cmd", "git.exe")) || existsSync(path.join(dir, "mingw64", "bin", "git.exe")))
  )
}

export function bundledGitSourceEntries(dir: string) {
  return readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name).sort()
}
