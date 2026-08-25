import path from "path"
import z from "zod"
import { ProjectTable } from "@/project/project.sql"
import { Database, and, desc, eq, gte, like, lt, or, sql, type SQL } from "@/storage"
import { userVisibleActorClause } from "@/actor/visibility"
import { MessageTable, PartTable, SessionTable } from "./session.sql"

export const UsageRange = z.enum(["today", "7d", "30d", "all"])
export const UsageHeatmapGranularity = z.enum(["month", "week", "day"])
export const UsageStatus = z.enum(["completed", "error", "aborted"])
export const UsageAgentKind = z.enum(["main", "subagent"])

export const UsageQuery = z.object({
  range: UsageRange.optional(),
  heatmap_granularity: UsageHeatmapGranularity.optional(),
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

const UsageHeatmapPoint = z.object({
  time: z.number(),
  totalTokens: z.number(),
})

const UsageHeatmapSummary = z.object({
  totalTokens: z.number(),
  peakDailyTokens: z.number(),
  activeDays: z.number(),
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
  heatmap: z.array(UsageHeatmapPoint),
  heatmapSummary: UsageHeatmapSummary,
  logs: z.array(UsageLog),
  projectStats: z.array(UsageProjectStat),
  sessionStats: z.array(UsageSessionStat),
  providerStats: z.array(UsageBucketStat.omit({ model: true })),
  modelStats: z.array(UsageBucketStat.extend({ model: z.string() })),
  filters: z.object({
    range: UsageRange,
    heatmap_granularity: UsageHeatmapGranularity,
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

function heatmapBucketTime(time: number, granularity: z.infer<typeof UsageHeatmapGranularity>) {
  const date = new Date(time)
  if (granularity === "month") {
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  if (granularity === "week") date.setHours(Math.floor(date.getHours() / 3) * 3, 0, 0, 0)
  if (granularity === "day") date.setMinutes(0, 0, 0)
  return date.getTime()
}

function heatmapStart(granularity: z.infer<typeof UsageHeatmapGranularity>, now: number) {
  if (granularity === "month") return startOfDay(now) - (12 * 7 - 1) * DAY
  if (granularity === "week") return startOfDay(now) - (2 * 7 - 1) * DAY
  return startOfDay(now) - 4 * DAY
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
  const conditions: SQL[] = [
    sql`json_extract(${PartTable.data}, '$.type') = 'step-finish'`,
    userVisibleActorClause(MessageTable.agent_id),
  ]
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

type UsageFactRow = {
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
  provider: string
  model: string
  status: string
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  overheadTokens: number
  overheadCost: number
  totalCost: number
  duration: number | null
  ttft: number | null
  submitToFirstDelta: number | null
  preStream: number | null
}

function toFactLog(row: UsageFactRow) {
  const totalTokens = row.input + row.output + row.reasoning + row.cacheRead + row.cacheWrite + row.overheadTokens
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
    provider: row.provider,
    model: row.model,
    input: row.input,
    output: row.output,
    reasoning: row.reasoning,
    cacheRead: row.cacheRead,
    cacheWrite: row.cacheWrite,
    overheadTokens: row.overheadTokens,
    overheadCost: row.overheadCost,
    totalTokens,
    cost: row.totalCost,
    duration: row.duration,
    ttft: row.ttft,
    submitToFirstDelta: row.submitToFirstDelta,
    preStream: row.preStream,
    status: row.status === "error" || row.status === "aborted" ? row.status : "completed",
    source: "lfcode",
  } satisfies UsageLog
}

function factRows(query: z.infer<typeof UsageQuery>, start: number | undefined, cursor?: number, limit?: number) {
  const where = ["m.agent_id <> 'context-reviewer'", "m.agent_id NOT LIKE 'context-reviewer-%'"]
  const params: (string | number)[] = []
  const add = (condition: string, value?: string | number) => {
    where.push(condition)
    if (value !== undefined) params.push(value)
  }
  if (start != null) add("f.time_created >= ?", start)
  if (cursor != null) add("f.time_created < ?", cursor)
  if (query.provider) add("f.provider_id = ?", query.provider)
  if (query.model) add("f.model_id = ?", query.model)
  if (query.project) add("s.project_id = ?", query.project)
  if (query.session) add("s.id = ?", query.session)
  if (query.status) add("f.status = ?", query.status)
  if (query.agent_kind === "main") where.push("m.agent_id = 'main' AND s.parent_id IS NULL")
  if (query.agent_kind === "subagent") where.push("(m.agent_id <> 'main' OR s.parent_id IS NOT NULL)")
  if (query.search) {
    const value = `%${query.search}%`
    where.push("(s.title LIKE ? OR s.directory LIKE ? OR p.name LIKE ? OR p.worktree LIKE ? OR s.id LIKE ? OR f.provider_id LIKE ? OR f.model_id LIKE ?)")
    params.push(value, value, value, value, value, value, value)
  }
  return Database.rawAll<UsageFactRow>(
    `SELECT f.part_id AS id, s.project_id AS projectID, p.name AS projectName, p.worktree AS projectDirectory,
      f.session_id AS sessionID, s.parent_id AS sessionParentID, f.time_created AS time, s.title AS sessionTitle,
      s.directory, m.agent_id AS agentID, f.provider_id AS provider, f.model_id AS model, f.status,
      f.input_tokens AS input, f.output_tokens AS output, f.reasoning_tokens AS reasoning,
      f.cache_read_tokens AS cacheRead, f.cache_write_tokens AS cacheWrite, f.overhead_tokens AS overheadTokens,
      f.overhead_cost AS overheadCost, f.cost + f.overhead_cost AS totalCost, f.duration, f.ttft,
      f.submit_to_first_delta AS submitToFirstDelta, f.pre_stream AS preStream
      FROM usage_fact f JOIN message m ON m.id = f.message_id JOIN session s ON s.id = f.session_id
      JOIN project p ON p.id = s.project_id WHERE ${where.join(" AND ")}
      ORDER BY f.time_created DESC, f.part_id DESC${limit == null ? "" : ` LIMIT ${Math.max(1, Math.floor(limit))}`}`,
    ...params,
  )
}

let backfillPromise: Promise<void> | undefined

function hasUsageFactSchema() {
  try {
    return Database.rawAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usage_fact_backfill'").length > 0
  } catch {
    return false
  }
}

function writeUsageFact(
  db: Database.TxOrDb,
  row: { id: string; messageID: string; sessionID: string; projectID: string },
  log: UsageLog,
) {
  db.run(sql`INSERT INTO usage_fact (part_id,message_id,session_id,project_id,time_created,agent_id,provider_id,model_id,status,input_tokens,output_tokens,reasoning_tokens,cache_read_tokens,cache_write_tokens,overhead_tokens,cost,overhead_cost,duration,ttft,submit_to_first_delta,pre_stream)
    VALUES (${row.id},${row.messageID},${row.sessionID},${row.projectID},${log.time},${log.agentID},${log.provider},${log.model},${log.status},${log.input},${log.output},${log.reasoning},${log.cacheRead},${log.cacheWrite},${log.overheadTokens},${log.cost - log.overheadCost},${log.overheadCost},${log.duration},${log.ttft},${log.submitToFirstDelta},${log.preStream})
    ON CONFLICT(part_id) DO UPDATE SET message_id=excluded.message_id,session_id=excluded.session_id,project_id=excluded.project_id,time_created=excluded.time_created,agent_id=excluded.agent_id,provider_id=excluded.provider_id,model_id=excluded.model_id,status=excluded.status,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,reasoning_tokens=excluded.reasoning_tokens,cache_read_tokens=excluded.cache_read_tokens,cache_write_tokens=excluded.cache_write_tokens,overhead_tokens=excluded.overhead_tokens,cost=excluded.cost,overhead_cost=excluded.overhead_cost,duration=excluded.duration,ttft=excluded.ttft,submit_to_first_delta=excluded.submit_to_first_delta,pre_stream=excluded.pre_stream`)
}

function startUsageBackfill() {
  if (!hasUsageFactSchema()) return
  if (backfillPromise) return
  backfillPromise = Promise.resolve().then(async () => {
    while (true) {
      const state = Database.rawAll<{ completed: number; cursor_time: number | null; cursor_part_id: string | null }>(
        "SELECT completed, cursor_time, cursor_part_id FROM usage_fact_backfill WHERE id = 1",
      )[0]
      if (!state || state.completed) return
      const rows = Database.rawAll<{
        id: string
        messageID: string
        sessionID: string
        projectID: string
        time: number
        agentID: string
        messageData: string
        partData: string
      }>(
        `SELECT p.id, p.message_id AS messageID, p.session_id AS sessionID, s.project_id AS projectID,
          p.time_created AS time, m.agent_id AS agentID, m.data AS messageData, p.data AS partData
          FROM part p JOIN message m ON m.id = p.message_id JOIN session s ON s.id = p.session_id
          WHERE json_extract(p.data, '$.type') = 'step-finish'
            AND (p.time_created > ? OR (p.time_created = ? AND p.id > ?))
          ORDER BY p.time_created ASC, p.id ASC LIMIT 500`,
        state.cursor_time ?? 0,
        state.cursor_time ?? 0,
        state.cursor_part_id ?? "",
      )
      if (rows.length === 0) {
        Database.Client().$client.prepare("UPDATE usage_fact_backfill SET completed = 1, updated_at = ? WHERE id = 1").run(Date.now())
        return
      }
      Database.transaction((db) => {
        for (const row of rows) {
          const log = toUsageLog({
            id: row.id,
            projectID: row.projectID,
            projectName: null,
            projectDirectory: "",
            sessionID: row.sessionID,
            sessionParentID: null,
            time: row.time,
            sessionTitle: "",
            directory: "",
            agentID: row.agentID,
            messageData: JSON.parse(row.messageData),
            partData: JSON.parse(row.partData),
          })
          writeUsageFact(db, row, log)
        }
        const last = rows.at(-1)!
        db.run(sql`UPDATE usage_fact_backfill SET cursor_time = ${last.time}, cursor_part_id = ${last.id}, updated_at = ${Date.now()} WHERE id = 1`)
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }).finally(() => {
    backfillPromise = undefined
  })
}

export function getUsage(input: z.input<typeof UsageQuery>) {
  const query = UsageQuery.parse(input)
  const range = query.range ?? "all"
  const heatmapGranularity = query.heatmap_granularity ?? "month"
  const limit = query.limit ?? 100
  const start = rangeStart(range, Date.now())
  const factSchema = hasUsageFactSchema()
  if (factSchema) startUsageBackfill()
  const completed = factSchema && Database.rawAll<{ completed: number }>("SELECT completed FROM usage_fact_backfill WHERE id = 1")[0]?.completed === 1
  const allLogs: UsageLog[] = completed
    ? factRows(query, start).map((row) => toFactLog(row))
    : selectUsageRows(usageConditions(query, start)).map((row) => toUsageLog(row))
  const factPage = completed ? factRows(query, start, query.cursor, limit + 1) : undefined
  const legacyPage = completed ? undefined : selectUsageRows(usageConditions(query, start, query.cursor), limit + 1)
  const logs: UsageLog[] = completed
    ? factPage!.slice(0, limit).map((row) => toFactLog(row))
    : legacyPage!.slice(0, limit).map((row) => toUsageLog(row))
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

  const heatmapMap = new Map<number, z.infer<typeof UsageHeatmapPoint>>()
  const heatmapSince = heatmapStart(heatmapGranularity, Date.now())
  for (const row of allLogs) {
    if (row.time < heatmapSince) continue
    const time = heatmapBucketTime(row.time, heatmapGranularity)
    const current = heatmapMap.get(time) ?? { time, totalTokens: 0 }
    current.totalTokens += row.totalTokens
    heatmapMap.set(time, current)
  }
  const heatmap = [...heatmapMap.values()].sort((a, b) => a.time - b.time)
  const dailyUsage = new Map<number, number>()
  for (const row of allLogs) {
    const day = startOfDay(row.time)
    dailyUsage.set(day, (dailyUsage.get(day) ?? 0) + row.totalTokens)
  }

  const projectMeta = new Map(allLogs.map((row) => [row.projectID, row] as const))
  const sessionMeta = new Map(allLogs.map((row) => [row.sessionID, row] as const))

  const projectStats = groupByKey(
    allLogs,
    (row) => row.projectID,
    (row) => ({ tokens: row.totalTokens, cost: row.cost }),
  ).map((item) => {
    const match = projectMeta.get(item.key)
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
    const match = sessionMeta.get(item.key)
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
    heatmap,
    heatmapSummary: {
      totalTokens: summary.totalTokens,
      peakDailyTokens: Math.max(0, ...dailyUsage.values()),
      activeDays: dailyUsage.size,
    },
    logs,
    projectStats,
    sessionStats,
    providerStats,
    modelStats,
    filters: {
      range,
      heatmap_granularity: heatmapGranularity,
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
    nextCursor: (completed ? factPage?.length : legacyPage?.length)! > limit
      ? (completed ? factPage?.[limit]?.time : legacyPage?.[limit]?.time) ?? null
      : null,
  })
}

export const SessionUsage = {
  Query: UsageQuery,
  Response: UsageResponse,
  get: getUsage,
}
