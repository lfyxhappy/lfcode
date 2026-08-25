import { DEFAULT_SERVER_URL_KEY, WSL_ENABLED_KEY } from "./constants"
import { app, safeStorage } from "electron"
import { join } from "node:path"
import { prepareServerEnv } from "./server-env"
import { getStore } from "./store"

export type WslConfig = { enabled: boolean }

export type HealthCheck = { wait: Promise<void> }

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function getWslConfig(): WslConfig {
  const value = getStore().get(WSL_ENABLED_KEY)
  return { enabled: typeof value === "boolean" ? value : false }
}

export function setWslConfig(config: WslConfig) {
  getStore().set(WSL_ENABLED_KEY, config.enabled)
}

export async function spawnLocalServer(hostname: string, port: number, password: string) {
  const url = `http://${hostname}:${port}`
  if (app.isPackaged) process.env.LFCODE_WEB_UI_DIR = join(app.getAppPath(), "out", "web-ui")
  // The managed LFCODE_HOME is intentionally app-specific. Claude Code keeps
  // its user configuration under the OS account home, so preserve that path
  // explicitly for the embedded server when Electron does not inherit it.
  process.env.USERPROFILE ??= app.getPath("home")
  process.env.HOME ??= app.getPath("home")
  prepareServerEnv(password, url)
  const { Log, PluginSecureStorageHost, Server } = await import("virtual:lfcode-server")
  PluginSecureStorageHost.register({
    status: () => safeStorage.isEncryptionAvailable() ? "available" : "unavailable",
    async encrypt(value: string) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system")
      return safeStorage.encryptString(value).toString("base64")
    },
    async decrypt(value: string) {
      if (!safeStorage.isEncryptionAvailable()) return
      return safeStorage.decryptString(Buffer.from(value, "base64"))
    },
  })
  await Log.init({ level: "WARN" })
  const listener = await Server.listen({
    port,
    hostname,
    username: "lfcode",
    password,
    cors: ["oc://renderer"],
  })

  const wait = (async () => {
    const ready = async () => {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (await checkHealth(url, password)) return
      }
    }

    await ready()
  })()

  return { listener, health: { wait } }
}

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrl: URL
  try {
    healthUrl = new URL("/global/health", url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`lfcode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
