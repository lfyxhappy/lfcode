import path from "path"
import fsNode from "fs/promises"
import { Global } from "@/global"
import { Config } from "@/config"
import type { Info, GlobalAppControlPermission } from "@/config/config"

type AutomationDiscovery = {
  host?: string
  port?: number
  token?: string
}

type ClientOptions = {
  host?: string
  port?: number
  token?: string
}

type Method = "GET" | "POST"

type ResponseEnvelope<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
}

export function ensureAppControlAccess(
  config: Info,
  required: "read_only" | "session_control" | "browser_control" | "full_app_control",
) {
  const current = Config.resolveGlobalAppControlConfig(config)
  if (!current.enabled) {
    throw new Error("App Control is disabled in global settings.")
  }
  if (appControlPermissionRank(current.permission) < appControlPermissionRank(required)) {
    throw new Error(
      `App Control permission is '${current.permission}', but this action requires '${required}'.`,
    )
  }
  return current
}

export async function createAppControlClient(options?: ClientOptions) {
  const discovered =
    options?.port || Number(process.env.LFCODE_AUTOMATION_PORT || "0") > 0
      ? undefined
      : await readAutomationDiscovery().catch(() => undefined)
  const host = options?.host ?? discovered?.host ?? process.env.LFCODE_AUTOMATION_HOST ?? "127.0.0.1"
  const port =
    options?.port ??
    (() => {
      const value = Number(process.env.LFCODE_AUTOMATION_PORT || "0")
      return Number.isFinite(value) && value > 0 ? value : discovered?.port
    })()
  const token = options?.token ?? process.env.LFCODE_AUTOMATION_TOKEN ?? discovered?.token ?? ""
  if (!port) {
    throw new Error(
      `No running desktop automation service was discovered. Expected file: ${resolveAutomationStateFile()}`,
    )
  }

  const request = async <T>(method: Method, route: string, body?: unknown) => {
    const response = await fetch(`http://${host}:${port}${route}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = (await response.json()) as ResponseEnvelope<T>
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? `App Control request failed: ${method} ${route}`)
    }
    return payload.data as T
  }

  return {
    get: <T>(route: string) => request<T>("GET", route),
    post: <T>(route: string, body?: unknown) => request<T>("POST", route, body),
  }
}

export function appControlPermissionRank(permission: GlobalAppControlPermission) {
  if (permission === "read_only") return 0
  if (permission === "session_control") return 1
  if (permission === "browser_control") return 2
  return 3
}

async function readAutomationDiscovery() {
  const text = await fsNode.readFile(resolveAutomationStateFile(), "utf8").catch(() => undefined)
  if (!text) return
  return JSON.parse(text) as AutomationDiscovery
}

function resolveAutomationStateFile() {
  if (process.env.LFCODE_AUTOMATION_STATE_FILE) return process.env.LFCODE_AUTOMATION_STATE_FILE
  if (process.env.LFCODE_STATE_DIR) return path.join(process.env.LFCODE_STATE_DIR, "automation", "desktop.json")
  return path.join(Global.Path.home, ".lfcode", "state", "automation", "desktop.json")
}
