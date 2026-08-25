import { createHash, randomBytes, X509Certificate } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:https"
import { hostname } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { app, safeStorage } from "electron"
import { LAN_PROMPT_MAX_REQUEST_BYTES } from "./lan-prompt-attachments"

type StoredState = {
  version: 1
  enabled?: boolean
  certificateAddresses?: string[]
  certificateUpdated?: {
    at: number
    reason: "network_changed" | "manual_reset"
  }
  access: {
    hostID: string
    devices: Array<{ id: string; name: string; tokenHash: string; createdAt: number; lastSeenAt: number; revokedAt?: number }>
    pairing?: { keyHash: string; expiresAt: number }
    failedPairingAttempts: Record<string, { count: number; startedAt: number }>
    successfulPairingAttempts?: Record<string, { count: number; startedAt: number }>
  }
  certificate: {
    der: string
    encryptedPassphrase: string
    encryptedPfx: string
  }
}

type MobileServer = Server & { closeAllConnections?: () => void; closeIdleConnections?: () => void }
const DEFAULT_LAN_PORT = 43173
const MAX_LAN_REQUEST_BYTES = LAN_PROMPT_MAX_REQUEST_BYTES
const LAN_REQUEST_TIMEOUT_MS = 15_000
const BROWSER_PAIRING_TTL_MS = 10 * 60 * 1000

export type LanAccessManager = {
  enabled: () => boolean
  setEnabled: (enabled: boolean) => Promise<void>
  start: (input: { hostname?: string; port?: number }) => Promise<LanAccessConnection>
  applyNetworkChange: () => Promise<LanAccessConnection>
  stop: () => Promise<void>
  revoke: (deviceID: string) => Promise<boolean>
  listDevices: () => Promise<LanAccessDevice[]>
  createBrowserPairing: () => Promise<LanBrowserPairing>
  resetCertificate: () => Promise<void>
}

export type LanAccessConnection = {
  hostID: string
  port?: number
  spkiSha256?: string
  endpoints: string[]
  certificateStale: boolean
  pendingEndpoints?: string[]
  certificateUpdated?: {
    at: number
    reason: "network_changed" | "manual_reset"
  }
}

export type LanAccessDevice = {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
}

export type LanBrowserPairing = {
  url: string
  expiresAt: number
}

export type MobileAccessManager = LanAccessManager

export async function createLanAccessManager(): Promise<LanAccessManager> {
  const mobile = await import("virtual:lfcode-server")
  const state = await loadState(mobile.LanAccess)
  let server: MobileServer | undefined
  let serverPort: number | undefined

  let persistTail = Promise.resolve()
  const persist = () => {
    const next = persistTail.then(() => saveState(state))
    persistTail = next.catch(() => undefined)
    return next
  }
  let transition = Promise.resolve()
  const synchronized = <T>(task: () => Promise<T>) => {
    const next = transition.then(task, task)
    transition = next.then(() => undefined, () => undefined)
    return next
  }
  const routes = mobile.LanAccess.LanAccessRoutes({
    access: state.access,
    hostName: hostname(),
    version: app.getVersion(),
    capabilities: ["desktop"],
    service: lanServiceRequest,
  })

  return {
    enabled: () => state.enabled !== false,
    async setEnabled(enabled) {
      state.enabled = enabled
      await persist()
    },
    start: (input) => synchronized(() => startListener(input)),
    applyNetworkChange: () => synchronized(applyNetworkChange),
    stop: () => synchronized(stopListener),
    async revoke(deviceID) {
      const device = mobile.Mobile.revokeDevice(state.access, deviceID)
      if (!device) return false
      await persist()
      return true
    },
    async listDevices() {
      const devices: unknown = mobile.Mobile.listDevices(state.access)
      if (!Array.isArray(devices)) return []
      return devices.flatMap(publicLanAccessDevice)
    },
    createBrowserPairing: () => synchronized(createBrowserPairing),
    resetCertificate: () => synchronized(resetCertificate),
  }

  async function startListener(input: { hostname?: string; port?: number }): Promise<LanAccessConnection> {
    const addresses = mobile.LanAccess.lanAddresses()
    if (mobile.LanAccess.lanCertificateAddressesChanged(state.certificateAddresses, addresses)) {
      await stopListener()
      return staleConnection(addresses, input.port)
    }
    if (server && serverPort) return activeConnection(serverPort)
      const pfx = Buffer.from(decrypt(state.certificate.encryptedPfx), "base64")
      const passphrase = decrypt(state.certificate.encryptedPassphrase)
      const createListener = (): MobileServer => createServer({ pfx, passphrase }, async (request, response) => {
        try {
          if (!mobile.LanAccess.isLanAddress(request.socket.remoteAddress)) {
            response.statusCode = 403
            response.setHeader("content-type", "application/json")
            response.end(JSON.stringify({ error: { code: "lan_only", message: "Lfcode LAN access only accepts private network clients", retryable: false } }))
            return
          }
          const headers = new Headers(request.headers as Record<string, string>)
          headers.set("x-lfcode-mobile-source", request.socket.remoteAddress ?? "unknown")
          const url = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`)
          if (request.method !== "GET" && request.method !== "HEAD" && declaredRequestBodyTooLarge(request)) throw new RequestBodyTooLargeError()
          const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readRequestBody(request)
          const result = await routes.request(url, { method: request.method, headers, body })
          await persist()
          result.headers.forEach((value: string, key: string) => response.setHeader(key, value))
          response.statusCode = result.status
          if (result.headers.get("content-type")?.includes("text/event-stream") && result.body) {
            Readable.fromWeb(result.body as never).pipe(response)
            return
          }
          response.end(Buffer.from(await result.arrayBuffer()))
        } catch (cause) {
          response.statusCode = cause instanceof RequestBodyTooLargeError ? 413 : 500
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify({ error: { code: cause instanceof RequestBodyTooLargeError ? "payload_too_large" : "internal_error", message: cause instanceof RequestBodyTooLargeError ? "LAN request body is too large" : "Mobile gateway request failed", retryable: false } }))
        }
      })
      const listener = createListener()
      listener.headersTimeout = LAN_REQUEST_TIMEOUT_MS
      listener.requestTimeout = LAN_REQUEST_TIMEOUT_MS
      listener.keepAliveTimeout = 5_000
      const port = await listen(listener, input.hostname ?? "0.0.0.0", input.port ?? DEFAULT_LAN_PORT).catch(async (error) => {
        await new Promise<void>((resolve) => listener.close(() => resolve()))
        throw error
      })
      server = listener
      serverPort = port
      await persist()
      return activeConnection(port)
  }

  async function stopListener() {
    const current = server
    server = undefined
    serverPort = undefined
    if (!current) return
    current.closeIdleConnections?.()
    current.closeAllConnections?.()
    await new Promise<void>((resolve, reject) => current.close((error) => (error ? reject(error) : resolve())))
  }

  async function createBrowserPairing(): Promise<LanBrowserPairing> {
    if (state.enabled === false) throw new Error("Enable LAN access before creating a browser link")
    const connection = await startListener({})
    if (connection.certificateStale) throw new Error("Update the LAN certificate before creating a browser link")
    const endpoint = connection.endpoints[0]
    if (!endpoint) throw new Error("No private network address is available for browser access")
    const pairing = mobile.LanAccess.createPairing(state.access, Date.now(), BROWSER_PAIRING_TTL_MS)
    const url = new URL(endpoint)
    url.searchParams.set("pair", pairing.key)
    await persist()
    return { url: url.toString(), expiresAt: pairing.expiresAt }
  }

  async function applyNetworkChange(): Promise<LanAccessConnection> {
    const addresses = mobile.LanAccess.lanAddresses()
    if (!mobile.LanAccess.lanCertificateAddressesChanged(state.certificateAddresses, addresses)) return startListener({})
    const certificate = await createCertificate(addresses)
    const next = certificateState({ addresses, certificate, reason: "network_changed" })
    await saveState(next)
    await stopListener()
    applyCertificateState(next)
    return startListener({})
  }

  async function resetCertificate() {
    if (server) throw new Error("Disable LAN access before resetting its certificate")
    const addresses = mobile.LanAccess.lanAddresses()
    const certificate = await createCertificate(addresses)
    await replaceCertificate({ addresses, certificate, reason: "manual_reset" })
  }

  async function replaceCertificate(input: {
    addresses: string[]
    certificate: StoredState["certificate"]
    reason: "network_changed" | "manual_reset"
  }) {
    const next = certificateState(input)
    await saveState(next)
    applyCertificateState(next)
  }

  function certificateState(input: {
    addresses: string[]
    certificate: StoredState["certificate"]
    reason: "network_changed" | "manual_reset"
  }) {
    return {
      ...state,
      certificateAddresses: input.addresses,
      certificate: input.certificate,
      certificateUpdated: { at: Date.now(), reason: input.reason },
      access: {
        ...state.access,
        devices: [],
        pairing: undefined,
        failedPairingAttempts: {},
        successfulPairingAttempts: {},
      },
    } satisfies StoredState
  }

  function applyCertificateState(next: StoredState) {
    state.certificateAddresses = next.certificateAddresses
    state.certificate = next.certificate
    state.certificateUpdated = next.certificateUpdated
    Object.assign(state.access, next.access)
  }

  function activeConnection(port: number): LanAccessConnection {
    return {
      hostID: state.access.hostID,
      port,
      spkiSha256: pin(state.certificate.der),
      endpoints: mobile.LanAccess.lanEndpoints(port, state.certificateAddresses),
      certificateStale: false,
      certificateUpdated: state.certificateUpdated,
    }
  }

  function staleConnection(addresses: string[], port = serverPort ?? DEFAULT_LAN_PORT): LanAccessConnection {
    return {
      hostID: state.access.hostID,
      endpoints: [],
      certificateStale: true,
      pendingEndpoints: mobile.LanAccess.lanEndpoints(port, addresses),
      certificateUpdated: state.certificateUpdated,
    }
  }
}

function publicLanAccessDevice(value: unknown): LanAccessDevice[] {
  if (!value || typeof value !== "object") return []
  const device = value as Record<string, unknown>
  if (typeof device.id !== "string" || typeof device.name !== "string" || typeof device.createdAt !== "number" || typeof device.lastSeenAt !== "number") return []
  return [{
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    revokedAt: typeof device.revokedAt === "number" ? device.revokedAt : undefined,
  }]
}

async function lanServiceRequest(request: Request) {
  const url = new URL(request.url)
  const base = process.env.LFCODE_SERVER_URL
  const authorization = process.env.LFCODE_SERVER_AUTH
  if (!base || !authorization) return lanError(503, "service_unavailable", "Local Lfcode sidecar is unavailable")
  const headers = new Headers(request.headers)
  headers.delete("authorization")
  headers.delete("cookie")
  headers.delete("host")
  headers.delete("x-lfcode-mobile-source")
  headers.set("authorization", authorization)
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
  return fetch(new URL(`${url.pathname}${url.search}`, base), { method: request.method, headers, body })
}

function lanError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message, retryable: status >= 500 } }, { status })
}

export const createMobileAccessManager = createLanAccessManager

async function loadState(mobile: { createMobileAccessState: () => StoredState["access"]; lanAddresses: () => string[] }): Promise<StoredState> {
  const file = stateFile()
  const existing = await loadStoredState(file)
  if (existing?.version === 1) {
    try {
      decrypt(existing.certificate.encryptedPfx)
      decrypt(existing.certificate.encryptedPassphrase)
    } catch {
      // Windows can rotate the DPAPI context between pre-release builds. The
      // certificate private key is then irrecoverable, so reset this isolated
      // LAN credential instead of preventing the desktop settings from loading.
      const certificateAddresses = mobile.lanAddresses()
      const state = {
        version: 1,
        enabled: existing.enabled ?? true,
        certificateAddresses,
        access: mobile.createMobileAccessState(),
        certificate: await createCertificate(certificateAddresses),
      } satisfies StoredState
      await saveState(state)
      return state
    }
    const state = {
      ...existing,
      enabled: existing.enabled ?? true,
      access: {
        ...existing.access,
        pairing: undefined,
        successfulPairingAttempts: existing.access.successfulPairingAttempts ?? {},
      },
    }
    if (existing.access.pairing) await saveState(state)
    return state
  }
  const certificateAddresses = mobile.lanAddresses()
  const certificate = await createCertificate(certificateAddresses)
  return {
    version: 1,
    enabled: true,
    certificateAddresses,
    access: mobile.createMobileAccessState(),
    certificate,
  }
}

async function saveState(state: StoredState) {
  await mkdir(stateDirectory(), { recursive: true })
  const destination = stateFile()
  const temporary = `${destination}.${randomBytes(12).toString("hex")}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function loadStoredState(file: string): Promise<StoredState | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as StoredState
  } catch (cause) {
    if (typeof cause === "object" && cause && "code" in cause && cause.code === "ENOENT") return
    throw cause
  }
}

async function createCertificate(addresses: string[]): Promise<StoredState["certificate"]> {
  if (process.platform !== "win32") throw new Error("Lfcode mobile access certificate generation currently requires Windows")
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure desktop storage is unavailable")
  await mkdir(stateDirectory(), { recursive: true })
  const temporaryPfx = join(stateDirectory(), `certificate-${randomBytes(12).toString("hex")}.pfx`)
  try {
    const result = JSON.parse(await runPowerShell(`
$ErrorActionPreference = 'Stop'
$passphrase = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$password = ConvertTo-SecureString -String $passphrase -AsPlainText -Force
$san = '${addresses.map((address) => `IPAddress=${address}`).join("&")}'
$parameters = @{ Type = 'Custom'; Subject = 'CN=Lfcode LAN'; KeyAlgorithm = 'RSA'; KeyLength = 2048; HashAlgorithm = 'SHA256'; KeyExportPolicy = 'Exportable'; CertStoreLocation = 'Cert:\\CurrentUser\\My'; NotAfter = (Get-Date).AddYears(10) }
if ($san) { $parameters['TextExtension'] = @("2.5.29.17={text}$san") }
$cert = New-SelfSignedCertificate @parameters
Export-PfxCertificate -Cert $cert -FilePath '${temporaryPfx.replaceAll("'", "''")}' -Password $password | Out-Null
[pscustomobject]@{ passphrase = $passphrase; der = [Convert]::ToBase64String($cert.RawData) } | ConvertTo-Json -Compress
Remove-Item "Cert:\\CurrentUser\\My\\$($cert.Thumbprint)" -Force
`)) as { passphrase: string; der: string }
    const pfx = await readFile(temporaryPfx)
    return {
      der: result.der,
      encryptedPassphrase: encrypt(result.passphrase),
      encryptedPfx: encrypt(pfx.toString("base64")),
    }
  } finally {
    await rm(temporaryPfx, { force: true }).catch(() => undefined)
  }
}

function runPowerShell(script: string) {
  return new Promise<string>((resolve, reject) => {
    const command = process.env.LFCODE_PWSH_PATH || "powershell.exe"
    const child = spawn(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout).toString("utf8").trim())
      reject(new Error(`Mobile certificate generation failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`))
    })
    child.stdin.end(script)
  })
}

function stateDirectory() {
  return join(process.env.LFCODE_DATA_DIR || app.getPath("userData"), "mobile-access")
}

function stateFile() {
  return join(stateDirectory(), "state.json")
}

function encrypt(value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure desktop storage is unavailable")
  return safeStorage.encryptString(value).toString("base64")
}

function decrypt(value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure desktop storage is unavailable")
  return safeStorage.decryptString(Buffer.from(value, "base64"))
}

function pin(der: string) {
  const certificate = new X509Certificate(Buffer.from(der, "base64"))
  return createHash("sha256").update(certificate.publicKey.export({ format: "der", type: "spki" })).digest("base64")
}

class RequestBodyTooLargeError extends Error {}

function declaredRequestBodyTooLarge(request: { headers: Record<string, string | string[] | undefined> }) {
  const value = request.headers["content-length"]
  const size = Number(Array.isArray(value) ? value[0] : value)
  return Number.isFinite(size) && size > MAX_LAN_REQUEST_BYTES
}

function readRequestBody(request: NodeJS.ReadableStream) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    request.on("data", (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size <= MAX_LAN_REQUEST_BYTES) return chunks.push(chunk)
      settled = true
      request.resume()
      reject(new RequestBodyTooLargeError())
    })
    request.on("end", () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    request.on("error", (cause) => {
      if (settled) return
      settled = true
      reject(cause)
    })
  })
}

function listen(server: MobileServer, hostname: string, port: number) {
  return new Promise<number>((resolve, reject) => {
    const failure = (error: Error) => {
      cleanup()
      reject(error)
    }
    const ready = () => {
      cleanup()
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Mobile gateway did not expose a TCP port"))
      resolve(address.port)
    }
    const cleanup = () => {
      server.off("error", failure)
      server.off("listening", ready)
    }
    server.once("error", failure)
    server.once("listening", ready)
    server.listen(port, hostname)
  })
}
