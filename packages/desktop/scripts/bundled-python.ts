import { cp, mkdir, readdir, rm } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { buildStageStamp, directorySize, reuseStagedRuntime, writeStageManifest } from "./bundled-stage"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const desktopDir = path.join(rootDir, "packages", "desktop")
const stageDir = path.join(desktopDir, ".bundled-python")
const excludedLibEntries = new Set([
  "__pycache__",
  "idlelib",
  "site-packages",
  "test",
  "tests",
  "tkinter",
  "turtledemo",
])

export function bundledPythonStageDir() {
  return stageDir
}

export function resolveBundledPythonStageDir() {
  return isBundledPythonDir(stageDir) ? stageDir : undefined
}

export function resolveBundledPythonSourceDir() {
  if (process.platform !== "win32") return
  const whereMatches = resolvePythonDirsFromWhere()
  const candidates = [
    process.env.LFCODE_BUNDLED_PYTHON_DIR,
    process.env.LFCODE_PYTHON_PATH ? path.dirname(process.env.LFCODE_PYTHON_PATH) : undefined,
    ...resolvePythonDirsFromRoots(),
    ...whereMatches,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (isBundledPythonDir(candidate)) return candidate
  }
}

export function isBundledPythonDir(dir: string) {
  if (!existsSync(path.join(dir, "python.exe"))) return false
  if (existsSync(path.join(dir, "Lib", "os.py"))) return true
  try {
    return readdirSync(dir).some((name) => /^python\d+\.dll$/i.test(name))
  } catch {
    return false
  }
}

export async function stageBundledPythonRuntime() {
  if (process.platform !== "win32") return
  const source = resolveBundledPythonSourceDir()
  if (!source) {
    throw new Error(
      "Python was not found on this Windows packaging machine. Install a full Python runtime or set LFCODE_BUNDLED_PYTHON_DIR before packaging.",
    )
  }
  return stageBundledPythonRuntimeFrom(source, stageDir)
}

export async function stageBundledPythonRuntimeFrom(source: string, target: string) {
  const rootEntries = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => !entry.isDirectory() && shouldCopyRootFile(entry.name))
    .map((entry) => entry.name)
  const libEntries = (await readdir(path.join(source, "Lib"), { withFileTypes: true }).catch(() => []))
    .filter((entry) => !excludedLibEntries.has(entry.name))
    .map((entry) => path.join("Lib", entry.name))
  const stamp = await buildStageStamp(source, [...rootEntries, "DLLs", "libs", ...libEntries])
  if (await reuseStagedRuntime(target, isBundledPythonDir, source, stamp)) {
    return {
      source,
      stage: target,
      sizeBytes: await directorySize(target),
      reused: true,
    }
  }

  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name)
    const dest = path.join(target, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === "DLLs") {
        await cp(src, dest, { recursive: true })
        continue
      }
      if (entry.name === "Lib") {
        await copyFilteredLib(src, dest)
        continue
      }
      if (entry.name === "libs") {
        await cp(src, dest, { recursive: true })
        continue
      }
      continue
    }

    if (shouldCopyRootFile(entry.name)) {
      await cp(src, dest)
    }
  }

  await mkdir(path.join(target, "Lib", "site-packages"), { recursive: true })
  await mkdir(path.join(target, "Scripts"), { recursive: true })
  await writeStageManifest(target, source, stamp)
  return {
    source,
    stage: target,
    sizeBytes: await directorySize(target),
    reused: false,
  }
}

async function copyFilteredLib(source: string, dest: string) {
  await mkdir(dest, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name)
    const out = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      if (excludedLibEntries.has(entry.name)) continue
      await cp(src, out, {
        recursive: true,
        filter: (item) => path.basename(item) !== "__pycache__",
      })
      continue
    }
    await cp(src, out)
  }
}

function shouldCopyRootFile(name: string) {
  return (
    name === "LICENSE.txt" ||
    name === "pyvenv.cfg" ||
    /^python(?:3(?:\.\d+)?)?\.exe$/i.test(name) ||
    /^python\d+\.dll$/i.test(name) ||
    /^python3\.dll$/i.test(name) ||
    /^vcruntime\d+(_\d+)?\.dll$/i.test(name)
  )
}

function resolvePythonDirsFromWhere() {
  if (process.platform !== "win32") return []
  try {
    const output = execFileSync("where.exe", ["python.exe"], { encoding: "utf8", windowsHide: true })
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => path.dirname(line))
  } catch {
    return []
  }
}

function resolvePythonDirsFromRoots() {
  if (process.platform !== "win32") return []
  const roots = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Python") : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Python") : undefined,
    process.env.ProgramW6432 ? path.join(process.env.ProgramW6432, "Python") : undefined,
  ]
  return roots.flatMap((root) => {
    if (!root || !existsSync(root)) return []
    const direct = existsSync(path.join(root, "python.exe")) ? [root] : []
    const nested = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
    return [...direct, ...nested]
  })
}
