import { DEFAULT_SERVER_URL_KEY, WSL_ENABLED_KEY } from "./constants"
import { getUserShell, loadShellEnv } from "./shell-env"
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
  prepareServerEnv(password)
  const { Log, Server } = await import("virtual:lfcode-server")
  await Log.init({ level: "WARN" })
  const listener = await Server.listen({
    port,
    hostname,
    username: "lfcode",
    password,
    cors: ["lfcode://renderer"],
  })

  const wait = (async () => {
    const url = `http://${hostname}:${port}`

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

const ROOT_ENV_KEYS = [
  "LFCODE_CONFIG_DIR",
  "LFCODE_DATA_DIR",
  "LFCODE_STATE_DIR",
  "LFCODE_CACHE_DIR",
] as const

function prepareServerEnv(password: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? (loadShellEnv(shell) ?? {}) : {}
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...shellEnv,
    LFCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    LFCODE_EXPERIMENTAL_FILEWATCHER: "true",
    LFCODE_CLIENT: "desktop",
    LFCODE_SERVER_USERNAME: "lfcode",
    LFCODE_SERVER_PASSWORD: password,
  }
  for (const key of ROOT_ENV_KEYS) {
    const value = process.env[key]
    if (!value) continue
    env[key] = value
  }
  Object.assign(process.env, env)
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
