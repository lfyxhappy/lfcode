import path from "path"
import { existsSync } from "node:fs"
import { PluginPath } from "@/plugin/path"
import { getRuntimeActivationTarget } from "@/runtime-registry/config"
import { Filesystem } from "@/util"
import { which } from "@/util/which"

const BUNDLED_CXX_ENV = "LFCODE_CXX_PATH"

export type CppCommand = {
  command: string
  args: string[]
}

export function managedCppRoot() {
  return PluginPath.data("runtime-cpp")
}

export function managedCppExecutable(root = managedCppRoot()) {
  return path.join(root, "bin", process.platform === "win32" ? "g++.exe" : "g++")
}

export function managedCppBinDir(root = managedCppRoot()) {
  return path.dirname(managedCppExecutable(root))
}

function compilerFromEnv() {
  const configured = process.env[BUNDLED_CXX_ENV]
  if (!configured) return
  if (!existsSync(configured)) return
  return {
    command: configured,
    args: [],
  } satisfies CppCommand
}

function managedCompiler() {
  const resolved = Filesystem.windowsPath(managedCppExecutable())
  if (!Filesystem.stat(resolved)?.isFile()) return
  return {
    command: resolved,
    args: [],
  } satisfies CppCommand
}

function systemCompiler() {
  const candidates = process.platform === "win32" ? ["g++.exe", "g++", "clang++.exe", "clang++"] : ["g++", "clang++"]
  for (const candidate of candidates) {
    const resolved = which(candidate)
    if (!resolved) continue
    return {
      command: resolved,
      args: [],
    } satisfies CppCommand
  }
}

export function resolveCppCommand() {
  const configured = compilerFromEnv()
  const managed = managedCompiler()
  const system = systemCompiler()
  const preferred = getRuntimeActivationTarget("cpp-compiler")
  if (preferred === "system") return system ?? configured ?? managed
  if (preferred === "managed") return managed ?? configured ?? system
  return configured ?? managed ?? system
}

export function formatCppCommand(input: CppCommand) {
  return [input.command, ...input.args].join(" ")
}

export function isManagedCppCommand(command: CppCommand | undefined) {
  if (!command) return false
  const managedRoot = normalize(managedCppRoot())
  const file = normalize(command.command)
  return file.startsWith(`${managedRoot}/`) || file === managedRoot
}

export function refreshManagedCppEnvironment() {
  const compiler = managedCompiler()
  if (!compiler) {
    delete process.env.LFCODE_CXX_PATH
    return
  }
  process.env.LFCODE_CXX_PATH = compiler.command
  prependPath(managedCppBinDir())
}

export function cppProcessEnv(command: CppCommand | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!isManagedCppCommand(command)) return env
  return withPrependedPath(env, managedCppBinDir(path.dirname(path.dirname(command!.command))))
}

export function defaultCppOutputPath(root: string, entry: string) {
  const stem = path.basename(entry, path.extname(entry)) || "program"
  const suffix = process.platform === "win32" ? ".exe" : ""
  return path.join(root, ".lfcode", "build", "cpp", `${stem}${suffix}`)
}

function quotePwsh(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildCppCompileCommand(input: {
  compiler: CppCommand
  sourcePath: string
  outputPath: string
  compilerArgs?: string[]
}) {
  const args = [
    ...input.compiler.args,
    quotePwsh(input.sourcePath),
    "-std=c++20",
    ...(input.compilerArgs ?? []),
    "-o",
    quotePwsh(input.outputPath),
  ]
  const prefix = buildCppEnvironmentPrefix(input.compiler)
  const compile = `& ${quotePwsh(input.compiler.command)} ${args.join(" ")}`
  return prefix ? `${prefix}; ${compile}` : compile
}

export function buildCppRunCommand(input: {
  compiler: CppCommand
  sourcePath: string
  outputPath: string
  args?: string[]
  compilerArgs?: string[]
}) {
  const compile = buildCppCompileCommand(input)
  const runArgs = (input.args ?? []).map(quotePwsh).join(" ")
  const execute = `& ${quotePwsh(input.outputPath)}${runArgs ? ` ${runArgs}` : ""}`
  return `${compile}; if ($?) { ${execute} }`
}

function buildCppEnvironmentPrefix(compiler: CppCommand) {
  if (!isManagedCppCommand(compiler)) return ""
  const binDir = managedCppBinDir(path.dirname(path.dirname(compiler.command)))
  return `$env:PATH = ${quotePwsh(binDir)} + ';' + $env:PATH`
}

function prependPath(dir: string) {
  const next = withPrependedPath(process.env, dir)
  process.env.PATH = next.PATH
  process.env.Path = next.Path
}

function withPrependedPath(env: NodeJS.ProcessEnv, dir: string) {
  const separator = process.platform === "win32" ? ";" : ":"
  const current = env.PATH ?? env.Path ?? ""
  const items = current
    .split(separator)
    .filter(Boolean)
    .map(normalize)
  if (items.includes(normalize(dir))) return { ...env }
  return {
    ...env,
    PATH: current ? `${dir}${separator}${current}` : dir,
    Path: current ? `${dir}${separator}${current}` : dir,
  }
}

function normalize(value: string) {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase()
}
