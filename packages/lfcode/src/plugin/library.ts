import { createHash, randomUUID } from "crypto"
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises"
import path from "path"
import semver from "semver"
import { z } from "zod"
import {
  readLfcodePluginManifest,
  type PluginImportPreview,
  type PluginImportReport,
  type PluginInstallRecord,
} from "@lfcode-ai/plugin"
import { Flock } from "@lfcode-ai/shared/util/flock"

import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { InstallationVersion } from "@/installation/version"
import { Npm } from "@/npm"
import { Filesystem } from "@/util"
import { isRecord } from "@/util/record"

type RegistryEntry = {
  enabled: boolean
  current: string
  digest: string
  version: string
  source: PluginInstallRecord["source"]
  installedAt: number
}

type Registry = {
  version: 1
  plugins: Record<string, RegistryEntry>
}

type PreviewState = {
  expiresAt: number
  report: PluginImportReport
  sourceDirectory?: string
  sourceDigest?: string
}

const PREVIEW_TTL = 10 * 60 * 1000
const SKIP_DIRECTORIES = new Set([".git", "node_modules"])
const SKIP_FILES = new Set([".lfcode-install.json"])
const MAX_ZIP_BYTES = 50 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_FILES = 2000
const MAX_COMPRESSION_RATIO = 100
const FORBIDDEN_ARCHIVE_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".sys",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".sh",
  ".node",
  ".so",
  ".dylib",
  ".msi",
  ".scr",
  ".cpl",
])
const GENERATED_CATEGORIES = new Set(["tool", "integration"])

export function root() {
  return Flag.LFCODE_PLUGIN_LIBRARY_DIR ?? path.join(Global.Path.data, "plugins")
}

export function registryFile() {
  return path.join(root(), "registry.json")
}

export function isManagedPluginSpecifier(spec: string) {
  return spec.startsWith("lfplugin:")
}

export function managedPluginID(spec: string) {
  if (!isManagedPluginSpecifier(spec)) return
  return normalizePluginID(spec.slice("lfplugin:".length))
}

export async function resolveManagedPluginTarget(spec: string) {
  const id = managedPluginID(spec)
  if (!id) throw new Error(`Invalid managed plugin spec ${spec}`)
  const current = (await readRegistry()).plugins[id]
  if (!current) throw new Error(`Managed plugin ${id} is not installed`)
  const library = Filesystem.resolve(path.join(root(), "library", id))
  const target = Filesystem.resolve(path.join(library, "versions", current.current))
  if (!Filesystem.contains(library, target))
    throw new Error(`Managed plugin ${id} points outside its library directory`)
  if (!(await Filesystem.isDir(target))) throw new Error(`Managed plugin ${id} current version is unavailable`)
  return target
}

export async function listManagedPluginSpecs() {
  const registry = await readRegistry()
  return Object.entries(registry.plugins)
    .filter(([, entry]) => entry.enabled)
    .map(([id]) => `lfplugin:${id}`)
    .sort()
}

export async function listInstalledPlugins(): Promise<PluginInstallRecord[]> {
  const registry = await readRegistry()
  return Promise.all(
    Object.entries(registry.plugins).map(async ([id, entry]) => {
      const target = path.join(root(), "library", id, "versions", entry.current)
      const value = await readJson(path.join(target, ".lfcode-install.json"))
      if (!isRecord(value)) throw new Error(`Managed plugin ${id} has invalid install metadata`)
      return {
        ...(value as PluginInstallRecord),
        enabled: entry.enabled,
        directory: target,
        source: entry.source,
        installedAt: entry.installedAt,
      }
    }),
  ).then((items) => items.sort((a, b) => a.name.localeCompare(b.name)))
}

export async function setPluginEnabled(spec: string, enabled: boolean) {
  const id = managedPluginID(spec)
  if (!id) throw new Error(`Invalid managed plugin spec ${spec}`)
  await using _ = await Flock.acquire(`plugin-library:${root()}`)
  const registry = await readRegistry()
  const current = registry.plugins[id]
  if (!current) throw new Error(`Managed plugin ${id} is not installed`)
  await atomicWriteJson(registryFile(), {
    ...registry,
    plugins: {
      ...registry.plugins,
      [id]: { ...current, enabled },
    },
  } satisfies Registry)
  return { spec: `lfplugin:${id}`, enabled }
}

export async function uninstallPlugin(spec: string) {
  const id = managedPluginID(spec)
  if (!id) throw new Error(`Invalid managed plugin spec ${spec}`)
  await using _ = await Flock.acquire(`plugin-library:${root()}`)
  const registry = await readRegistry()
  if (!registry.plugins[id]) throw new Error(`Managed plugin ${id} is not installed`)
  const plugins = { ...registry.plugins }
  delete plugins[id]
  await atomicWriteJson(registryFile(), { ...registry, plugins } satisfies Registry)
  return { spec: `lfplugin:${id}`, uninstalled: true as const }
}

export async function previewDirectoryImport(input: {
  directory: string
  ttlMs?: number
}): Promise<PluginImportPreview> {
  return previewLocalImport({ ...input, type: "directory" })
}

export async function previewGeneratedImport(input: {
  directory: string
  ttlMs?: number
}): Promise<PluginImportPreview> {
  return previewLocalImport({ ...input, type: "generated" })
}

export async function previewNpmImport(input: { spec: string; ttlMs?: number }): Promise<PluginImportPreview> {
  const installed = await Npm.add(input.spec)
  return previewLocalImport({
    directory: installed.directory,
    label: input.spec,
    ttlMs: input.ttlMs,
    type: "npm",
  })
}

async function previewLocalImport(input: {
  directory: string
  label?: string
  ttlMs?: number
  type: "npm" | "directory" | "generated"
}): Promise<PluginImportPreview> {
  await cleanupExpiredPreviews()
  const source = Filesystem.resolve(input.directory)
  if (!(await Filesystem.isDir(source))) throw new Error(`Plugin directory does not exist: ${input.directory}`)

  const token = randomUUID()
  const preview = path.join(root(), "previews", token)
  const snapshot = path.join(preview, "snapshot")
  await mkdir(preview, { recursive: true })

  const sourceSummary = await snapshotSummary(source)
  const report = await copySnapshot(source, snapshot)
    .then(() => materializeSnapshotDependencies(snapshot, input.type))
    .then(() => snapshotSummary(snapshot))
    .then((summary) => inspectSnapshot(snapshot, input.label ?? source, summary))
    .catch(async (error: unknown) => {
      await rm(preview, { recursive: true, force: true })
      throw error
    })
  report.source.type = input.type
  enforceGeneratedCategory(report)
  const expiresAt = Date.now() + (input.ttlMs ?? PREVIEW_TTL)
  await atomicWriteJson(path.join(preview, "preview.json"), {
    expiresAt,
    report,
    sourceDirectory: source,
    sourceDigest: sourceSummary.digest,
  } satisfies PreviewState)
  return { token, expiresAt, report }
}

export async function discardImportPreview(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Invalid plugin preview token")
  await rm(path.join(root(), "previews", token), { recursive: true, force: true })
}

export async function inspectImportPreview(token: string): Promise<PluginImportPreview> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Invalid plugin preview token")
  const state = await readPreview(path.join(root(), "previews", token, "preview.json"))
  if (state.expiresAt <= Date.now()) throw new Error("Plugin preview token expired")
  return { token, expiresAt: state.expiresAt, report: state.report }
}

export function authorWorkspace(id: string) {
  const normalized = normalizePluginID(id)
  if (!normalized) throw new Error(`Invalid plugin id ${id}`)
  return path.join(root(), "workspaces", normalized)
}

export async function previewZipImport(input: { file: string; ttlMs?: number }): Promise<PluginImportPreview> {
  await cleanupExpiredPreviews()
  const file = Filesystem.resolve(input.file)
  const archive = await readFile(file)
  if (archive.byteLength > MAX_ZIP_BYTES) throw new Error(`Plugin ZIP exceeds ${MAX_ZIP_BYTES} bytes`)
  const token = randomUUID()
  const preview = path.join(root(), "previews", token)
  const snapshot = path.join(preview, "snapshot")
  await mkdir(snapshot, { recursive: true })

  const zip = await import("@zip.js/zip.js")
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(Uint8Array.from(archive)))
  try {
    const entries = await reader.getEntries()
    const files = entries.filter((entry) => !entry.directory)
    if (!files.length) throw new Error("Plugin ZIP contains no files")
    if (files.length > MAX_FILES) throw new Error(`Plugin ZIP exceeds ${MAX_FILES} files`)

    const names = files.map((entry) => normalizeArchivePath(entry.filename))
    const folded = new Set<string>()
    for (const name of names) {
      const key = name.toLowerCase()
      if (folded.has(key)) throw new Error(`Plugin ZIP contains a duplicate path: ${name}`)
      folded.add(key)
    }
    const prefix = archiveRootPrefix(names)
    let declaredExtracted = 0
    let actualExtracted = 0
    for (let index = 0; index < files.length; index++) {
      const entry = files[index]!
      if (!entry.getData) throw new Error(`Plugin ZIP entry cannot be extracted: ${entry.filename}`)
      if (entry.encrypted) throw new Error(`Plugin ZIP entry is encrypted: ${entry.filename}`)
      if (archiveEntryIsSymlink(entry)) throw new Error(`Plugin ZIP contains a symbolic link: ${entry.filename}`)
      if (entry.executable || FORBIDDEN_ARCHIVE_EXTENSIONS.has(path.extname(entry.filename).toLowerCase())) {
        throw new Error(`Plugin ZIP contains a forbidden executable file: ${entry.filename}`)
      }
      if (entry.uncompressedSize > MAX_FILE_BYTES)
        throw new Error(`Plugin ZIP entry exceeds ${MAX_FILE_BYTES} bytes: ${entry.filename}`)
      if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO) {
        throw new Error(`Plugin ZIP entry exceeds compression ratio ${MAX_COMPRESSION_RATIO}: ${entry.filename}`)
      }
      declaredExtracted += entry.uncompressedSize
      if (declaredExtracted > MAX_EXTRACTED_BYTES)
        throw new Error(`Plugin ZIP exceeds ${MAX_EXTRACTED_BYTES} extracted bytes`)

      const relative = prefix ? names[index]!.slice(prefix.length) : names[index]!
      if (!relative) continue
      const target = Filesystem.resolve(path.join(snapshot, relative))
      if (!Filesystem.contains(snapshot, target))
        throw new Error(`Plugin ZIP entry escapes the preview directory: ${entry.filename}`)
      const chunks: Uint8Array[] = []
      let bytes = 0
      await entry.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            bytes += chunk.byteLength
            actualExtracted += chunk.byteLength
            if (bytes > MAX_FILE_BYTES)
              throw new Error(`Plugin ZIP entry exceeds ${MAX_FILE_BYTES} bytes: ${entry.filename}`)
            if (actualExtracted > MAX_EXTRACTED_BYTES)
              throw new Error(`Plugin ZIP exceeds ${MAX_EXTRACTED_BYTES} extracted bytes`)
            chunks.push(chunk.slice())
          },
        }),
      )
      const data = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      if (data.byteLength !== entry.uncompressedSize)
        throw new Error(`Plugin ZIP entry size changed while extracting: ${entry.filename}`)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, data)
    }
  } catch (error) {
    await rm(preview, { recursive: true, force: true })
    throw error
  } finally {
    await reader.close().catch(() => undefined)
  }

  const report = await materializeSnapshotDependencies(snapshot, "zip")
    .then(() => snapshotSummary(snapshot))
    .then((summary) => inspectSnapshot(snapshot, file, summary))
    .catch(async (error: unknown) => {
      await rm(preview, { recursive: true, force: true })
      throw error
    })
  report.source.type = "zip"
  const expiresAt = Date.now() + (input.ttlMs ?? PREVIEW_TTL)
  await atomicWriteJson(path.join(preview, "preview.json"), { expiresAt, report } satisfies PreviewState)
  return { token, expiresAt, report }
}

export async function exportPlugin(spec: string, output: string) {
  const target = await resolveManagedPluginTarget(spec)
  return exportDirectorySnapshot(target, output)
}

export async function exportAuthorWorkspace(id: string, output: string) {
  const workspace = authorWorkspace(id)
  if (!(await Filesystem.isDir(workspace))) throw new Error(`Plugin workspace not found: ${id}`)
  return exportDirectorySnapshot(workspace, output)
}

async function exportDirectorySnapshot(target: string, output: string) {
  const files = await scanDirectory(target)
  const zip = await import("@zip.js/zip.js")
  const writer = new zip.ZipWriter(new zip.Uint8ArrayWriter())
  try {
    for (const file of files) {
      await writer.add(file.relative, new zip.Uint8ArrayReader(await readFile(file.absolute)), {
        lastModDate: new Date(0),
      })
    }
    const data = await writer.close()
    await Filesystem.write(output, data)
    return {
      file: output,
      bytes: data.byteLength,
      files: files.length,
    }
  } catch (error) {
    await writer.close().catch(() => undefined)
    throw error
  }
}

async function materializeSnapshotDependencies(snapshot: string, source: "npm" | "directory" | "zip" | "generated") {
  if (source === "generated") {
    await materializeGeneratedAuthorSDK(snapshot)
    return
  }
  if (await hasRegistryDependencies(snapshot)) {
    await validateRegistryDependencies(snapshot)
    await Npm.install(snapshot)
  }
}

async function materializeGeneratedAuthorSDK(snapshot: string) {
  const sdk = path.join(snapshot, ".lfcode-author-sdk")
  const pkg = await readJson(path.join(snapshot, "package.json"))
  if (!isRecord(pkg)) throw new Error("Plugin package.json must contain an object")
  const dependencies = isRecord(pkg.dependencies) ? pkg.dependencies : {}
  await atomicWriteJson(path.join(snapshot, "package.json"), {
    ...pkg,
    dependencies: { ...dependencies, "@lfcode-ai/plugin": "file:.lfcode-author-sdk" },
  })
  await mkdir(sdk, { recursive: true })
  const zodVersion = `${z.core.version.major}.${z.core.version.minor}.${z.core.version.patch}`
  await atomicWriteJson(path.join(sdk, "package.json"), {
    name: "@lfcode-ai/plugin",
    version: "0.1.0",
    type: "module",
    exports: { ".": "./index.js" },
    dependencies: { zod: zodVersion },
  })
  await writeFile(
    path.join(sdk, "index.js"),
    [
      'import { z } from "zod"',
      "export const definePlugin = (plugin) => plugin",
      "export const defineServerPlugin = (plugin) => plugin",
      "export const tool = (input) => input",
      "tool.schema = z",
      "",
    ].join("\n"),
  )
  await Npm.install(snapshot)
  const installed = path.join(snapshot, "node_modules", "@lfcode-ai", "plugin")
  await rm(installed, { recursive: true, force: true })
  await cp(sdk, installed, { recursive: true, errorOnExist: true, force: false })
}

export async function commitImport(token: string): Promise<PluginInstallRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Invalid plugin preview token")
  const preview = path.join(root(), "previews", token)
  const state = await readPreview(path.join(preview, "preview.json"))
  if (state.expiresAt <= Date.now()) {
    await rm(preview, { recursive: true, force: true })
    throw new Error("Plugin preview token expired")
  }

  try {
    await using _ = await Flock.acquire(`plugin-library:${root()}`)
    const snapshot = path.join(preview, "snapshot")
    if (state.sourceDirectory && state.sourceDigest) {
      const source = await snapshotSummary(state.sourceDirectory).catch(() => undefined)
      if (!source || source.digest !== state.sourceDigest) throw new Error("Plugin source contents changed")
    }
    const current = await inspectSnapshot(snapshot, state.report.source.label, await snapshotSummary(snapshot))
    if (current.source.digest !== state.report.source.digest || current.id !== state.report.id) {
      throw new Error("Plugin preview contents changed")
    }
    current.source.type = state.report.source.type
    current.source.label = state.report.source.label
    enforceGeneratedCategory(current)
    await verifyMaterializedDependencies(snapshot, current)

    const versionName = `${safeSegment(current.version)}-${current.source.digest.slice(0, 16)}`
    const pluginRoot = path.join(root(), "library", current.id)
    const versions = path.join(pluginRoot, "versions")
    const target = path.join(versions, versionName)
    const installedAt = Date.now()
    const record = {
      ...current,
      installedAt,
      enabled: true,
      spec: `lfplugin:${current.id}`,
      directory: target,
    } satisfies PluginInstallRecord

    await mkdir(versions, { recursive: true })
    if (!(await Filesystem.exists(target))) {
      const staging = path.join(versions, `.staging-${randomUUID()}`)
      await cp(snapshot, staging, { recursive: true, errorOnExist: true, force: false })
      await writeFile(path.join(staging, ".lfcode-install.json"), JSON.stringify(record, null, 2))
      await rename(staging, target).catch(async (error: unknown) => {
        await rm(staging, { recursive: true, force: true })
        throw error
      })
    }

    const registry = await readRegistry()
    const previousCurrent = await readFile(path.join(pluginRoot, "current.json"), "utf8").catch(() => undefined)
    const previousRegistry = await readFile(registryFile(), "utf8").catch(() => undefined)
    const nextRegistry = {
      ...registry,
      plugins: {
        ...registry.plugins,
        [current.id]: {
          enabled: true,
          current: versionName,
          digest: current.source.digest,
          version: current.version,
          source: current.source,
          installedAt,
        },
      },
    } satisfies Registry

    const write = await atomicWriteJson(path.join(pluginRoot, "current.json"), {
      version: current.version,
      digest: current.source.digest,
      directory: path.join("versions", versionName),
    })
      .then(() => atomicWriteJson(registryFile(), nextRegistry))
      .catch(async (error: unknown) => {
        await restoreFile(path.join(pluginRoot, "current.json"), previousCurrent)
        await restoreFile(registryFile(), previousRegistry)
        throw error
      })
    return write ?? record
  } finally {
    await rm(preview, { recursive: true, force: true })
  }
}

async function hasRegistryDependencies(directory: string) {
  const pkg = await readJson(path.join(directory, "package.json"))
  if (!isRecord(pkg)) return false
  return [pkg.dependencies, pkg.optionalDependencies].some((value) => isRecord(value) && Object.keys(value).length > 0)
}

async function validateRegistryDependencies(directory: string) {
  const pkg = await readJson(path.join(directory, "package.json"))
  if (!isRecord(pkg)) return
  const dependencies = [pkg.dependencies, pkg.optionalDependencies].filter(isRecord)
  for (const [name, requested] of dependencies.flatMap((items) => Object.entries(items))) {
    if (typeof requested !== "string") throw new Error(`Plugin dependency ${name} must use a registry version`)
    if (/^(?:file:|link:|workspace:|git(?:\+|:)|https?:|ssh:|\/|\.\.?[\\/]|[A-Za-z]:[\\/])/.test(requested)) {
      throw new Error(`Plugin dependency ${name} must use a registry version, received ${requested}`)
    }
  }
}

async function inspectDependencies(directory: string) {
  const pkg = await readJson(path.join(directory, "package.json"))
  if (!isRecord(pkg)) return []
  const lock = await readJson(path.join(directory, "package-lock.json")).catch(() => undefined)
  const packages = isRecord(lock) && isRecord(lock.packages) ? lock.packages : {}
  const required = isRecord(pkg.dependencies) ? pkg.dependencies : {}
  const optional = isRecord(pkg.optionalDependencies) ? pkg.optionalDependencies : {}
  const dependencies = Object.entries({ ...optional, ...required }).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  )
  return Promise.all(
    dependencies.map(async ([name, requested]) => {
      const installed = packages[`node_modules/${name}`]
      const linked = requested.startsWith("file:")
        ? await readJson(path.join(directory, requested.slice("file:".length), "package.json")).catch(() => undefined)
        : undefined
      return {
        name,
        requested,
        ...(isRecord(installed) && typeof installed.version === "string"
          ? { version: installed.version }
          : isRecord(linked) && typeof linked.version === "string"
            ? { version: linked.version }
            : {}),
        ...(isRecord(installed) && typeof installed.integrity === "string" ? { integrity: installed.integrity } : {}),
        optional: name in optional && !(name in required),
      }
    }),
  ).then((items) => items.sort((a, b) => a.name.localeCompare(b.name)))
}

async function verifyMaterializedDependencies(directory: string, report: PluginImportReport) {
  for (const dependency of report.dependencies) {
    if (dependency.optional) continue
    if (!(await Filesystem.isDir(path.join(directory, "node_modules", ...dependency.name.split("/"))))) {
      throw new Error(`Plugin dependency was not materialized during preview: ${dependency.name}`)
    }
  }
}

async function inspectSnapshot(
  snapshot: string,
  source: string,
  files: { count: number; bytes: number; digest: string },
): Promise<PluginImportReport> {
  const pkg = await readJson(path.join(snapshot, "package.json"))
  if (!isRecord(pkg)) throw new Error("Plugin package.json must contain an object")
  const manifest = readLfcodePluginManifest(pkg.lfcode, source)
  if (!manifest) throw new Error("Managed plugins must declare an lfcode manifest")
  const id = normalizePluginID(manifest.id)
  if (!id) throw new Error("Managed plugins must declare lfcode.id")
  if (!manifest.category) throw new Error("Managed plugins must declare lfcode.category")
  assertCompatible(manifest.compatibility?.lfcode, pkg.engines)
  const version = readRequiredString(manifest.version ?? pkg.version, "version")
  const name = readRequiredString(manifest.name ?? pkg.name, "name")
  const entrypoints = Object.entries(manifest.entrypoints).flatMap(([kind, entry]) =>
    entry ? [`${kind}:${entry.path}`] : [],
  )
  if (!entrypoints.length) throw new Error("Managed plugins must declare at least one entrypoint")
  for (const entry of Object.values(manifest.entrypoints)) {
    if (!entry) continue
    const target = Filesystem.resolve(path.join(snapshot, entry.path))
    if (!Filesystem.contains(snapshot, target) || !(await Filesystem.exists(target))) {
      throw new Error(`Plugin entrypoint is unavailable or outside the plugin directory: ${entry.path}`)
    }
  }

  const registry = await readRegistry()
  const existing = registry.plugins[id]
  return {
    id,
    name,
    version,
    ...((manifest.description ?? pkg.description)
      ? { description: readRequiredString(manifest.description ?? pkg.description, "description") }
      : {}),
    category: manifest.category,
    capabilities: manifest.capabilities ?? [],
    trust: "external",
    apiVersion: `${manifest.apiVersion}`,
    ...(manifest.compatibility?.lfcode ? { lfcodeRange: manifest.compatibility.lfcode } : {}),
    entrypoints,
    runtimeDependencies: manifest.runtimeDependencies ?? [],
    dependencies: await inspectDependencies(snapshot),
    source: {
      type: "directory",
      label: source,
      digest: files.digest,
    },
    files: {
      count: files.count,
      bytes: files.bytes,
    },
    operation: !existing ? "install" : existing.digest === files.digest ? "unchanged" : "replace",
    warnings: manifest.capabilities?.length ? [] : ["Plugin manifest does not declare capabilities"],
  }
}

function assertCompatible(manifestRange: string | undefined, engines: unknown) {
  if (!semver.valid(InstallationVersion) || semver.major(InstallationVersion) === 0) return
  const engineRange = isRecord(engines) && typeof engines.lfcode === "string" ? engines.lfcode : undefined
  const range = manifestRange ?? engineRange
  if (!range) return
  if (!semver.validRange(range)) throw new Error(`Plugin declares an invalid lfcode compatibility range: ${range}`)
  if (!semver.satisfies(InstallationVersion, range)) {
    throw new Error(`Plugin requires lfcode ${range} but running ${InstallationVersion}`)
  }
}

function enforceGeneratedCategory(report: PluginImportReport) {
  if (report.source.type !== "generated") return
  if (!GENERATED_CATEGORIES.has(report.category)) {
    throw new Error(`Generated plugins must use category tool or integration, received ${report.category}`)
  }
}

async function copySnapshot(source: string, target: string) {
  const files = await scanDirectory(source)
  await mkdir(target, { recursive: true })
  for (const file of files) {
    const dest = path.join(target, file.relative)
    await mkdir(path.dirname(dest), { recursive: true })
    await cp(file.absolute, dest, { force: false, errorOnExist: true })
  }
  return hashFiles(files)
}

async function snapshotSummary(snapshot: string) {
  return hashFiles(await scanDirectory(snapshot))
}

async function scanDirectory(root: string) {
  const files: { absolute: string; relative: string; size: number }[] = []
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      if (SKIP_FILES.has(entry.name)) continue
      const absolute = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Plugin directory contains a symbolic link: ${absolute}`)
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!entry.isFile()) throw new Error(`Plugin directory contains an unsupported file: ${absolute}`)
      files.push({
        absolute,
        relative: path.relative(root, absolute).replaceAll("\\", "/"),
        size: (await stat(absolute)).size,
      })
    }
  }
  await visit(root)
  return files.sort((a, b) => a.relative.localeCompare(b.relative))
}

async function hashFiles(files: { absolute: string; relative: string; size: number }[]) {
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(file.relative)
    hash.update("\0")
    hash.update(await readFile(file.absolute))
    hash.update("\0")
  }
  return {
    count: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0),
    digest: hash.digest("hex"),
  }
}

async function readRegistry(): Promise<Registry> {
  const value = await readJson(registryFile()).catch(() => undefined)
  if (!isRecord(value) || !isRecord(value.plugins)) return { version: 1, plugins: {} }
  return { version: 1, plugins: value.plugins as Record<string, RegistryEntry> }
}

async function cleanupExpiredPreviews() {
  const directory = path.join(root(), "previews")
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries.flatMap((entry) => {
      if (!entry.isDirectory()) return []
      const preview = path.join(directory, entry.name)
      return [
        readPreview(path.join(preview, "preview.json"))
          .then(async (state) => {
            if (state.expiresAt <= Date.now()) await rm(preview, { recursive: true, force: true })
          })
          .catch(async () => {
            const info = await stat(preview).catch(() => undefined)
            if (info && info.mtimeMs + PREVIEW_TTL <= Date.now()) await rm(preview, { recursive: true, force: true })
          }),
      ]
    }),
  )
}

async function readPreview(file: string): Promise<PreviewState> {
  const value = await readJson(file)
  if (!isRecord(value) || typeof value.expiresAt !== "number" || !isRecord(value.report)) {
    throw new Error("Invalid plugin preview token")
  }
  return value as PreviewState
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as unknown
}

async function atomicWriteJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2))
  await rename(temp, file).catch(async (error: unknown) => {
    await rm(temp, { force: true })
    throw error
  })
}

async function restoreFile(file: string, value: string | undefined) {
  if (value === undefined) return rm(file, { force: true })
  return atomicWriteJson(file, JSON.parse(value))
}

function normalizePluginID(value: string | undefined) {
  const id = value?.trim().toLowerCase()
  if (!id || !/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(id)) return
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(id)) return
  return id
}

function readRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Plugin ${field} is required`)
  return value.trim()
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "0"
}

function normalizeArchivePath(value: string) {
  const name = value.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!name || name.startsWith("/") || /^[A-Za-z]:\//.test(name) || name.startsWith("//")) {
    throw new Error(`Plugin ZIP contains an absolute path: ${value}`)
  }
  const parts = name.split("/")
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Plugin ZIP contains an invalid path: ${value}`)
  }
  if (parts.includes(".git") || parts.includes("node_modules")) {
    throw new Error(`Plugin ZIP contains a forbidden directory: ${value}`)
  }
  return parts.join("/")
}

function archiveRootPrefix(names: string[]) {
  if (names.includes("package.json")) return ""
  const root = names[0]?.split("/")[0]
  if (!root || !names.every((name) => name.startsWith(`${root}/`))) {
    throw new Error("Plugin ZIP must contain package.json at the root or inside one top-level directory")
  }
  return `${root}/`
}

function archiveEntryIsSymlink(entry: { versionMadeBy: number; externalFileAttributes: number }) {
  const unix = entry.versionMadeBy >> 8 === 3
  if (!unix) return false
  return ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
}
