import path from "path"
import z from "zod"
import { ProjectTable } from "@/project/project.sql"
import { Database, and, desc, eq, gte, like, lt, or, sql, type SQL } from "@/storage"
import { MessageTable, PartTable, SessionTable } from "./session.sql"

export const UsageRange = z.enum(["today", "7d", "30d", "all"])
export const UsageStatus = z.enum(["completed", "error", "aborted"])
export const UsageAgentKind = z.enum(["main", "subagent"])

export const UsageQuery = z.object({
  range: UsageRange.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  project: z.string().optional(),
  session: z.string().optional(),
  status: UsageStatus.optional(),
  agent_kind: UsageAgentKind.optional(),
  source: z.literal("lfcode").optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.number().int().nonnegative().optional(),
})

const UsageSummary = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreateTokens: z.number(),
  cacheHitTokens: z.number(),
  overheadTokens: z.number(),
  cacheHitRatio: z.union([z.number(), z.null()]),
  requestCount: z.number(),
  totalCost: z.number(),
  overheadCost: z.number(),
  successCount: z.number(),
  errorCount: z.number(),
  abortedCount: z.number(),
  successRate: z.union([z.number(), z.null()]),
  avgDuration: z.union([z.number(), z.null()]),
  avgTtft: z.union([z.number(), z.null()]),
})

const UsageTrendPoint = z.object({
  time: z.number(),
  input: z.number(),
  output: z.number(),
  cacheCreate: z.number(),
  cacheHit: z.number(),
  cost: z.number(),
})

const UsageLog = z.object({
  id: z.string(),
  projectID: z.string(),
  projectName: z.string(),
  projectDirectory: z.string(),
  sessionID: z.string(),
  sessionParentID: z.string().nullable(),
  sessionTitle: z.string(),
  directory: z.string(),
  agentID: z.string(),
  agentKind: UsageAgentKind,
  time: z.number(),
  provider: z.string(),
  model: z.string(),
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  overheadTokens: z.number(),
  overheadCost: z.number(),
  totalTokens: z.number(),
  cost: z.number(),
  duration: z.number().nullable(),
  ttft: z.number().nullable(),
  submitToFirstDelta: z.number().nullable(),
  preStream: z.number().nullable(),
  status: UsageStatus,
  source: z.literal("lfcode"),
})

const UsageBucketStat = z.object({
  provider: z.string(),
  model: z.string().optional(),
  requestCount: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  share: z.number(),
})

const UsageProjectStat = z.object({
  projectID: z.string(),
  projectName: z.string(),
  directory: z.string(),
  requestCount: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  share: z.number(),
})

const UsageSessionStat = z.object({
  sessionID: z.string(),
  sessionTitle: z.string(),
  projectName: z.string(),
  directory: z.string(),
  requestCount: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  share: z.number(),
})

export const UsageResponse = z.object({
  summary: UsageSummary,
  trend: z.array(UsageTrendPoint),
  logs: z.array(UsageLog),
  projectStats: z.array(UsageProjectStat),
  sessionStats: z.array(UsageSessionStat),
  providerStats: z.array(UsageBucketStat.omit({ model: true })),
  modelStats: z.array(UsageBucketStat.extend({ model: z.string() })),
  filters: z.object({
    range: UsageRange,
    provider: z.string().nullable(),
    model: z.string().nullable(),
    project: z.string().nullable(),
    session: z.string().nullable(),
    status: UsageStatus.nullable(),
    agent_kind: UsageAgentKind.nullable(),
    search: z.string().nullable(),
    limit: z.number(),
    cursor: z.number().nullable(),
  }),
  nextCursor: z.number().nullable(),
})

export type UsageResponse = z.infer<typeof UsageResponse>
export type UsageLog = z.infer<typeof UsageLog>

const DAY = 86_400_000

function startOfDay(now: number) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function rangeStart(range: z.infer<typeof UsageRange>, now: number) {
  if (range === "today") return startOfDay(now)
  if (range === "7d") return now - 7 * DAY
  if (range === "30d") return now - 30 * DAY
  return
}

function jsonNumber(data: unknown, pathSegments: string[]) {
  let current = data
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object") return 0
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === "number" ? current : 0
}

function jsonString(data: unknown, pathSegments: string[]) {
  let current = data
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object") return ""
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === "string" ? current : ""
}

function bucketTime(time: number, range: z.infer<typeof UsageRange>) {
  if (range === "today") {
    const date = new Date(time)
    date.setMinutes(0, 0, 0)
    return date.getTime()
  }
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function usageStatus(data: unknown): z.infer<typeof UsageStatus> {
  const status = jsonString(data, ["status"])
  if (status === "error" || status === "aborted") return status
  return "completed"
}

function usageAgentKind(input: { agentID: string; sessionParentID: string | null }) {
  if (input.agentID === "main" && input.sessionParentID == null) return "main" as const
  return "subagent" as const
}

function average(total: number, count: number) {
  if (count === 0) return null
  return total / count
}

function projectLabel(projectName: string | null, projectDirectory: string, sessionDirectory: string) {
  if (projectName) return projectName
  const fallback = path.basename(projectDirectory || sessionDirectory).trim()
  if (fallback) return fallback
  return "Unknown project"
}

function groupByKey<T>(
  rows: T[],
  getKey: (row: T) => string,
  getValue: (row: T) => { tokens: number; cost: number },
) {
  const map = new Map<string, { key: string; requestCount: number; totalTokens: number; totalCost: number }>()
  for (const row of rows) {
    const key = getKey(row)
    const current = map.get(key) ?? { key, requestCount: 0, totalTokens: 0, totalCost: 0 }
    const value = getValue(row)
    current.requestCount += 1
    current.totalTokens += value.tokens
    current.totalCost += value.cost
    map.set(key, current)
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens || b.totalCost - a.totalCost)
}

function usageConditions(query: z.infer<typeof UsageQuery>, start: number | undefined, cursor?: number) {
  const conditions: SQL[] = [sql`json_extract(${PartTable.data}, '$.type') = 'step-finish'`]
  if (start != null) conditions.push(gte(PartTable.time_created, start))
  if (cursor != null) conditions.push(lt(PartTable.time_created, cursor))
  if (query.provider) conditions.push(sql`json_extract(${MessageTable.data}, '$.providerID') = ${query.provider}`)
  if (query.model) conditions.push(sql`json_extract(${MessageTable.data}, '$.modelID') = ${query.model}`)
  if (query.project) conditions.push(sql`${SessionTable.project_id} = ${query.project}`)
  if (query.session) conditions.push(sql`${SessionTable.id} = ${query.session}`)
  if (query.status) conditions.push(sql`coalesce(json_extract(${PartTable.data}, '$.status'), 'completed') = ${query.status}`)
  if (query.agent_kind === "main") conditions.push(sql`${MessageTable.agent_id} = 'main' and ${SessionTable.parent_id} is null`)
  if (query.agent_kind === "subagent")
    conditions.push(sql`(${MessageTable.agent_id} <> 'main' or ${SessionTable.parent_id} is not null)`)
  if (query.search) {
    const value = `%${query.search}%`
    const searchCondition = or(
      like(SessionTable.title, value),
      like(SessionTable.directory, value),
      like(ProjectTable.name, value),
      like(ProjectTable.worktree, value),
      sql`${SessionTable.id} like ${value}`,
      sql`json_extract(${MessageTable.data}, '$.providerID') like ${value}`,
      sql`json_extract(${MessageTable.data}, '$.modelID') like ${value}`,
    )
    if (searchCondition) conditions.push(searchCondition)
  }
  return conditions
}

function selectUsageRows(conditions: SQL[], limit?: number) {
  return Database.use((db) => {
    const query = db
      .select({
        id: PartTable.id,
        projectID: SessionTable.project_id,
        projectName: ProjectTable.name,
        projectDirectory: ProjectTable.worktree,
        sessionID: MessageTable.session_id,
        sessionParentID: SessionTable.parent_id,
        time: PartTable.time_created,
        sessionTitle: SessionTable.title,
        directory: SessionTable.directory,
        agentID: MessageTable.agent_id,
        messageData: MessageTable.data,
        partData: PartTable.data,
      })
      .from(PartTable)
      .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
      .innerJoin(SessionTable, eq(SessionTable.id, MessageTable.session_id))
      .innerJoin(ProjectTable, eq(ProjectTable.id, SessionTable.project_id))
      .where(and(...conditions))
      .orderBy(desc(PartTable.time_created), desc(PartTable.id))

    if (limit != null) return query.limit(limit).all()
    return query.all()
  })
}

function toUsageLog(row: {
  id: string
  projectID: string
  projectName: string | null
  projectDirectory: string
  sessionID: string
  sessionParentID: string | null
  time: number
  sessionTitle: string
  directory: string
  agentID: string
  messageData: unknown
  partData: unknown
}) {
  const provider = jsonString(row.messageData, ["providerID"])
  const model = jsonString(row.messageData, ["modelID"])
  const input = jsonNumber(row.partData, ["tokens", "input"])
  const output = jsonNumber(row.partData, ["tokens", "output"])
  const reasoning = jsonNumber(row.partData, ["tokens", "reasoning"])
  const cacheRead = jsonNumber(row.partData, ["tokens", "cache", "read"])
  const cacheWrite = jsonNumber(row.partData, ["tokens", "cache", "write"])
  const cost = jsonNumber(row.partData, ["cost"])
  const overheadTokens =
    jsonNumber(row.partData, ["overhead", "tokens", "input"]) +
    jsonNumber(row.partData, ["overhead", "tokens", "output"]) +
    jsonNumber(row.partData, ["overhead", "tokens", "reasoning"]) +
    jsonNumber(row.partData, ["overhead", "tokens", "cache", "read"]) +
    jsonNumber(row.partData, ["overhead", "tokens", "cache", "write"])
  const overheadCost = jsonNumber(row.partData, ["overhead", "cost"])
  const status = usageStatus(row.partData)
  const duration = (() => {
    const end = jsonNumber(row.partData, ["time", "end"])
    const start = jsonNumber(row.partData, ["time", "start"])
    const explicit = end - start
    if (explicit >= 0 && (end > 0 || start > 0)) return explicit
    return null
  })()
  const ttft = (() => {
    let current: unknown = row.partData
    for (const segment of ["time", "ttft"]) {
      if (!current || typeof current !== "object") return null
      current = (current as Record<string, unknown>)[segment]
    }
    return typeof current === "number" ? current : null
  })()
  const submitToFirstDelta = jsonNumber(row.partData, ["time", "submit_to_first_delta"]) || null
  const preStream = jsonNumber(row.partData, ["time", "pre_stream"]) || null

  return {
    id: row.id,
    projectID: row.projectID,
    projectName: projectLabel(row.projectName, row.projectDirectory, row.directory),
    projectDirectory: row.projectDirectory,
    sessionID: row.sessionID,
    sessionParentID: row.sessionParentID,
    sessionTitle: row.sessionTitle,
    directory: row.directory,
    agentID: row.agentID,
    agentKind: usageAgentKind({ agentID: row.agentID, sessionParentID: row.sessionParentID }),
    time: row.time,
    provider,
    model,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    overheadTokens,
    overheadCost,
    totalTokens: input + output + reasoning + cacheRead + cacheWrite + overheadTokens,
    cost: cost + overheadCost,
    duration,
    ttft,
    submitToFirstDelta,
    preStream,
    status,
    source: "lfcode",
  } satisfies UsageLog
}

function summarize(logs: UsageLog[]) {
  const totals = logs.reduce(
    (acc, row) => {
      acc.totalTokens += row.totalTokens
      acc.inputTokens += row.input
      acc.outputTokens += row.output + row.reasoning
      acc.cacheCreateTokens += row.cacheWrite
      acc.cacheHitTokens += row.cacheRead
      acc.overheadTokens += row.overheadTokens
      acc.requestCount += 1
      acc.totalCost += row.cost
      acc.overheadCost += row.overheadCost
      if (row.status === "completed") acc.successCount += 1
      if (row.status === "error") acc.errorCount += 1
      if (row.status === "aborted") acc.abortedCount += 1
      if (row.duration != null) {
        acc.durationSum += row.duration
        acc.durationCount += 1
      }
      if (row.ttft != null) {
        acc.ttftSum += row.ttft
        acc.ttftCount += 1
      }
      return acc
    },
    {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheHitTokens: 0,
      overheadTokens: 0,
      requestCount: 0,
      totalCost: 0,
      overheadCost: 0,
      successCount: 0,
      errorCount: 0,
      abortedCount: 0,
      durationSum: 0,
      durationCount: 0,
      ttftSum: 0,
      ttftCount: 0,
    },
  )

  return {
    totalTokens:
      totals.inputTokens + totals.outputTokens + totals.cacheCreateTokens + totals.cacheHitTokens + totals.overheadTokens,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreateTokens: totals.cacheCreateTokens,
    cacheHitTokens: totals.cacheHitTokens,
    overheadTokens: totals.overheadTokens,
    cacheHitRatio:
      totals.inputTokens + totals.cacheCreateTokens + totals.cacheHitTokens > 0
        ? (totals.cacheHitTokens / (totals.inputTokens + totals.cacheCreateTokens + totals.cacheHitTokens)) * 100
        : null,
    requestCount: totals.requestCount,
    totalCost: totals.totalCost,
    overheadCost: totals.overheadCost,
    successCount: totals.successCount,
    errorCount: totals.errorCount,
    abortedCount: totals.abortedCount,
    successRate: totals.requestCount > 0 ? (totals.successCount / totals.requestCount) * 100 : null,
    avgDuration: average(totals.durationSum, totals.durationCount),
    avgTtft: average(totals.ttftSum, totals.ttftCount),
  }
}

export function getUsage(input: z.input<typeof UsageQuery>) {
  const query = UsageQuery.parse(input)
  const range = query.range ?? "all"
  const limit = query.limit ?? 100
  const start = rangeStart(range, Date.now())
  const allLogs = selectUsageRows(usageConditions(query, start)).map(toUsageLog)
  const rows = selectUsageRows(usageConditions(query, start, query.cursor), limit + 1)
  const logs = rows.slice(0, limit).map(toUsageLog)
  const summary = summarize(allLogs)

  const trendMap = new Map<number, z.infer<typeof UsageTrendPoint>>()
  for (const row of allLogs) {
    const time = bucketTime(row.time, range)
    const current = trendMap.get(time) ?? {
      time,
      input: 0,
      output: 0,
      cacheCreate: 0,
      cacheHit: 0,
      cost: 0,
    }
    current.input += row.input
    current.output += row.output + row.reasoning
    current.cacheCreate += row.cacheWrite
    current.cacheHit += row.cacheRead
    current.cost += row.cost
    trendMap.set(time, current)
  }
  const trend = [...trendMap.values()].sort((a, b) => a.time - b.time)

  const projectStats = groupByKey(
    allLogs,
    (row) => row.projectID,
    (row) => ({ tokens: row.totalTokens, cost: row.cost }),
  ).map((item) => {
    const match = allLogs.find((row) => row.projectID === item.key)
    return {
      projectID: item.key,
      projectName: match?.projectName ?? "Unknown project",
      directory: match?.projectDirectory ?? "",
      requestCount: item.requestCount,
      totalTokens: item.totalTokens,
      totalCost: item.totalCost,
      share: summary.totalTokens > 0 ? (item.totalTokens / summary.totalTokens) * 100 : 0,
    }
  })

  const sessionStats = groupByKey(
    allLogs,
    (row) => row.sessionID,
    (row) => ({ tokens: row.totalTokens, cost: row.cost }),
  ).map((item) => {
    const match = allLogs.find((row) => row.sessionID === item.key)
    return {
      sessionID: item.key,
      sessionTitle: match?.sessionTitle ?? "",
      projectName: match?.projectName ?? "Unknown project",
      directory: match?.directory ?? "",
      requestCount: item.requestCount,
      totalTokens: item.totalTokens,
      totalCost: item.totalCost,
      share: summary.totalTokens > 0 ? (item.totalTokens / summary.totalTokens) * 100 : 0,
    }
  })

  const providerStats = groupByKey(
    allLogs,
    (row) => row.provider,
    (row) => ({ tokens: row.totalTokens, cost: row.cost }),
  ).map((item) => ({
    provider: item.key,
    requestCount: item.requestCount,
    totalTokens: item.totalTokens,
    totalCost: item.totalCost,
    share: summary.totalTokens > 0 ? (item.totalTokens / summary.totalTokens) * 100 : 0,
  }))

  const modelStats = groupByKey(
    allLogs,
    (row) => `${row.provider}\u0000${row.model}`,
    (row) => ({ tokens: row.totalTokens, cost: row.cost }),
  ).map((item) => {
    const [provider, model] = item.key.split("\u0000")
    return {
      provider: provider ?? "",
      model: model ?? "",
      requestCount: item.requestCount,
      totalTokens: item.totalTokens,
      totalCost: item.totalCost,
      share: summary.totalTokens > 0 ? (item.totalTokens / summary.totalTokens) * 100 : 0,
    }
  })

  return UsageResponse.parse({
    summary,
    trend,
    logs,
    projectStats,
    sessionStats,
    providerStats,
    modelStats,
    filters: {
      range,
      provider: query.provider ?? null,
      model: query.model ?? null,
      project: query.project ?? null,
      session: query.session ?? null,
      status: query.status ?? null,
      agent_kind: query.agent_kind ?? null,
      search: query.search ?? null,
      limit,
      cursor: query.cursor ?? null,
    },
    nextCursor: rows.length > limit ? rows[limit]?.time ?? null : null,
  })
}

export const SessionUsage = {
  Query: UsageQuery,
  Response: UsageResponse,
  get: getUsage,
}
