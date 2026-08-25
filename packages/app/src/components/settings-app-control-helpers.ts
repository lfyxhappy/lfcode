export type AppControlPermission = "read_only" | "session_control" | "browser_control" | "full_app_control"
export type BrowserControlPermission = "read_only" | "interactive"
export type AppControlTarget = "app"

export type AppControlServiceState = {
  discoveryFile: string
  detected: boolean
  host?: string
  port?: number
  pid?: number
  version?: string
  startedAt?: number
  protocolVersion?: number
  instanceID?: string
}

export type AppControlDraft = {
  enabled: boolean
  permission: AppControlPermission
  browser: {
    enabled: boolean
    permission: BrowserControlPermission
  }
}

export type AppControlState = AppControlDraft & {
  target: AppControlTarget
  availableTargets: AppControlTarget[]
  service: AppControlServiceState
}

export type AppControlEvent = {
  id: number
  scope: string
  type: string
  timestamp: number
  data?: Record<string, unknown>
}

export type AppControlRequestLog = {
  requestID: string
  scope: string
  timestamp: number
  method?: string
  path?: string
  status?: number
  durationMs?: number
  failed: boolean
}

export type AppControlEventScopeFilter = "all" | "main" | "renderer" | "server"
export type AppControlEventKindFilter = "all" | "requests" | "errors"

export function normalizeAppControlTargets(input: AppControlState | undefined) {
  const available: AppControlTarget[] = input?.availableTargets?.length ? [...input.availableTargets] : ["app"]
  const targets = Array.from(new Set<AppControlTarget>(available))
  const selected = targets.includes(input?.target ?? "app") ? (input?.target ?? "app") : targets[0]
  return { targets, selected }
}

export function createAppControlDraft(input: AppControlState): AppControlDraft {
  return {
    enabled: input.enabled,
    permission: input.permission,
    browser: input.browser ?? { enabled: true, permission: "interactive" },
  }
}

export function appControlDirty(saved: AppControlDraft | undefined, draft: AppControlDraft) {
  if (!saved) return false
  return (
    saved.enabled !== draft.enabled ||
    saved.permission !== draft.permission ||
    saved.browser.enabled !== draft.browser.enabled ||
    saved.browser.permission !== draft.browser.permission
  )
}

export function appControlSaveDisabled(input: {
  saved: AppControlDraft | undefined
  draft: AppControlDraft
  loading: boolean
  saving: boolean
  loadError?: string
}) {
  if (input.loading || input.saving) return true
  if (input.loadError) return true
  return !appControlDirty(input.saved, input.draft)
}

export function appControlMessages(loadError?: string, saveError?: string) {
  return [loadError, saveError].filter((value): value is string => !!value)
}

export function normalizeAppControlEvents(input: unknown) {
  if (!Array.isArray(input)) return [] as AppControlEvent[]
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const value = item as Record<string, unknown>
    const timestamp =
      typeof value.timestamp === "number"
        ? value.timestamp
        : typeof value.at === "number"
          ? value.at
          : typeof value.isoTime === "string"
            ? Date.parse(value.isoTime)
            : undefined
    if (
      typeof value.id !== "number" ||
      typeof value.scope !== "string" ||
      typeof value.type !== "string" ||
      timestamp === undefined ||
      !Number.isFinite(timestamp)
    ) {
      return []
    }
    return [
      {
        id: value.id,
        scope: value.scope,
        type: value.type,
        timestamp,
        data: value.data && typeof value.data === "object" && !Array.isArray(value.data) ? (value.data as Record<string, unknown>) : undefined,
      } satisfies AppControlEvent,
    ]
  })
}

export function appControlEventScopeOptions(events: AppControlEvent[]): AppControlEventScopeFilter[] {
  const scopes = events
    .map((event) => event.scope)
    .filter((scope): scope is Exclude<AppControlEventScopeFilter, "all"> => {
      return scope === "main" || scope === "renderer" || scope === "server"
    })
  return ["all", ...Array.from(new Set(scopes))]
}

export function filterAppControlEvents(
  events: AppControlEvent[],
  input: {
    scope: AppControlEventScopeFilter
    kind: AppControlEventKindFilter
  },
) {
  return events.filter((event) => {
    if (input.scope !== "all" && event.scope !== input.scope) return false
    if (input.kind === "all") return true
    if (input.kind === "errors") return event.type.includes("error")
    return event.type === "request" || event.type === "response" || event.type === "response.error"
  })
}

export function summarizeAppControlRequestLogs(events: AppControlEvent[]) {
  const logs = new Map<string, AppControlRequestLog>()
  for (const event of events) {
    const requestID = typeof event.data?.requestID === "string" ? event.data.requestID : undefined
    if (!requestID) continue
    if (event.type !== "request" && event.type !== "response" && event.type !== "response.error") continue
    const current = logs.get(requestID) ?? {
      requestID,
      scope: event.scope,
      timestamp: event.timestamp,
      failed: false,
    }
    current.timestamp = Math.max(current.timestamp, event.timestamp)
    if (typeof event.data?.method === "string") current.method = event.data.method
    if (typeof event.data?.path === "string") current.path = event.data.path
    if (typeof event.data?.status === "number") current.status = event.data.status
    if (typeof event.data?.durationMs === "number") current.durationMs = event.data.durationMs
    if (event.type === "response.error") current.failed = true
    if (typeof current.status === "number" && current.status >= 400) current.failed = true
    logs.set(requestID, current)
  }
  return Array.from(logs.values()).sort((a, b) => b.timestamp - a.timestamp)
}

export function appControlDiagnosticsFilename(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `lfcode-app-control-diagnostics-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`
}
