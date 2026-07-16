import { existsSync, readdirSync } from "fs"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util"
import { which } from "@/util/which"

const BUNDLED_PYTHON_ENV = "LFCODE_PYTHON_PATH"
const MANAGED_PYTHON_ENV = "LFCODE_MANAGED_PYTHON_PATH"

export type PythonCommand = {
  command: string
  args: string[]
}

export type ManagedPythonCommand = PythonCommand & {
  source: "env" | "managed"
}

export function managedPythonRoot() {
  return path.join(Global.Path.data, "python", "runtime")
}

export function managedPythonExecutable(root = managedPythonRoot()) {
  return path.join(root, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python")
}

export function managedPythonScriptsDirectory(root = managedPythonRoot()) {
  return path.dirname(managedPythonExecutable(root))
}

function managedPythonFromEnv() {
  const configured = process.env[MANAGED_PYTHON_ENV]
  if (!configured) return
  const resolved = Filesystem.windowsPath(configured)
  if (Filesystem.stat(resolved)?.isFile()) {
    return {
      command: resolved,
      args: [],
      source: "env",
    } satisfies ManagedPythonCommand
  }
}

function managedPython() {
  const resolved = Filesystem.windowsPath(managedPythonExecutable())
  if (!Filesystem.stat(resolved)?.isFile()) return
  return {
    command: resolved,
    args: [],
    source: "managed",
  } satisfies ManagedPythonCommand
}

function pythonFromEnv() {
  const configured = process.env[BUNDLED_PYTHON_ENV]
  if (!configured) return
  const resolved = Filesystem.windowsPath(configured)
  if (Filesystem.stat(resolved)?.isFile()) {
    return {
      command: resolved,
      args: [],
    } satisfies PythonCommand
  }
}

function bundledPython() {
  if (process.platform !== "win32") return
  const resourcesPath = "resourcesPath" in process && typeof process.resourcesPath === "string" ? process.resourcesPath : undefined
  const candidates = [
    resourcesPath ? path.join(resourcesPath, "python", "python.exe") : undefined,
    path.join(path.dirname(process.execPath), "python", "python.exe"),
    path.join(path.dirname(process.execPath), "..", "python", "python.exe"),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = Filesystem.windowsPath(candidate)
    if (Filesystem.stat(resolved)?.isFile()) {
      return {
        command: resolved,
        args: [],
      } satisfies PythonCommand
    }
  }
}

function systemPython() {
  const candidates =
    process.platform === "win32"
      ? ["python.exe", "python", "py.exe", "py"]
      : ["python3", "python"]
  for (const candidate of candidates) {
    const resolved = which(candidate)
    if (!resolved) continue
    if (process.platform === "win32" && path.win32.basename(resolved).toLowerCase() === "py.exe") {
      return {
        command: resolved,
        args: ["-3"],
      } satisfies PythonCommand
    }
    return {
      command: resolved,
      args: [],
    } satisfies PythonCommand
  }
}

export function resolveBasePythonCommand() {
  return pythonFromEnv() ?? bundledPython() ?? systemPython()
}

export function resolveManagedPythonCommandEntry() {
  return managedPythonFromEnv() ?? managedPython()
}

export function resolveManagedPythonCommand() {
  const command = resolveManagedPythonCommandEntry()
  if (!command) return
  return {
    command: command.command,
    args: command.args,
  } satisfies PythonCommand
}

export function resolvePythonCommand() {
  return resolveManagedPythonCommand() ?? resolveBasePythonCommand()
}

export function formatPythonCommand(input: PythonCommand) {
  return [input.command, ...input.args].join(" ")
}

export function isBundledPythonDir(dir: string) {
  if (!dir) return false
  if (!existsSync(path.join(dir, "python.exe"))) return false
  if (existsSync(path.join(dir, "Lib", "os.py"))) return true
  try {
    return readdirSync(dir).some((name) => /^python\d+\.dll$/i.test(name))
  } catch {
    return false
  }
}
