import fs from "fs/promises"
import path from "path"
import { PluginPath } from "@/plugin/path"
import { Archive, Filesystem, Log } from "@/util"
import { which } from "@/util/which"
import { getRuntimeActivationTarget } from "./config"
import type { RuntimeManageSource } from "./types"

const log = Log.create({ service: "runtime-registry.voice" })

const RECORDER_ENV = "LFCODE_RECORDER_PATH"
const FFMPEG_ENV = "LFCODE_FFMPEG_PATH"
const FFPROBE_ENV = "LFCODE_FFPROBE_PATH"
const SOX_VERSION = "14.4.2"

type ManagedVoiceArtifactID = "voice-recorder" | "ffmpeg"
type ManagedFfmpegBinary = "ffmpeg" | "ffprobe"

type ManagedVoiceSource = {
  id: string
  label: string
  url: string
}

type ManagedVoiceMetadata = {
  sourceID: string
  sourceLabel: string
  sourceURL: string
  installedAt: number
}

const MANAGED_VOICE_SOURCES: Record<ManagedVoiceArtifactID, ManagedVoiceSource[]> = {
  "voice-recorder": [
    {
      id: "sox-sourceforge",
      label: "SoX 14.4.2 (SourceForge)",
      url: "https://downloads.sourceforge.net/project/sox/sox/14.4.2/sox-14.4.2-win32.zip",
    },
  ],
  ffmpeg: [
    {
      id: "gyan-essentials",
      label: "FFmpeg Essentials (gyan.dev)",
      url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    },
  ],
}

export type RecorderCommand = {
  cmd: string
  path: string
  source: RuntimeManageSource
  pipeArgs: () => string[]
}

export function managedVoiceRoot() {
  return PluginPath.data("runtime-voice")
}

export function managedRecorderRoot() {
  return path.join(managedVoiceRoot(), `sox-${SOX_VERSION}`)
}

export function managedFfmpegRoot() {
  return path.join(managedVoiceRoot(), "ffmpeg")
}

export function managedRecorderExecutable(root = managedRecorderRoot()) {
  return path.join(root, process.platform === "win32" ? "sox.exe" : "sox")
}

export function managedFfmpegExecutable(binary: ManagedFfmpegBinary, root = managedFfmpegRoot()) {
  const file = process.platform === "win32" ? `${binary}.exe` : binary
  return path.join(root, "bin", file)
}

export function resolveManagedRecorderPath() {
  const resolved = Filesystem.windowsPath(managedRecorderExecutable())
  if (Filesystem.stat(resolved)?.isFile()) return resolved
}

export function resolveConfiguredRecorderPath() {
  const configured = process.env[RECORDER_ENV]
  if (!configured) return
  const resolved = Filesystem.windowsPath(configured)
  if (Filesystem.stat(resolved)?.isFile()) return resolved
}

export function resolveManagedFfmpegBinary(binary: ManagedFfmpegBinary) {
  const resolved = Filesystem.windowsPath(managedFfmpegExecutable(binary))
  if (Filesystem.stat(resolved)?.isFile()) return resolved
}

export function resolveConfiguredFfmpegBinary(binary: ManagedFfmpegBinary) {
  const configured = binary === "ffmpeg" ? process.env[FFMPEG_ENV] : process.env[FFPROBE_ENV]
  if (!configured) return
  const resolved = Filesystem.windowsPath(configured)
  if (Filesystem.stat(resolved)?.isFile()) return resolved
}

export function isManagedVoicePath(candidate: string) {
  const normalized = normalizePath(candidate)
  const managedRoot = normalizePath(managedVoiceRoot())
  return normalized.startsWith(`${managedRoot}/`) || normalized === managedRoot
}

export async function readManagedVoiceMetadata(id: ManagedVoiceArtifactID) {
  const file = path.join(rootForVoiceArtifact(id), ".lfcode-runtime.json")
  return Filesystem.readJson<ManagedVoiceMetadata>(file).catch(() => undefined)
}

export async function installManagedVoiceArtifact(id: ManagedVoiceArtifactID) {
  ensureManagedVoicePlatform()

  const attempts: string[] = []
  for (const source of MANAGED_VOICE_SOURCES[id]) {
    try {
      log.info("installing managed voice runtime", { id, source: source.id, url: source.url })
      const result = await installFromManagedVoiceSource(id, source)
      refreshManagedVoiceEnvironment()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      attempts.push(`${source.label}: ${message}`)
      log.warn("managed voice source failed", { id, source: source.id, error })
    }
  }

  throw new Error(`受管 ${titleForVoiceArtifact(id)} 安装失败。\n${attempts.map((item) => `- ${item}`).join("\n")}`)
}

export async function repairManagedVoiceArtifact(id: ManagedVoiceArtifactID) {
  ensureManagedVoicePlatform()

  const existing = id === "voice-recorder" ? resolveManagedRecorderPath() : resolveManagedFfmpegBinary("ffmpeg")
  if (existing) {
    refreshManagedVoiceEnvironment()
    return {
      path: existing,
      sourceLabel: (await readManagedVoiceMetadata(id))?.sourceLabel,
      reused: true,
    }
  }

  return installManagedVoiceArtifact(id)
}

export function refreshManagedVoiceEnvironment() {
  const recorder = resolveManagedRecorderPath()
  const ffmpeg = resolveManagedFfmpegBinary("ffmpeg")
  const ffprobe = resolveManagedFfmpegBinary("ffprobe")
  setOptionalEnv(RECORDER_ENV, recorder)
  setOptionalEnv(FFMPEG_ENV, ffmpeg)
  setOptionalEnv(FFPROBE_ENV, ffprobe)
}

export function resolveRecorderCommand(): RecorderCommand | null {
  const candidates =
    process.platform === "darwin"
      ? [
          {
            command: "sox",
            pipeArgs: () => ["-d", "-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
          },
          {
            command: "rec",
            pipeArgs: () => ["-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
          },
        ]
      : process.platform === "linux"
        ? [
            {
              command: "arecord",
              pipeArgs: () => ["-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"],
            },
            {
              command: "sox",
              pipeArgs: () => ["-d", "-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
            },
          ]
        : [
            {
              command: "sox",
              pipeArgs: () => ["-d", "-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
            },
          ]

  const system = resolveSystemRecorderCommand(candidates)
  const configured = resolveConfiguredRecorderCandidate()
  const managed = resolveManagedRecorderCandidate()
  const preferred = process.platform === "win32" ? getRuntimeActivationTarget("voice-recorder") : undefined
  const ordered =
    preferred === "system"
      ? [system, configured?.source === "system" ? configured : undefined, managed, configured?.source === "managed" ? configured : undefined]
      : preferred === "managed"
        ? [managed, configured?.source === "managed" ? configured : undefined, system, configured?.source === "system" ? configured : undefined]
        : [configured, managed, system]
  return ordered.find(Boolean) ?? null
}

export function resolveFfmpegBinary(binary: ManagedFfmpegBinary) {
  const configured = resolveConfiguredFfmpegPath(binary)
  const managed = resolveManagedFfmpegPath(binary)
  const system = resolveSystemFfmpegBinary(binary)
  const preferred = getRuntimeActivationTarget("ffmpeg")
  const ordered =
    preferred === "system"
      ? [system, configured?.source === "system" ? configured : undefined, managed, configured?.source === "managed" ? configured : undefined]
      : preferred === "managed"
        ? [managed, configured?.source === "managed" ? configured : undefined, system, configured?.source === "system" ? configured : undefined]
        : [configured, managed, system]
  return ordered.find(Boolean)
}

function resolveCommand(name: string) {
  const resolved = which(name)
  if (!resolved) return
  return {
    path: resolved,
    source: "system" as const,
  }
}

export function resolveSystemRecorderCommand(
  candidates:
    | {
        command: string
        pipeArgs: () => string[]
      }[]
    | undefined = undefined,
) {
  const list =
    candidates ??
    (process.platform === "darwin"
      ? [
          {
            command: "sox",
            pipeArgs: () => ["-d", "-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
          },
          {
            command: "rec",
            pipeArgs: () => ["-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
          },
        ]
      : process.platform === "linux"
        ? [
            {
              command: "arecord",
              pipeArgs: () => ["-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw"],
            },
            {
              command: "sox",
              pipeArgs: () => ["-d", "-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
            },
          ]
        : [
            {
              command: "sox",
              pipeArgs: () => ["-d", "-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
            },
          ])
  return list
    .map((candidate) => {
      const resolved = resolveCommand(candidate.command)
      if (!resolved) return
      return {
        cmd: candidate.command,
        path: resolved.path,
        source: resolved.source,
        pipeArgs: candidate.pipeArgs,
      } satisfies RecorderCommand
    })
    .find(Boolean)
}

function resolveConfiguredRecorderCandidate() {
  const configured = resolveConfiguredRecorderPath()
  if (!configured) return
  return {
    cmd: "sox",
    path: configured,
    source: isManagedVoicePath(configured) ? ("managed" as const) : ("system" as const),
    pipeArgs: () => ["-d", "-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
  } satisfies RecorderCommand
}

function resolveManagedRecorderCandidate() {
  const managed = resolveManagedRecorderPath()
  if (!managed) return
  return {
    cmd: "sox",
    path: managed,
    source: "managed" as const,
    pipeArgs: () => ["-d", "-r", "16000", "-c", "1", "-b", "16", "-t", "raw", "-"],
  } satisfies RecorderCommand
}

function resolveManagedFfmpegPath(binary: ManagedFfmpegBinary) {
  const managed = resolveManagedFfmpegBinary(binary)
  if (!managed) return
  return {
    path: managed,
    source: "managed" as const,
  }
}

function resolveConfiguredFfmpegPath(binary: ManagedFfmpegBinary) {
  const configured = resolveConfiguredFfmpegBinary(binary)
  if (!configured) return
  return {
    path: configured,
    source: isManagedVoicePath(configured) ? ("managed" as const) : ("system" as const),
  }
}

export function resolveSystemFfmpegBinary(binary: ManagedFfmpegBinary) {
  const resolved = which(binary)
  if (!resolved) return
  return {
    path: resolved,
    source: "system" as const,
  }
}

function ensureManagedVoicePlatform() {
  if (process.platform === "win32") return
  throw new Error("语音依赖受管安装当前只支持 Windows。")
}

function titleForVoiceArtifact(id: ManagedVoiceArtifactID) {
  return id === "voice-recorder" ? "录音器" : "FFmpeg"
}

function rootForVoiceArtifact(id: ManagedVoiceArtifactID) {
  return id === "voice-recorder" ? managedRecorderRoot() : managedFfmpegRoot()
}

function normalizePath(value: string) {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase()
}

function setOptionalEnv(key: string, value: string | undefined) {
  if (value) {
    process.env[key] = value
    return
  }
  delete process.env[key]
}

async function installFromManagedVoiceSource(id: ManagedVoiceArtifactID, source: ManagedVoiceSource) {
  const tempDir = path.join(managedVoiceRoot(), "cache", id, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const archivePath = path.join(tempDir, `${id}.zip`)
  const extractDir = path.join(tempDir, "extract")
  const targetRoot = rootForVoiceArtifact(id)

  await fs.mkdir(tempDir, { recursive: true })
  try {
    await downloadManagedVoiceArchive(source.url, archivePath)
    await Archive.extractZip(archivePath, extractDir)
    const locatedRoot =
      id === "voice-recorder"
        ? await findManagedVoiceHome(extractDir, managedRecorderExecutable, "sox")
        : await findManagedVoiceHome(extractDir, (root) => managedFfmpegExecutable("ffmpeg", root), "ffmpeg")
    if (!locatedRoot) {
      throw new Error(`下载归档里没有找到 ${id === "voice-recorder" ? "sox" : "ffmpeg"} 可执行文件。`)
    }

    await fs.rm(targetRoot, { recursive: true, force: true })
    await fs.mkdir(path.dirname(targetRoot), { recursive: true })
    await fs.cp(locatedRoot, targetRoot, { recursive: true, force: true })
    await Filesystem.writeJson(path.join(targetRoot, ".lfcode-runtime.json"), {
      sourceID: source.id,
      sourceLabel: source.label,
      sourceURL: source.url,
      installedAt: Date.now(),
    } satisfies ManagedVoiceMetadata)

    const binaryPath = id === "voice-recorder" ? managedRecorderExecutable(targetRoot) : managedFfmpegExecutable("ffmpeg", targetRoot)
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

async function downloadManagedVoiceArchive(url: string, target: string) {
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

async function findManagedVoiceHome(
  root: string,
  executable: (root: string) => string,
  fallbackName: string,
): Promise<string | undefined> {
  const direct = executable(root)
  if (Filesystem.stat(direct)?.isFile()) return root

  const fallback = path.join(root, process.platform === "win32" ? `${fallbackName}.exe` : fallbackName)
  if (Filesystem.stat(fallback)?.isFile()) return root

  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = await findManagedVoiceHome(path.join(root, entry.name), executable, fallbackName)
    if (nested) return nested
  }
}
