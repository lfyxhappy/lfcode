import type { SubagentContext, SubagentExecution } from "./subagent-presets"

export type AgentPresetContext = "minimal" | "full" | "task"

export type SubagentApiConnection = {
  base?: string
  directory?: string
  username?: string
  password?: string
}

export type AgentManageConfig = {
  description?: string
  mode?: "subagent" | "primary" | "all"
  disable?: boolean
  hidden?: boolean
  model?: string
  model_inheritance?: "primary" | "configured"
  delegation_allowlist?: string[]
  steps?: number
  tool_allowlist?: string[]
  permission?: Record<string, unknown>
  default_execution?: SubagentExecution
  default_context?: AgentPresetContext
  [key: string]: unknown
}

export type AgentManageLayer = {
  scope?: "native" | "global" | "project"
  path?: string
  name?: string
  config: AgentManageConfig
  prompt: string
}

export type AgentManageSource = {
  scope: "native" | "global" | "project"
  path?: string
}

export type AgentManageEditable = {
  global?: boolean
  project?: boolean
  delete?: boolean
}

export type AgentManageItem = {
  id: string
  name?: string
  description?: string
  prompt?: string
  config: AgentManageConfig
  native?: boolean
  source?: "native" | "global" | "project" | string
  origins?: string[]
  nativeLayer?: AgentManageLayer
  global?: AgentManageLayer
  project?: AgentManageLayer
  effective?: AgentManageLayer
  sources?: AgentManageSource[]
  editable?: AgentManageEditable
}

export type AgentManageResponse = {
  items: AgentManageItem[]
}

export type ActorDispatchStatus = "queued" | "running" | "interrupted" | "completed" | "failed" | "cancelled" | string

export type ResearchSnapshot = {
  kind: "deep-research" | string
  title?: string
  depth?: "quick" | "standard" | "deep" | string
  phase?: "planning" | "retrieving" | "verifying" | "synthesizing" | "completed" | "failed" | "cancelled" | string
  subtaskCount?: number
  sourceCount?: number
  citations: string[]
  summary?: string
  startedAt?: number
  completedAt?: number
}

export type ActorDispatch = {
  id: string
  sessionID?: string
  actorID?: string
  agent: string
  description: string
  status: ActorDispatchStatus
  execution?: SubagentExecution
  context?: SubagentContext
  unread?: boolean
  manualResume?: boolean
  queuePosition?: number
  error?: string
  result?: string
  declaredFiles: string[]
  actualFiles: string[]
  conflicts: string[]
  createdAt?: number
  research?: ResearchSnapshot
}

function record(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  return input as Record<string, unknown>
}

function strings(input: unknown) {
  return Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : []
}

function string(input: unknown) {
  return typeof input === "string" ? input : undefined
}

function bool(input: unknown) {
  return typeof input === "boolean" ? input : undefined
}

function number(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined
}

function research(input: unknown): ResearchSnapshot | undefined {
  const value = record(input)
  if (!value || typeof value.kind !== "string") return
  return {
    kind: value.kind,
    title: string(value.title),
    depth: string(value.depth ?? value.research_depth),
    phase: string(value.phase ?? value.research_phase),
    subtaskCount: number(value.subtaskCount ?? value.subtask_count),
    sourceCount: number(value.sourceCount ?? value.source_count),
    citations: strings(value.citations ?? value.evidenceRefs ?? value.evidence_refs ?? value.evidence),
    summary: string(value.summary ?? value.reportSummary ?? value.report_summary),
    startedAt: number(value.startedAt ?? value.started_at),
    completedAt: number(value.completedAt ?? value.completed_at),
  }
}

function scope(input: unknown): AgentManageSource["scope"] | undefined {
  if (input === "native" || input === "global" || input === "project") return input
}

function layer(input: unknown): AgentManageLayer | undefined {
  const value = record(input)
  const config = record(value?.config)
  if (!config) return
  return {
    ...(scope(value?.scope) ? { scope: scope(value?.scope) } : {}),
    ...(string(value?.path) ? { path: string(value?.path) } : {}),
    ...(string(value?.name) ? { name: string(value?.name) } : {}),
    config: config as AgentManageConfig,
    prompt: string(value?.prompt) ?? "",
  }
}

function sources(input: unknown): AgentManageSource[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((value) => {
    const item = record(value)
    const current = scope(item?.scope)
    if (!current) return []
    return [{ scope: current, ...(string(item?.path) ? { path: string(item?.path) } : {}) }]
  })
}

export function subagentContextFromAgentPreset(context: AgentPresetContext | undefined): SubagentContext {
  if (context === "full") return "full"
  if (context === "task") return "none"
  return "state"
}

export function agentPresetContextFromSubagent(context: SubagentContext): AgentPresetContext {
  if (context === "full") return "full"
  if (context === "none") return "task"
  return "minimal"
}

export function agentManageResponse(input: unknown): AgentManageResponse {
  const payload = record(input)
  const list = Array.isArray(input) ? input : Array.isArray(payload?.items) ? payload.items : []
  return {
    items: list.flatMap((value) => {
      const item = record(value)
      const id = string(item?.id) ?? string(item?.name)
      if (!id) return []
      const config = record(item?.config) ?? {}
      return [
        {
          id,
          name: string(item?.name),
          description: string(item?.description),
          prompt: string(item?.prompt),
          config: config as AgentManageConfig,
          native: bool(item?.isNative) ?? bool(item?.native) ?? !!record(item?.native),
          source: string(item?.source),
          origins: strings(item?.origins),
          ...(layer(item?.native) ? { nativeLayer: layer(item?.native) } : {}),
          ...(layer(item?.global) ? { global: layer(item?.global) } : {}),
          ...(layer(item?.project) ? { project: layer(item?.project) } : {}),
          ...(layer(item?.effective) ? { effective: layer(item?.effective) } : {}),
          ...(sources(item?.sources).length > 0 ? { sources: sources(item?.sources) } : {}),
          ...(record(item?.editable)
            ? {
                editable: {
                  global: bool(record(item?.editable)?.global),
                  project: bool(record(item?.editable)?.project),
                  delete: bool(record(item?.editable)?.delete),
                },
              }
            : {}),
        },
      ]
    }),
  }
}

export function actorDispatches(input: unknown): ActorDispatch[] {
  const payload = record(input)
  const list = Array.isArray(input) ? input : Array.isArray(payload?.items) ? payload.items : []
  return list.flatMap((value) => {
    const item = record(value)
    const id = string(item?.id)
    const agent = string(item?.agent)
    if (!id || !agent) return []
    return [
      {
        id,
        sessionID: string(item?.sessionID) ?? string(item?.session_id),
        actorID: string(item?.actorID) ?? string(item?.actor_id),
        agent,
        description: string(item?.description) ?? agent,
        status: string(item?.status) ?? "queued",
        execution: string(item?.execution) === "wait" ? "wait" : "background",
        context: ["none", "state", "full"].includes(string(item?.context) ?? "")
          ? (string(item?.context) as SubagentContext)
          : "state",
        unread: bool(item?.unread),
        manualResume: bool(item?.manualResume ?? item?.manual_resume),
        queuePosition: typeof item?.queuePosition === "number" ? item.queuePosition : undefined,
        error: string(item?.error),
        result: string(item?.result),
        declaredFiles: strings(item?.declaredFiles ?? item?.declared_files ?? item?.files),
        actualFiles: strings(item?.actualFiles ?? item?.actual_files),
        conflicts: strings(item?.conflicts),
        ...(research(item?.research ?? record(item?.payload)?.research)
          ? { research: research(item?.research ?? record(item?.payload)?.research) }
          : {}),
        createdAt:
          typeof record(item?.time)?.created === "number"
            ? (record(item?.time)?.created as number)
            : typeof item?.createdAt === "number"
              ? item.createdAt
              : typeof item?.created_at === "number"
                ? item.created_at
                : undefined,
      },
    ]
  })
}

export function subagentApiUrl(connection: SubagentApiConnection, path: string, query?: Record<string, string | undefined>) {
  if (!connection.base) return
  const url = new URL(path, connection.base)
  if (connection.directory) url.searchParams.set("directory", connection.directory)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

export async function requestSubagentApi<T>(input: {
  connection: SubagentApiConnection
  path: string
  method?: "GET" | "PUT" | "POST" | "DELETE"
  query?: Record<string, string | undefined>
  body?: unknown
}) {
  const url = subagentApiUrl(input.connection, input.path, input.query)
  if (!url) throw new Error("没有可用的服务器连接")
  const auth: Record<string, string> = input.connection.password
    ? { Authorization: `Basic ${btoa(`${input.connection.username ?? "lfcode"}:${input.connection.password}`)}` }
    : {}
  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      ...auth,
      ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })
  if (!response.ok) throw new Error(`${input.method ?? "GET"} ${input.path} 失败 (${response.status})`)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
