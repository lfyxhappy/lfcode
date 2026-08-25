import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { PluginPath } from "@/plugin/path"
import { Filesystem, Log, Process } from "@/util"
import { which } from "@/util/which"
import { getRuntimeActivationTarget } from "./config"

const log = Log.create({ service: "runtime-registry.officecli" })
const RELEASE_API = "https://api.github.com/repos/iOfficeAI/OfficeCLI/releases/latest"
const REPOSITORY_URL = "https://github.com/iOfficeAI/OfficeCLI"
const NO_UPDATE_ENV = "OFFICECLI_SKIP_UPDATE"

type OfficeCliMetadata = {
  version: string
  assetName: string
  sha256: string
  sourceURL: string
  installedAt: number
}

type OfficeCliCurrent = {
  version: string
  previousVersion?: string
  updatedAt: number
}

type OfficeCliReleaseAsset = {
  name: string
  browser_download_url: string
  digest?: string | null
}

type OfficeCliRelease = {
  tag_name: string
  html_url: string
  assets: OfficeCliReleaseAsset[]
}

export type OfficeCliCommand = {
  path: string
  source: "managed" | "system"
  version?: string
}

export function managedOfficeCliRoot() {
  return PluginPath.data("runtime-officecli")
}

export function managedOfficeCliVersionsRoot() {
  return path.join(managedOfficeCliRoot(), "versions")
}

export function managedOfficeCliCurrentPath() {
  return path.join(managedOfficeCliRoot(), "current.json")
}

export function managedOfficeCliExecutable(version: string) {
  return path.join(managedOfficeCliVersionsRoot(), version, officeCliAssetName())
}

export async function readManagedOfficeCliCurrent() {
  return Filesystem.readJson<OfficeCliCurrent>(managedOfficeCliCurrentPath()).catch(() => undefined)
}

export async function readManagedOfficeCliMetadata(version?: string) {
  const current = version ? { version } : await readManagedOfficeCliCurrent()
  if (!current?.version) return
  return Filesystem.readJson<OfficeCliMetadata>(path.join(managedOfficeCliVersionsRoot(), current.version, ".lfcode-runtime.json")).catch(
    () => undefined,
  )
}

export async function resolveManagedOfficeCli() {
  const current = await readManagedOfficeCliCurrent()
  if (!current?.version) return
  const executable = managedOfficeCliExecutable(current.version)
  if (!Filesystem.stat(executable)?.isFile()) return
  return {
    path: executable,
    source: "managed" as const,
    version: current.version,
  }
}

export function resolveSystemOfficeCli() {
  const executable = which(process.platform === "win32" ? "officecli.exe" : "officecli")
  if (!executable) return
  return {
    path: executable,
    source: "system" as const,
  }
}

export async function resolveOfficeCliCommand(): Promise<OfficeCliCommand | undefined> {
  const managed = await resolveManagedOfficeCli()
  const system = resolveSystemOfficeCli()
  const preferred = getRuntimeActivationTarget("officecli")
  const command = (preferred === "system" ? [system, managed] : [managed, system]).find(Boolean)
  if (!command) return
  return command
}

export async function installManagedOfficeCli() {
  return installOfficeCliRelease()
}

export async function updateManagedOfficeCli() {
  return installOfficeCliRelease()
}

export async function repairManagedOfficeCli() {
  ensureManagedOfficeCliPlatform()
  const current = await resolveManagedOfficeCli()
  if (current && (await smokeOfficeCli(current.path))) {
    return {
      path: current.path,
      version: current.version,
      sourceLabel: (await readManagedOfficeCliMetadata(current.version))?.sourceURL ?? REPOSITORY_URL,
      reused: true,
    }
  }

  const fallback = await findFallbackOfficeCliVersion(current?.version)
  if (fallback) {
    const previous = await readManagedOfficeCliCurrent()
    await writeCurrentOfficeCliVersion(fallback.version, previous?.version)
    return {
      path: fallback.path,
      version: fallback.version,
      sourceLabel: (await readManagedOfficeCliMetadata(fallback.version))?.sourceURL ?? REPOSITORY_URL,
      reused: false,
    }
  }

  return installOfficeCliRelease()
}

async function installOfficeCliRelease() {
  ensureManagedOfficeCliPlatform()
  const release = await fetchOfficeCliRelease()
  const current = await resolveManagedOfficeCli()
  if (current?.version === release.version && (await smokeOfficeCli(current.path))) {
    return {
      path: current.path,
      version: current.version,
      sourceLabel: release.releaseURL,
      reused: true,
    }
  }

  const temporary = path.join(managedOfficeCliRoot(), "cache", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const download = path.join(temporary, release.asset.name)
  const staging = path.join(temporary, "version")
  const target = path.join(managedOfficeCliVersionsRoot(), release.version)

  await fs.mkdir(staging, { recursive: true })
  try {
    await downloadOfficeCliAsset(release.asset.browser_download_url, download)
    const hash = await hashFile(download)
    if (hash !== release.sha256) {
      throw new Error(`OfficeCLI 下载校验失败：期望 ${release.sha256}，实际 ${hash}。`)
    }

    const executable = path.join(staging, officeCliAssetName())
    await fs.copyFile(download, executable)
    if (process.platform !== "win32") await fs.chmod(executable, 0o755)
    if (!(await smokeOfficeCli(executable))) {
      throw new Error("OfficeCLI 安装校验失败：`--version` 未成功返回。")
    }

    await writeOfficeCliLicense(staging, release.licenseURL)
    await Filesystem.writeJson(path.join(staging, ".lfcode-runtime.json"), {
      version: release.version,
      assetName: release.asset.name,
      sha256: release.sha256,
      sourceURL: release.releaseURL,
      installedAt: Date.now(),
    } satisfies OfficeCliMetadata)

    await fs.mkdir(managedOfficeCliVersionsRoot(), { recursive: true })
    await fs.rm(target, { recursive: true, force: true })
    await fs.rename(staging, target)
    await writeCurrentOfficeCliVersion(release.version, current?.version)
    return {
      path: managedOfficeCliExecutable(release.version),
      version: release.version,
      sourceLabel: release.releaseURL,
      reused: false,
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function fetchOfficeCliRelease() {
  const response = await fetch(RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Lfcode-runtime-manager",
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`OfficeCLI release 查询失败：${response.status} ${response.statusText}`)
  const data = (await response.json()) as OfficeCliRelease
  const version = typeof data.tag_name === "string" && data.tag_name.trim() ? data.tag_name.trim() : undefined
  const releaseURL = typeof data.html_url === "string" && data.html_url ? data.html_url : REPOSITORY_URL
  const asset = data.assets?.find((item) => item.name === officeCliAssetName())
  const digest = asset?.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length).toLowerCase() : undefined
  if (!version || !asset || !digest) {
    throw new Error(`OfficeCLI release 缺少 ${officeCliAssetName()} 或其 SHA-256 digest。`)
  }
  return {
    version,
    releaseURL,
    licenseURL: `https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/${encodeURIComponent(version)}/LICENSE`,
    asset,
    sha256: digest,
  }
}

function officeCliAssetName() {
  if (process.platform === "win32") return process.arch === "arm64" ? "officecli-win-arm64.exe" : "officecli-win-x64.exe"
  if (process.platform === "darwin") return process.arch === "arm64" ? "officecli-mac-arm64" : "officecli-mac-x64"
  if (process.platform === "linux") return process.arch === "arm64" ? "officecli-linux-arm64" : "officecli-linux-x64"
  throw new Error(`OfficeCLI 暂不支持 ${process.platform}/${process.arch}。`)
}

function ensureManagedOfficeCliPlatform() {
  officeCliAssetName()
}

async function downloadOfficeCliAsset(url: string, target: string) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`OfficeCLI 下载失败：${response.status} ${response.statusText}`)
  if (!response.body) throw new Error("OfficeCLI 下载失败：响应体为空。")
  await Filesystem.writeStream(target, response.body)
}

async function hashFile(file: string) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex")
}

async function smokeOfficeCli(command: string) {
  try {
    const result = await Process.run([command, "--version"], {
      env: { ...process.env, [NO_UPDATE_ENV]: "1" },
      nothrow: true,
      timeout: 15_000,
    })
    if (result.code !== 0) return false
    return `${result.stdout.toString("utf8")}\n${result.stderr.toString("utf8")}`.trim().length > 0
  } catch (error) {
    log.warn("officecli smoke test failed", { command, error })
    return false
  }
}

async function writeCurrentOfficeCliVersion(version: string, previousVersion?: string) {
  await fs.mkdir(managedOfficeCliRoot(), { recursive: true })
  await Filesystem.writeJson(managedOfficeCliCurrentPath(), {
    version,
    ...(previousVersion && previousVersion !== version ? { previousVersion } : {}),
    updatedAt: Date.now(),
  } satisfies OfficeCliCurrent)
}

async function findFallbackOfficeCliVersion(exclude?: string) {
  const entries = await fs.readdir(managedOfficeCliVersionsRoot(), { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name !== exclude)
      .map(async (entry) => {
        const metadata = await readManagedOfficeCliMetadata(entry.name)
        return metadata ? { version: entry.name, installedAt: metadata.installedAt } : undefined
      }),
  )
  const resolved = candidates.filter((item): item is { version: string; installedAt: number } => item !== undefined)
  for (const candidate of resolved.toSorted((a, b) => b.installedAt - a.installedAt)) {
    const executable = managedOfficeCliExecutable(candidate.version)
    if (await smokeOfficeCli(executable)) return { version: candidate.version, path: executable }
  }
}

async function writeOfficeCliLicense(directory: string, licenseURL: string) {
  const license = await fetch(licenseURL, { signal: AbortSignal.timeout(30_000) })
  if (!license.ok) throw new Error(`OfficeCLI LICENSE 下载失败：${license.status} ${license.statusText}`)
  await fs.writeFile(path.join(directory, "LICENSE.txt"), await license.text(), "utf8")
  await fs.writeFile(
    path.join(directory, "NOTICE.txt"),
    ["OfficeCLI", REPOSITORY_URL, "License: Apache-2.0", "Downloaded and managed by Lfcode."].join("\n") + "\n",
    "utf8",
  )
}
