import fs from "fs/promises"
import path from "path"
import { managedCppExecutable, managedCppRoot, refreshManagedCppEnvironment } from "@/cpp/runtime"
import { Global } from "@/global"
import { Process } from "@/util"
import { Archive, Filesystem, Log } from "@/util"
import { Shell } from "@/shell/shell"

const log = Log.create({ service: "runtime-registry.cpp" })

type ManagedCppMetadata = {
  sourceID: string
  sourceLabel: string
  sourceURL: string
  installedAt: number
  releaseTag?: string
}

type ManagedCppRelease = {
  tag: string
  assetName: string
  url: string
}

export async function readManagedCppMetadata() {
  return Filesystem.readJson<ManagedCppMetadata>(path.join(managedCppRoot(), ".lfcode-runtime.json")).catch(() => undefined)
}

export function isManagedCppPath(candidate: string) {
  const normalized = normalizePath(candidate)
  const managedRoot = normalizePath(managedCppRoot())
  return normalized.startsWith(`${managedRoot}/`) || normalized === managedRoot
}

export async function installManagedCppCompiler() {
  ensureManagedCppPlatform()
  const release = await resolveLatestWinlibsRelease()
  log.info("installing managed cpp compiler", { release })
  const result = await installWinlibsRelease(release)
  refreshManagedCppEnvironment()
  return result
}

export async function repairManagedCppCompiler() {
  ensureManagedCppPlatform()
  const existing = Filesystem.windowsPath(managedCppExecutable())
  if (Filesystem.stat(existing)?.isFile()) {
    refreshManagedCppEnvironment()
    return {
      path: existing,
      sourceLabel: (await readManagedCppMetadata())?.sourceLabel,
      reused: true,
    }
  }
  return installManagedCppCompiler()
}

function ensureManagedCppPlatform() {
  if (process.platform === "win32") return
  throw new Error("C++ 受管安装当前只支持 Windows。")
}

async function installWinlibsRelease(release: ManagedCppRelease) {
  const tempDir = path.join(Global.Path.cache, "runtime", "cpp", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const archivePath = path.join(tempDir, release.assetName)
  const extractDir = path.join(tempDir, "extract")
  await fs.mkdir(tempDir, { recursive: true })
  try {
    await downloadWithPowerShell(release.url, archivePath)
    await Archive.extractZip(archivePath, extractDir)
    const locatedRoot = await findManagedCppHome(extractDir)
    if (!locatedRoot) {
      throw new Error("下载归档里没有找到 g++.exe。")
    }

    await fs.rm(managedCppRoot(), { recursive: true, force: true })
    await fs.mkdir(path.dirname(managedCppRoot()), { recursive: true })
    await fs.cp(locatedRoot, managedCppRoot(), { recursive: true, force: true })
    await Filesystem.writeJson(path.join(managedCppRoot(), ".lfcode-runtime.json"), {
      sourceID: "winlibs-github",
      sourceLabel: "WinLibs x86_64 posix-seh",
      sourceURL: release.url,
      installedAt: Date.now(),
      releaseTag: release.tag,
    } satisfies ManagedCppMetadata)

    const binaryPath = managedCppExecutable()
    if (!Filesystem.stat(binaryPath)?.isFile()) {
      throw new Error(`受管安装完成后未找到 ${binaryPath}`)
    }

    return {
      path: binaryPath,
      sourceLabel: "WinLibs x86_64 posix-seh",
      reused: false,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function resolveLatestWinlibsRelease(): Promise<ManagedCppRelease> {
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    "$headers = @{ 'User-Agent' = 'lfcode-runtime-test' }",
    "$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/brechtsanders/winlibs_mingw/releases/latest' -Headers $headers",
    "$asset = $release.assets | Where-Object { $_.name -like 'winlibs-x86_64-posix-seh-gcc-*.zip' -and $_.name -notlike '*.sha*' } | Select-Object -First 1",
    "if (-not $asset) { throw 'No matching WinLibs zip asset found.' }",
    "$payload = @{ tag = $release.tag_name; assetName = $asset.name; url = $asset.browser_download_url } | ConvertTo-Json -Compress",
    "Write-Output $payload",
  ].join("; ")
  const result = await Process.text([Shell.resolvePowerShell(), "-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 30_000,
  })
  const payload = result.text.trim()
  if (!payload) throw new Error("WinLibs release source returned empty output.")
  const parsed = JSON.parse(payload) as Partial<ManagedCppRelease>
  if (!parsed.tag || !parsed.assetName || !parsed.url) {
    throw new Error("WinLibs release source returned an incomplete payload.")
  }
  return {
    tag: parsed.tag,
    assetName: parsed.assetName,
    url: parsed.url,
  }
}

async function downloadWithPowerShell(url: string, target: string) {
  const escapedUrl = url.replace(/'/g, "''")
  const escapedTarget = target.replace(/'/g, "''")
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `Invoke-WebRequest -Uri '${escapedUrl}' -OutFile '${escapedTarget}' -MaximumRedirection 5`,
  ].join("; ")
  await Process.run([Shell.resolvePowerShell(), "-NoProfile", "-NonInteractive", "-Command", script], {
    timeout: 10 * 60_000,
  })
}

async function findManagedCppHome(root: string): Promise<string | undefined> {
  const direct = managedCppExecutable(root)
  if (Filesystem.stat(direct)?.isFile()) return root

  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const nested = await findManagedCppHome(path.join(root, entry.name))
    if (nested) return nested
  }
}

function normalizePath(value: string) {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase()
}
