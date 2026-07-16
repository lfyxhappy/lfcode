import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { readLfcodePluginManifest, type PluginCategory, type PluginTrust } from "@lfcode-ai/plugin"
import npa from "npm-package-arg"
import semver from "semver"
import { Filesystem } from "@/util"
import { isRecord } from "@/util/record"
import { Npm } from "@/npm"
import { isManagedPluginSpecifier, resolveManagedPluginTarget } from "./library"

export const DEPRECATED_PLUGIN_PACKAGES: string[] = []

export function isDeprecatedPlugin(spec: string) {
  return DEPRECATED_PLUGIN_PACKAGES.some((pkg) => spec.includes(pkg))
}

function parse(spec: string) {
  try {
    return npa(spec)
  } catch {}
}

export function parsePluginSpecifier(spec: string) {
  const hit = parse(spec)
  if (hit?.type === "alias" && !hit.name) {
    const sub = (hit as npa.AliasResult).subSpec
    if (sub?.name) {
      const version = !sub.rawSpec || sub.rawSpec === "*" ? "latest" : sub.rawSpec
      return { pkg: sub.name, version }
    }
  }
  if (!hit?.name) return { pkg: spec, version: "" }
  if (hit.raw === hit.name) return { pkg: hit.name, version: "latest" }
  return { pkg: hit.name, version: hit.rawSpec }
}

export type PluginSource = "file" | "npm" | "managed"
export type PluginKind = "server" | "tui"
type PluginMode = "strict" | "detect"

export type PluginPackage = {
  dir: string
  pkg: string
  json: Record<string, unknown>
}

export type PluginEntry = {
  spec: string
  source: PluginSource
  target: string
  pkg?: PluginPackage
  entry?: string
}

export type PluginManifestSummary = {
  id?: string
  name?: string
  version?: string
  description?: string
  category?: PluginCategory
  trust?: PluginTrust
  apiVersion?: string
  capabilities?: string[]
  lfcodeRange?: string
  runtimeDependencies?: { id: string; version?: string; required?: boolean }[]
}

const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"]

export function pluginSource(spec: string): PluginSource {
  if (isManagedPluginSpecifier(spec)) return "managed"
  if (isPathPluginSpec(spec)) return "file"
  return "npm"
}

function resolveExportPath(raw: string, dir: string) {
  if (raw.startsWith("file://")) return fileURLToPath(raw)
  if (path.isAbsolute(raw)) return raw
  return path.resolve(dir, raw)
}

function isAbsolutePath(raw: string) {
  return path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)
}

function extractExportValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!isRecord(value)) return undefined
  for (const key of ["import", "default"]) {
    const nested = value[key]
    if (typeof nested === "string") return nested
  }
  return undefined
}

function packageMain(pkg: PluginPackage) {
  const value = pkg.json.main
  if (typeof value !== "string") return
  const next = value.trim()
  if (!next) return
  return next
}

function resolvePackageFile(spec: string, raw: string, kind: string, pkg: PluginPackage) {
  const resolved = resolveExportPath(raw, pkg.dir)
  const root = Filesystem.resolve(pkg.dir)
  const next = Filesystem.resolve(resolved)
  if (!Filesystem.contains(root, next)) {
    throw new Error(`Plugin ${spec} resolved ${kind} entry outside plugin directory`)
  }
  return next
}

function resolvePackagePath(spec: string, raw: string, kind: PluginKind, pkg: PluginPackage) {
  return pathToFileURL(resolvePackageFile(spec, raw, kind, pkg)).href
}

function resolvePackageEntrypoint(spec: string, kind: PluginKind, pkg: PluginPackage) {
  const manifest = readLfcodePluginManifest(pkg.json.lfcode, spec)
  const manifestTarget = kind === "server" ? manifest?.entrypoints.location : manifest?.entrypoints.tui
  if (manifestTarget) {
    return resolvePackagePath(spec, manifestTarget.path, kind, pkg)
  }

  const exports = pkg.json.exports
  if (isRecord(exports)) {
    const raw = extractExportValue(exports[`./${kind}`])
    if (raw) return resolvePackagePath(spec, raw, kind, pkg)
  }

  if (kind !== "server") return
  const main = packageMain(pkg)
  if (!main) return
  return resolvePackagePath(spec, main, kind, pkg)
}

function targetPath(target: string) {
  if (target.startsWith("file:")) return fileSpecifierPath(target)
  if (path.isAbsolute(target)) return target
}

function fileSpecifierPath(spec: string) {
  const raw = spec.slice("file:".length)
  if (!raw.startsWith(".") && (raw.startsWith("/") || isAbsolutePath(raw))) return fileURLToPath(spec)
  return path.resolve(raw)
}

async function resolveDirectoryIndex(dir: string) {
  for (const name of INDEX_FILES) {
    const file = path.join(dir, name)
    if (await Filesystem.exists(file)) return file
  }
}

async function resolveTargetDirectory(target: string) {
  const file = targetPath(target)
  if (!file) return
  const stat = await Filesystem.statAsync(file)
  if (!stat?.isDirectory()) return
  return file
}

async function resolvePluginEntrypoint(spec: string, target: string, kind: PluginKind, pkg?: PluginPackage) {
  const source = pluginSource(spec)
  const hit =
    pkg ?? (source === "npm" ? await readPluginPackage(target) : await readPluginPackage(target).catch(() => undefined))
  if (!hit) return target

  const entry = resolvePackageEntrypoint(spec, kind, hit)
  if (entry) return entry

  const dir = await resolveTargetDirectory(target)

  if (kind === "tui") {
    if (source === "file" && dir) {
      const index = await resolveDirectoryIndex(dir)
      if (index) return pathToFileURL(index).href
    }

    if (source === "npm") return
    if (dir) return

    return target
  }

  if (dir && isRecord(hit.json.exports)) {
    if (source === "file") {
      const index = await resolveDirectoryIndex(dir)
      if (index) return pathToFileURL(index).href
    }

    return
  }

  return target
}

export function readPluginManifestSummary(spec: string, pkg?: PluginPackage): PluginManifestSummary | undefined {
  if (!pkg) return
  const manifest = readLfcodePluginManifest(pkg.json.lfcode, spec)
  if (!manifest) return
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    category: manifest.category,
    trust: manifest.trust,
    apiVersion: `${manifest.apiVersion}`.trim(),
    capabilities: manifest.capabilities?.length ? [...manifest.capabilities] : undefined,
    lfcodeRange: manifest.compatibility?.lfcode,
    runtimeDependencies: manifest.runtimeDependencies?.length ? [...manifest.runtimeDependencies] : undefined,
  }
}

export function isPathPluginSpec(spec: string) {
  return (
    spec.startsWith("file:") ||
    spec === "." ||
    spec === ".." ||
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith(".\\") ||
    spec.startsWith("..\\") ||
    isAbsolutePath(spec)
  )
}

export async function resolvePathPluginTarget(spec: string) {
  const raw = spec.startsWith("file:") ? fileSpecifierPath(spec) : spec
  const file = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? raw : path.resolve(raw)
  const stat = await Filesystem.statAsync(file)
  if (!stat?.isDirectory()) {
    if (spec.startsWith("file://")) return spec
    return pathToFileURL(file).href
  }

  if (await Filesystem.exists(path.join(file, "package.json"))) {
    return pathToFileURL(file).href
  }

  const index = await resolveDirectoryIndex(file)
  if (index) return pathToFileURL(index).href

  throw new Error(`Plugin directory ${file} is missing package.json or index file`)
}

export async function checkPluginCompatibility(target: string, lfcodeVersion: string, pkg?: PluginPackage) {
  if (!semver.valid(lfcodeVersion) || semver.major(lfcodeVersion) === 0) return
  const hit = pkg ?? (await readPluginPackage(target).catch(() => undefined))
  if (!hit) return
  const manifest = readLfcodePluginManifest(hit.json.lfcode, hit.pkg)
  const manifestRange = manifest?.compatibility?.lfcode
  if (manifestRange) {
    if (!semver.satisfies(lfcodeVersion, manifestRange)) {
      throw new Error(`Plugin requires lfcode ${manifestRange} but running ${lfcodeVersion}`)
    }
    return
  }
  const engines = hit.json.engines
  if (!isRecord(engines)) return
  const range = engines.lfcode
  if (typeof range !== "string") return
  if (!semver.satisfies(lfcodeVersion, range)) {
    throw new Error(`Plugin requires lfcode ${range} but running ${lfcodeVersion}`)
  }
}

export async function resolvePluginTarget(spec: string) {
  if (isManagedPluginSpecifier(spec)) return resolveManagedPluginTarget(spec)
  if (isPathPluginSpec(spec)) return resolvePathPluginTarget(spec)
  const hit = parse(spec)
  const pkg = hit?.name && hit.raw === hit.name ? `${hit.name}@latest` : spec
  const result = await Npm.add(pkg)
  return result.directory
}

export async function readPluginPackage(target: string): Promise<PluginPackage> {
  const file = target.startsWith("file://") ? fileURLToPath(target) : target
  const stat = await Filesystem.statAsync(file)
  const dir = stat?.isDirectory() ? file : path.dirname(file)
  const pkg = path.join(dir, "package.json")
  const json = await Filesystem.readJson<Record<string, unknown>>(pkg)
  return { dir, pkg, json }
}

export async function createPluginEntry(spec: string, target: string, kind: PluginKind): Promise<PluginEntry> {
  const source = pluginSource(spec)
  const pkg =
    source === "npm" ? await readPluginPackage(target) : await readPluginPackage(target).catch(() => undefined)
  const entry = await resolvePluginEntrypoint(spec, target, kind, pkg)
  return {
    spec,
    source,
    target,
    pkg,
    entry,
  }
}

export function readPackageThemes(spec: string, pkg: PluginPackage) {
  const field = pkg.json["oc-themes"]
  if (field === undefined) return []
  if (!Array.isArray(field)) {
    throw new TypeError(`Plugin ${spec} has invalid oc-themes field`)
  }

  const list = field.map((item) => {
    if (typeof item !== "string") {
      throw new TypeError(`Plugin ${spec} has invalid oc-themes entry`)
    }

    const raw = item.trim()
    if (!raw) {
      throw new TypeError(`Plugin ${spec} has empty oc-themes entry`)
    }
    if (raw.startsWith("file://") || isAbsolutePath(raw)) {
      throw new TypeError(`Plugin ${spec} oc-themes entry must be relative: ${item}`)
    }

    return resolvePackageFile(spec, raw, "oc-themes", pkg)
  })

  return Array.from(new Set(list))
}

export function readPluginId(id: unknown, spec: string) {
  if (id === undefined) return
  if (typeof id !== "string") throw new TypeError(`Plugin ${spec} has invalid id type ${typeof id}`)
  const value = id.trim()
  if (!value) throw new TypeError(`Plugin ${spec} has an empty id`)
  return value
}

export function readV1Plugin(
  mod: Record<string, unknown>,
  spec: string,
  kind: PluginKind,
  mode: PluginMode = "strict",
) {
  const value = mod.default
  if (!isRecord(value)) {
    if (mode === "detect") return
    throw new TypeError(`Plugin ${spec} must default export an object with ${kind}()`)
  }
  if (mode === "detect" && !("id" in value) && !("server" in value) && !("tui" in value)) return

  const server = "server" in value ? value.server : undefined
  const tui = "tui" in value ? value.tui : undefined
  if (server !== undefined && typeof server !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid server export`)
  }
  if (tui !== undefined && typeof tui !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid tui export`)
  }
  if (server !== undefined && tui !== undefined) {
    throw new TypeError(`Plugin ${spec} must default export either server() or tui(), not both`)
  }
  if (kind === "server" && server === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with server()`)
  }
  if (kind === "tui" && tui === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with tui()`)
  }

  return value
}

export async function resolvePluginId(
  source: PluginSource,
  spec: string,
  target: string,
  id: string | undefined,
  pkg?: PluginPackage,
) {
  const hit = pkg ?? (await readPluginPackage(target).catch(() => undefined))
  const manifestID = readPluginManifestSummary(spec, hit)?.id
  if (manifestID) return manifestID
  if (source === "file") {
    if (id) return id
    throw new TypeError(`Path plugin ${spec} must export id`)
  }
  if (source === "managed") {
    if (manifestID) return manifestID
    throw new TypeError(`Managed plugin ${spec} must declare lfcode.id`)
  }
  if (id) return id
  if (!hit) {
    throw new TypeError(`Plugin ${spec} package metadata is unavailable`)
  }
  if (typeof hit.json.name !== "string" || !hit.json.name.trim()) {
    throw new TypeError(`Plugin package ${hit.pkg} is missing name`)
  }
  return hit.json.name.trim()
}
