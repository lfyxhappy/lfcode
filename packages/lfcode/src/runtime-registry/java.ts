import fs from "fs/promises"
import path from "path"
import { PluginPath } from "@/plugin/path"
import { Archive, Filesystem, Log } from "@/util"
import { which } from "@/util/which"
import { getRuntimeActivationTarget } from "./config"

const log = Log.create({ service: "runtime-registry.java" })

const JAVA_VERSION = "21"
const JAVA_HOME_ENV = "JAVA_HOME"
const JAVA_ENV = "LFCODE_JAVA_PATH"
const JAVAC_ENV = "LFCODE_JAVAC_PATH"

export type ManagedJavaArtifactID = "java-runtime" | "java-sdk"
export type ManagedJavaBinary = "java" | "javac"

type ManagedJavaSource = {
  id: string
  label: string
  url?: string
  resolveUrl?: () => Promise<string>
}

type ManagedJavaMetadata = {
  sourceID: string
  sourceLabel: string
  sourceURL: string
  installedAt: number
}

const MANAGED_JAVA_SOURCES: Record<ManagedJavaArtifactID, ManagedJavaSource[]> = {
  "java-runtime": [
    {
      id: "adoptium-api-binary",
      label: "Adoptium API (JRE 21)",
      url: "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse",
    },
    {
      id: "adoptium-assets-json",
      label: "Adoptium Assets API (JRE 21)",
      resolveUrl: () => resolveAdoptiumPackageLink("jre"),
    },
  ],
  "java-sdk": [
    {
      id: "microsoft-openjdk",
      label: "Microsoft Build of OpenJDK 21",
      url: "https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip",
    },
    {
      id: "adoptium-api-binary",
      label: "Adoptium API (JDK 21)",
      url: "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse",
    },
    {
      id: "adoptium-assets-json",
      label: "Adoptium Assets API (JDK 21)",
      resolveUrl: () => resolveAdoptiumPackageLink("jdk"),
    },
  ],
}

export function managedJavaRoot() {
  return PluginPath.data("runtime-java")
}

export function managedJavaRuntimeRoot() {
  return path.join(managedJavaRoot(), `jre-${JAVA_VERSION}`)
}

export function managedJavaSdkRoot() {
  return path.join(managedJavaRoot(), `jdk-${JAVA_VERSION}`)
}

export function managedJavaExecutable(root: string, binary: ManagedJavaBinary) {
  const name = process.platform === "win32" ? `${binary}.exe` : binary
  return path.join(root, "bin", name)
}

export function resolveManagedJavaBinary(binary: ManagedJavaBinary, preferredArtifact?: ManagedJavaArtifactID) {
  const runtimeCandidates =
    binary === "java"
      ? preferredArtifact === "java-sdk"
        ? [managedJavaSdkRoot(), managedJavaRuntimeRoot()]
        : preferredArtifact === "java-runtime"
          ? [managedJavaRuntimeRoot(), managedJavaSdkRoot()]
          : [managedJavaRuntimeRoot(), managedJavaSdkRoot()]
      : [managedJavaSdkRoot()]
  const candidates = runtimeCandidates.map((root) => managedJavaExecutable(root, binary))

  for (const candidate of candidates) {
    if (!Filesystem.stat(candidate)?.isFile()) continue
    return {
      path: candidate,
      source: "managed" as const,
      artifact: inferArtifactFromPath(candidate, binary),
    }
  }
}

export function isManagedJavaPath(candidate: string) {
  const normalized = normalizePath(candidate)
  const managedRoot = normalizePath(managedJavaRoot())
  return normalized.startsWith(`${managedRoot}/`) || normalized === managedRoot
}

export async function readManagedJavaMetadata(id: ManagedJavaArtifactID) {
  const file = path.join(rootForArtifact(id), ".lfcode-runtime.json")
  return Filesystem.readJson<ManagedJavaMetadata>(file).catch(() => undefined)
}

export async function installManagedJavaArtifact(id: ManagedJavaArtifactID) {
  ensureManagedJavaPlatform()

  const attempts: string[] = []
  for (const source of MANAGED_JAVA_SOURCES[id]) {
    try {
      const url = await resolveManagedJavaSourceUrl(source)
      log.info("installing managed java runtime", { id, source: source.id, url })
      const result = await installFromManagedJavaSource(id, source, url)
      refreshManagedJavaEnvironment()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      attempts.push(`${source.label}: ${message}`)
      log.warn("managed java source failed", { id, source: source.id, error })
    }
  }

  throw new Error(`受管 ${titleForArtifact(id)} 安装失败。\n${attempts.map((item) => `- ${item}`).join("\n")}`)
}

export async function repairManagedJavaArtifact(id: ManagedJavaArtifactID) {
  ensureManagedJavaPlatform()

  const existing = resolveManagedJavaBinary(binaryForArtifact(id), id)
  if (existing) {
    refreshManagedJavaEnvironment()
    return {
      path: existing.path,
      sourceLabel: (await readManagedJavaMetadata(id))?.sourceLabel,
      reused: true,
    }
  }

  return installManagedJavaArtifact(id)
}

export function refreshManagedJavaEnvironment() {
  const java = resolvePreferredJavaBinary("java")
  const javac = resolvePreferredJavaBinary("javac")
  const javaHome = javac ? javaRootFromBinary(javac.path) : java ? javaRootFromBinary(java.path) : undefined

  setOptionalEnv(JAVA_ENV, java?.path)
  setOptionalEnv(JAVAC_ENV, javac?.path)
  setOptionalEnv(JAVA_HOME_ENV, javaHome)
}

export function resolvePreferredJavaBinary(binary: ManagedJavaBinary) {
  const configured = resolveConfiguredJavaBinary(binary)
  const system = resolveSystemJavaBinary(binary)
  const preferred = getRuntimeActivationTarget(binary === "java" ? "java-runtime" : "java-sdk")
  const managedPreferredArtifact =
    binary === "java"
      ? preferred === "managed-jdk"
        ? "java-sdk"
        : preferred === "managed-jre"
          ? "java-runtime"
          : undefined
      : "java-sdk"
  const managed = resolveManagedJavaBinary(binary, managedPreferredArtifact)
  const ordered =
    preferred === "system"
      ? [system, configured?.source === "system" ? configured : undefined, managed, configured?.source === "managed" ? configured : undefined]
      : preferred === "managed-jdk" || preferred === "managed-jre" || preferred === "managed"
        ? [managed, configured?.source === "managed" ? configured : undefined, system, configured?.source === "system" ? configured : undefined]
        : [configured, managed, system]
  return ordered.find(Boolean)
}

function ensureManagedJavaPlatform() {
  if (process.platform === "win32") return
  throw new Error("Java 受管安装当前只支持 Windows。")
}

function titleForArtifact(id: ManagedJavaArtifactID) {
  return id === "java-runtime" ? "Java 运行时" : "Java SDK"
}

function rootForArtifact(id: ManagedJavaArtifactID) {
  return id === "java-runtime" ? managedJavaRuntimeRoot() : managedJavaSdkRoot()
}

function binaryForArtifact(id: ManagedJavaArtifactID): ManagedJavaBinary {
  return id === "java-runtime" ? "java" : "javac"
}

function normalizePath(value: string) {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase()
}

function javaRootFromBinary(binaryPath: string) {
  return path.dirname(path.dirname(binaryPath))
}

function setOptionalEnv(key: string, value: string | undefined) {
  if (value) {
    process.env[key] = value
    return
  }
  delete process.env[key]
}

function resolveConfiguredJavaBinary(binary: ManagedJavaBinary) {
  const configured = process.env[binary === "java" ? JAVA_ENV : JAVAC_ENV]
  if (!configured || !Filesystem.stat(configured)?.isFile()) return
  return {
    path: configured,
    source: isManagedJavaPath(configured) ? ("managed" as const) : ("system" as const),
    artifact: inferArtifactFromPath(configured, binary),
  }
}

function resolveSystemJavaBinary(binary: ManagedJavaBinary) {
  const resolved = which(process.platform === "win32" ? `${binary}.exe` : binary)
  if (!resolved) return
  return {
    path: resolved,
    source: "system" as const,
    artifact: inferArtifactFromPath(resolved, binary),
  }
}

function inferArtifactFromPath(value: string, binary: ManagedJavaBinary) {
  if (value.includes(`${path.sep}jdk-`)) return "java-sdk" as const
  if (binary === "javac") return "java-sdk" as const
  return "java-runtime" as const
}

async function resolveManagedJavaSourceUrl(source: ManagedJavaSource) {
  if (source.url) return source.url
  if (source.resolveUrl) return source.resolveUrl()
  throw new Error(`Java source ${source.id} is missing a URL.`)
}

async function installFromManagedJavaSource(id: ManagedJavaArtifactID, source: ManagedJavaSource, url: string) {
  const tempDir = path.join(managedJavaRoot(), "cache", id, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const archivePath = path.join(tempDir, `${id}.zip`)
  const extractDir = path.join(tempDir, "extract")
  const targetRoot = rootForArtifact(id)

  await fs.mkdir(tempDir, { recursive: true })
  try {
    await downloadManagedJavaArchive(url, archivePath)
    await Archive.extractZip(archivePath, extractDir)
    const locatedRoot = await findManagedJavaHome(extractDir, binaryForArtifact(id))
    if (!locatedRoot) {
      throw new Error(`下载归档里没有找到 ${binaryForArtifact(id)} 可执行文件。`)
    }

    await fs.rm(targetRoot, { recursive: true, force: true })
    await fs.mkdir(path.dirname(targetRoot), { recursive: true })
    await fs.cp(locatedRoot, targetRoot, { recursive: true, force: true })
    await Filesystem.writeJson(path.join(targetRoot, ".lfcode-runtime.json"), {
      sourceID: source.id,
      sourceLabel: source.label,
      sourceURL: url,
      installedAt: Date.now(),
    } satisfies ManagedJavaMetadata)

    const binaryPath = managedJavaExecutable(targetRoot, binaryForArtifact(id))
    if (!Filesystem.stat(binaryPath)?.isFile()) {
      throw new Error(`受管安装完成后未找到 ${binaryPath}`)
    }

    return {
      path: binaryPath,
      sourceLabel: source.label,
      reused: false,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function downloadManagedJavaArchive(url: string, target: string) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error("下载失败: 响应体为空")
  }
  await Filesystem.writeStream(target, response.body)
}

async function findManagedJavaHome(root: string, binary: ManagedJavaBinary): Promise<string | undefined> {
  const direct = managedJavaExecutable(root, binary)
  if (Filesystem.stat(direct)?.isFile()) return root

  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = await findManagedJavaHome(path.join(root, entry.name), binary)
    if (nested) return nested
  }
}

async function resolveAdoptiumPackageLink(imageType: "jre" | "jdk") {
  const query = new URLSearchParams({
    os: "windows",
    architecture: "x64",
    image_type: imageType,
    jvm_impl: "hotspot",
    heap_size: "normal",
    release_type: "ga",
    vendor: "eclipse",
  })
  const response = await fetch(`https://api.adoptium.net/v3/assets/latest/21/hotspot?${query.toString()}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`读取 Adoptium 源失败: ${response.status} ${response.statusText}`)
  }

  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("Adoptium 源返回为空。")
  }

  const candidate = payload[0]
  const binary = readRecord(candidate, "binary")
  const packageInfo = readRecord(binary, "package")
  const link = readString(packageInfo, "link")
  if (!link) {
    throw new Error("Adoptium 源里没有可用下载链接。")
  }
  return link
}

function readRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object") return
  const next = (value as Record<string, unknown>)[key]
  if (!next || typeof next !== "object") return
  return next as Record<string, unknown>
}

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object") return
  const next = (value as Record<string, unknown>)[key]
  return typeof next === "string" ? next : undefined
}
