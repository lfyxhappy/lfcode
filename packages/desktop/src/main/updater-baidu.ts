import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"
import semver from "semver"

const DEFAULT_CLI_DIR = "C:\\算法\\小应用\\闲聊\\baidupan-cli"
const DEFAULT_REMOTE_DIR = "/数据库/应用/Lfcode"
const DEFAULT_MANIFEST = "lfcode-update.json"
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const PAGE_SIZE = 1000
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024
const execFileAsync = promisify(execFile)

export type BaiduPanTokenState = {
  accessToken: string
  refreshToken: string
  expiresAtMillis: number
}

export type BaiduPanUpdateManifest = {
  appName: string
  installerName: string
  publisher: string
  releaseNotes: string
  sha256: string
  signature: "authenticode"
  sizeBytes: number
  version: string
  versionCode: number | null
}

export type AuthenticodeSignature = {
  publisher: string
  status: string
  subject: string
}

type BaiduPanDirectoryEntry = {
  fsId: number
  isDirectory: boolean
  name: string
  path: string
  size: number
}

type BaiduPanRemoteFile = {
  fileName: string
  fsId: number
  sizeBytes: number
}

type BaiduPanPlayableUrl = {
  requestHeaders: Record<string, string>
  url: string
}

type TokenPayload = {
  access_token?: unknown
  expires_in?: unknown
  refresh_token?: unknown
  saved_at?: unknown
}

type DownloadResult = {
  installerPath: string
  version: string
}

type BaiduPanUpdaterOptions = {
  appName?: string
  cacheDir: string
  currentVersion: string
  nowMillis?: () => number
}

export class BaiduPanUpdateError extends Error {}

export class BaiduPanUpdater {
  private readonly appName
  private readonly cacheDir
  private readonly cliDir
  private readonly currentVersion
  private readonly manifestFileName
  private readonly nowMillis
  private readonly remoteDir

  constructor(options: BaiduPanUpdaterOptions) {
    this.appName = options.appName ?? "Lfcode"
    this.cacheDir = options.cacheDir
    this.cliDir = process.env.LFCODE_BAIDUPAN_CLI_DIR || DEFAULT_CLI_DIR
    this.currentVersion = options.currentVersion
    this.manifestFileName = process.env.LFCODE_BAIDUPAN_UPDATE_MANIFEST || DEFAULT_MANIFEST
    this.nowMillis = options.nowMillis ?? (() => Date.now())
    this.remoteDir = process.env.LFCODE_BAIDUPAN_UPDATE_DIR || DEFAULT_REMOTE_DIR
  }

  async downloadLatestIfAvailable() {
    const token = await this.refreshTokenIfNeeded()
    const remoteFiles = await this.listRemoteFiles(token.accessToken)
    const manifestFile = remoteFiles.find((item) => item.fileName === this.manifestFileName)
    if (!manifestFile) return
    const manifestText = await this.downloadText(manifestFile.fsId, token.accessToken)
    const manifest = parseBaiduPanUpdateManifest(manifestText, this.appName)
    if (!isRemoteVersionNewer(manifest, this.currentVersion)) return
    const installerFile = remoteFiles.find((item) => item.fileName === manifest.installerName)
    if (!installerFile) {
      throw new BaiduPanUpdateError(`Installer missing in remote directory: ${manifest.installerName}`)
    }
    if (installerFile.sizeBytes !== manifest.sizeBytes) {
      throw new BaiduPanUpdateError("Remote installer size does not match update manifest")
    }
    const installerPath = await this.downloadInstaller(installerFile.fsId, manifest, token.accessToken)
    return {
      installerPath,
      version: manifest.version,
    } satisfies DownloadResult
  }

  private async downloadInstaller(fsId: number, manifest: BaiduPanUpdateManifest, accessToken: string) {
    const playable = await this.resolvePlayableUrl(fsId, accessToken)
    const response = await fetchBaidu(playable.url, { headers: playable.requestHeaders }, "Installer download")
    if (!response.ok || !response.body) {
      throw new BaiduPanUpdateError(`Installer download failed with HTTP ${response.status}`)
    }
    return downloadAndVerifyBaiduPanInstaller(response, this.cacheDir, manifest)
  }

  private async downloadText(fsId: number, accessToken: string) {
    const playable = await this.resolvePlayableUrl(fsId, accessToken)
    const response = await fetchBaidu(playable.url, { headers: playable.requestHeaders }, "Manifest download")
    if (!response.ok) {
      throw new BaiduPanUpdateError(`Manifest download failed with HTTP ${response.status}`)
    }
    return response.text()
  }

  private async fileMetas(fsIds: number[], accessToken: string) {
    const url = new URL("https://pan.baidu.com/rest/2.0/xpan/multimedia")
    url.searchParams.set("method", "filemetas")
    url.searchParams.set("access_token", accessToken)
    url.searchParams.set("fsids", JSON.stringify(fsIds))
    url.searchParams.set("dlink", "1")
    url.searchParams.set("needmedia", "1")
    url.searchParams.set("detail", "1")
    const body = await this.executeJson(url)
    const list = Array.isArray(body.list) ? body.list : []
    return list.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
  }

  private async listDirectory(accessToken: string) {
    const result: BaiduPanDirectoryEntry[] = []
    let start = 0
    while (true) {
      const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file")
      url.searchParams.set("method", "list")
      url.searchParams.set("access_token", accessToken)
      url.searchParams.set("dir", this.remoteDir)
      url.searchParams.set("folder", "0")
      url.searchParams.set("web", "1")
      url.searchParams.set("start", String(start))
      url.searchParams.set("limit", String(PAGE_SIZE))
      url.searchParams.set("order", "name")
      const body = await this.executeJson(url)
      const list = Array.isArray(body.list) ? body.list : []
      for (const item of list) {
        if (typeof item !== "object" || item === null) continue
        result.push({
          fsId: asNumber(item.fs_id),
          isDirectory: asNumber(item.isdir) === 1,
          name: asString(item.server_filename) || asString(item.filename) || path.basename(asString(item.path) || ""),
          path: asString(item.path) || "",
          size: asNumber(item.size),
        })
      }
      if (list.length < PAGE_SIZE) break
      start += PAGE_SIZE
    }
    return result
  }

  private async listRemoteFiles(accessToken: string) {
    const entries = await this.listDirectory(accessToken)
    return entries
      .filter((item) => !item.isDirectory)
      .map((item) => ({
        fileName: item.name,
        fsId: item.fsId,
        sizeBytes: item.size,
      }))
  }

  private async refreshTokenIfNeeded() {
    const current = await this.loadTokenState()
    if (!isExpired(current, this.nowMillis())) return current
    const env = await this.loadEnv()
    const refreshToken = current.refreshToken.trim()
    if (!refreshToken) throw new BaiduPanUpdateError("refresh_token is missing")
    const clientId = env.BAIDUPAN_CLIENT_ID?.trim()
    const clientSecret = env.BAIDUPAN_CLIENT_SECRET?.trim()
    if (!clientId || !clientSecret) {
      throw new BaiduPanUpdateError("Baidu OpenAPI client id/secret is missing")
    }
    const url = new URL("https://openapi.baidu.com/oauth/2.0/token")
    url.searchParams.set("grant_type", "refresh_token")
    url.searchParams.set("refresh_token", refreshToken)
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("client_secret", clientSecret)
    const body = await this.executeJson(url)
    const next = {
      accessToken: asString(body.access_token),
      refreshToken: asString(body.refresh_token) || refreshToken,
      expiresAtMillis: this.nowMillis() + normalizeExpiresIn(body.expires_in) * 1000,
    } satisfies BaiduPanTokenState
    if (!next.accessToken) {
      throw new BaiduPanUpdateError("Baidu token refresh response did not include access_token")
    }
    await this.saveTokenState(next)
    return next
  }

  private async resolvePlayableUrl(fsId: number, accessToken: string) {
    const metadata = (await this.fileMetas([fsId], accessToken))[0]
    const dlink = asString(metadata?.dlink)
    if (!dlink) throw new BaiduPanUpdateError(`Baidu filemetas response missing dlink for fs_id=${fsId}`)
    const url = parseBaiduDownloadUrl(dlink)
    url.searchParams.set("access_token", accessToken)
    return {
      requestHeaders: { "User-Agent": "pan.baidu.com" },
      url: url.toString(),
    } satisfies BaiduPanPlayableUrl
  }

  private async executeJson(url: URL) {
    const response = await fetchBaidu(url, { method: "GET" }, "Baidu API")
    const bodyText = await response.text()
    if (!response.ok) {
      throw new BaiduPanUpdateError(`Baidu request failed with HTTP ${response.status}`)
    }
    const json = bodyText.trim() ? parseJsonObject(bodyText) : {}
    const errno = asNumber((json as Record<string, unknown>).errno)
    if (errno !== 0) {
      throw new BaiduPanUpdateError(`Baidu API returned errno=${errno}`)
    }
    return json as Record<string, unknown>
  }

  private async loadEnv() {
    const envPath = path.join(this.cliDir, ".env")
    const content = await readFile(envPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      throw new BaiduPanUpdateError(`Failed to read Baidu env file: ${error.code ?? error.message}`)
    })
    return parseDotEnv(content)
  }

  private async loadTokenState() {
    const tokenPath = path.join(this.cliDir, ".baidupan-token.json")
    const content = await readFile(tokenPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      throw new BaiduPanUpdateError(`Failed to read Baidu token file: ${error.code ?? error.message}`)
    })
    const parsed = parseJsonObject(content) as TokenPayload
    const accessToken = asString(parsed.access_token)
    const refreshToken = asString(parsed.refresh_token)
    const savedAtMillis = normalizeSavedAtMillis(parsed.saved_at)
    const expiresAtMillis = savedAtMillis > 0 ? savedAtMillis + normalizeExpiresIn(parsed.expires_in) * 1000 : 0
    return {
      accessToken,
      refreshToken,
      expiresAtMillis,
    } satisfies BaiduPanTokenState
  }

  private async saveTokenState(token: BaiduPanTokenState) {
    const tokenPath = path.join(this.cliDir, ".baidupan-token.json")
    const previous = await this.loadRawTokenPayload().catch(() => ({}))
    const expiresIn = Math.max(0, Math.ceil((token.expiresAtMillis - this.nowMillis()) / 1000))
    const savedAt = Math.floor(this.nowMillis() / 1000)
    const next = {
      ...previous,
      access_token: token.accessToken,
      expires_in: expiresIn || TOKEN_TTL_SECONDS,
      refresh_token: token.refreshToken,
      saved_at: savedAt,
    }
    await mkdir(path.dirname(tokenPath), { recursive: true })
    await writeAtomicJson(tokenPath, next)
  }

  private async loadRawTokenPayload() {
    const tokenPath = path.join(this.cliDir, ".baidupan-token.json")
    const content = await readFile(tokenPath, "utf8")
    const parsed = parseJsonObject(content)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  }
}

export function isRemoteVersionNewer(manifest: BaiduPanUpdateManifest, currentVersion: string) {
  if (manifest.versionCode !== null) {
    const currentVersionCode = normalizeCurrentVersionCode(currentVersion)
    if (currentVersionCode !== null) return manifest.versionCode > currentVersionCode
  }
  const current = semver.coerce(currentVersion)
  const remote = semver.coerce(manifest.version)
  if (!current || !remote) return false
  return semver.gt(remote, current)
}

export function parseBaiduPanUpdateManifest(text: string, appName: string) {
  const raw = parseJsonObject(text)
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BaiduPanUpdateError("Update manifest is not a JSON object")
  }
  const object = raw as Record<string, unknown>
  const app = asString(object.appName)
  if (!app) throw new BaiduPanUpdateError("Update manifest missing appName")
  if (app !== appName) throw new BaiduPanUpdateError(`Update manifest appName mismatch: ${app}`)
  const version = asString(object.version)
  if (!version) throw new BaiduPanUpdateError("Update manifest missing version")
  if (!semver.valid(version)) throw new BaiduPanUpdateError("Update manifest has invalid version")
  const installerName = asString(object.installerName)
  if (!installerName) throw new BaiduPanUpdateError("Update manifest missing installerName")
  const sizeBytes = Number(object.sizeBytes)
  const sha256 = asString(object.sha256).trim().toLowerCase()
  const publisher = asString(object.publisher).trim()
  const signature = asString(object.signature).trim().toLowerCase()
  if (signature !== "authenticode") {
    throw new BaiduPanUpdateError("Update manifest requires an unsupported signature type")
  }
  const manifest = {
    appName: app,
    installerName,
    publisher,
    releaseNotes: asString(object.releaseNotes) || "",
    sha256,
    signature,
    sizeBytes,
    version,
    versionCode: normalizeVersionCode(object.versionCode),
  } satisfies BaiduPanUpdateManifest
  validateManifestArtifact(manifest)
  return manifest
}

export async function downloadAndVerifyBaiduPanInstaller(
  response: Response,
  cacheDir: string,
  manifest: BaiduPanUpdateManifest,
  verifySignature: (installerPath: string, publisher: string) => Promise<void> = verifyWindowsAuthenticode,
) {
  validateManifestArtifact(manifest)
  if (!response.ok || !response.body) {
    throw new BaiduPanUpdateError(`Installer download failed with HTTP ${response.status}`)
  }
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength !== manifest.sizeBytes) {
    throw new BaiduPanUpdateError("Installer Content-Length does not match update manifest")
  }

  const stagingRoot = path.join(cacheDir, "updates-staging")
  const activeRoot = path.join(cacheDir, "updates")
  await mkdir(stagingRoot, { recursive: true })
  const stagingDir = await mkdtemp(path.join(stagingRoot, "baidu-"))
  const stagedInstaller = path.join(stagingDir, manifest.installerName)
  const activeDir = path.join(activeRoot, manifest.sha256)
  const activeInstaller = path.join(activeDir, manifest.installerName)

  try {
    let receivedBytes = 0
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length
        if (receivedBytes > manifest.sizeBytes) {
          callback(new BaiduPanUpdateError("Installer download exceeded expected size"))
          return
        }
        callback(null, chunk)
      },
    })
    await pipeline(response.body, limiter, createWriteStream(stagedInstaller, { flags: "wx", mode: 0o600 })).catch(
      (error) => {
        if (error instanceof BaiduPanUpdateError) throw error
        throw new BaiduPanUpdateError("Installer download did not complete")
      },
    )
    await verifyDownloadedInstaller(stagedInstaller, manifest, verifySignature)
    await mkdir(activeRoot, { recursive: true })

    const activeValid = (await fileExists(activeInstaller))
      ? await verifyDownloadedInstaller(activeInstaller, manifest, verifySignature)
          .then(() => true)
          .catch(() => false)
      : false
    if (activeValid) return activeInstaller
    if (await fileExists(activeDir)) await rm(activeDir, { force: true, recursive: true })
    await rename(stagingDir, activeDir).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error
      await verifyDownloadedInstaller(activeInstaller, manifest, verifySignature)
    })
    return activeInstaller
  } finally {
    await rm(stagingDir, { force: true, recursive: true }).catch(() => undefined)
  }
}

export async function verifyDownloadedInstaller(
  installerPath: string,
  manifest: BaiduPanUpdateManifest,
  verifySignature: (installerPath: string, publisher: string) => Promise<void> = verifyWindowsAuthenticode,
) {
  const metadata = await stat(installerPath).catch(() => {
    throw new BaiduPanUpdateError("Downloaded installer is unavailable")
  })
  if (!metadata.isFile() || metadata.size !== manifest.sizeBytes) {
    throw new BaiduPanUpdateError("Downloaded installer size does not match update manifest")
  }

  const handle = await open(installerPath, "r")
  const header = Buffer.alloc(2)
  const result = await handle.read(header, 0, header.length, 0).finally(() => handle.close())
  if (result.bytesRead !== 2 || header.toString("ascii") !== "MZ") {
    throw new BaiduPanUpdateError("Downloaded installer is not a Windows PE file")
  }

  const hash = createHash("sha256")
  for await (const chunk of createReadStream(installerPath)) hash.update(chunk)
  if (hash.digest("hex") !== manifest.sha256) {
    throw new BaiduPanUpdateError("Downloaded installer SHA-256 mismatch")
  }
  await verifySignature(installerPath, manifest.publisher)
}

export async function verifyWindowsAuthenticode(installerPath: string, expectedPublisher: string) {
  if (process.platform !== "win32") {
    throw new BaiduPanUpdateError("Authenticode verification is only available on Windows")
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:LFCODE_UPDATE_VERIFY_PATH",
    "$certificate = $signature.SignerCertificate",
    "$publisher = if ($null -eq $certificate) { '' } else { $certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) }",
    "$subject = if ($null -eq $certificate) { '' } else { $certificate.Subject }",
    "[pscustomobject]@{ status = [string]$signature.Status; publisher = $publisher; subject = $subject } | ConvertTo-Json -Compress",
  ].join("\n")
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const output = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    {
      encoding: "utf8",
      env: { ...process.env, LFCODE_UPDATE_VERIFY_PATH: installerPath },
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  ).catch(() => {
    throw new BaiduPanUpdateError("Authenticode verification could not be completed")
  })
  const parsed = parseJsonObject(output.stdout)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BaiduPanUpdateError("Authenticode verification returned an invalid result")
  }
  const signature = parsed as Record<string, unknown>
  validateAuthenticodeSignature(
    {
      publisher: asString(signature.publisher),
      status: asString(signature.status),
      subject: asString(signature.subject),
    },
    expectedPublisher,
  )
}

export function validateAuthenticodeSignature(signature: AuthenticodeSignature, expectedPublisher: string) {
  if (signature.status !== "Valid") {
    throw new BaiduPanUpdateError(`Downloaded installer Authenticode status is ${signature.status || "unknown"}`)
  }
  const expected = normalizePublisher(expectedPublisher)
  const publishers = [signature.publisher, signature.subject].map(normalizePublisher)
  if (!expected || !publishers.includes(expected)) {
    throw new BaiduPanUpdateError("Downloaded installer publisher does not match update manifest")
  }
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function isExpired(token: BaiduPanTokenState, nowMillis: number) {
  if (!token.accessToken.trim()) return true
  if (!token.refreshToken.trim()) return true
  if (!token.expiresAtMillis) return true
  return token.expiresAtMillis <= nowMillis + 60_000
}

function normalizeExpiresIn(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TOKEN_TTL_SECONDS
}

function normalizeSavedAtMillis(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed <= 9_999_999_999 ? parsed * 1000 : parsed
}

function normalizeVersionCode(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeCurrentVersionCode(version: string) {
  const parsed = semver.parse(version)
  if (!parsed) return null
  return parsed.major * 1000 + parsed.minor * 100 + parsed.patch
}

function parseDotEnv(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .reduce<Record<string, string>>((acc, line) => {
      const eq = line.indexOf("=")
      const key = line.slice(0, eq).trim()
      const raw = line.slice(eq + 1).trim()
      const value =
        (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
          ? raw.slice(1, -1)
          : raw
      if (key) acc[key] = value
      return acc
    }, {})
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new BaiduPanUpdateError("Failed to parse JSON")
  }
}

function validateInstallerName(installerName: string) {
  const invalid =
    installerName !== installerName.trim() ||
    installerName.includes("..") ||
    installerName.includes("/") ||
    installerName.includes("\\") ||
    path.posix.isAbsolute(installerName) ||
    path.win32.isAbsolute(installerName) ||
    path.posix.basename(installerName) !== installerName ||
    path.win32.basename(installerName) !== installerName ||
    /[<>:"|?*\u0000-\u001f]/.test(installerName) ||
    !installerName.toLowerCase().endsWith(".exe")
  if (invalid) throw new BaiduPanUpdateError("Update manifest has unsafe installerName")
}

function validateManifestArtifact(manifest: BaiduPanUpdateManifest) {
  validateInstallerName(manifest.installerName)
  if (
    !Number.isSafeInteger(manifest.sizeBytes) ||
    manifest.sizeBytes <= 0 ||
    manifest.sizeBytes > MAX_INSTALLER_BYTES
  ) {
    throw new BaiduPanUpdateError("Update manifest has invalid sizeBytes")
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new BaiduPanUpdateError("Update manifest has invalid sha256")
  }
  if (!manifest.publisher || manifest.publisher.length > 512 || /[\u0000-\u001f]/.test(manifest.publisher)) {
    throw new BaiduPanUpdateError("Update manifest has invalid publisher")
  }
  if (manifest.signature !== "authenticode") {
    throw new BaiduPanUpdateError("Update manifest requires an unsupported signature type")
  }
}

function normalizePublisher(value: string) {
  return value.trim().toLocaleLowerCase("en-US")
}

function parseBaiduDownloadUrl(value: string) {
  const url = (() => {
    try {
      return new URL(value)
    } catch {
      throw new BaiduPanUpdateError("Baidu filemetas response contained an invalid dlink")
    }
  })()
  const hostname = url.hostname.toLowerCase()
  const allowedHost = ["baidu.com", "baidupcs.com"].some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  )
  if (url.protocol !== "https:" || !allowedHost) {
    throw new BaiduPanUpdateError("Baidu filemetas response contained an untrusted dlink")
  }
  return url
}

async function fetchBaidu(input: string | URL, init: RequestInit, operation: string) {
  return fetch(input, init).catch(() => {
    throw new BaiduPanUpdateError(`${operation} request failed`)
  })
}

async function fileExists(file: string) {
  return stat(file)
    .then(() => true)
    .catch(() => false)
}

async function writeAtomicJson(file: string, payload: Record<string, unknown>) {
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  )
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  await rename(temp, file).finally(() => rm(temp, { force: true }).catch(() => undefined))
}
