import z from "zod"
import { Database, and, desc, eq, gte, like, lt, or, sql, type SQL } from "@/storage"
import { MessageTable, PartTable, SessionTable } from "./session.sql"

export const UsageRange = z.enum(["today", "7d", "30d", "all"])

export const UsageQuery = z.object({
  range: UsageRange.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
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
  sessionID: z.string(),
  sessionTitle: z.string(),
  directory: z.string(),
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
  status: z.string(),
  source: z.string(),
})

const UsageBucketStat = z.object({
  provider: z.string(),
  model: z.string().optional(),
  requestCount: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  share: z.number(),
})

export const UsageResponse = z.object({
  summary: UsageSummary,
  trend: z.array(UsageTrendPoint),
  logs: z.array(UsageLog),
  providerStats: z.array(UsageBucketStat.omit({ model: true })),
  modelStats: z.array(UsageBucketStat.extend({ model: z.string() })),
  filters: z.object({
    range: UsageRange,
    provider: z.string().nullable(),
    model: z.string().nullable(),
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

function jsonNumber(data: unknown, path: string[]) {
  let current = data
  for (const segment of path) {
    if (!current || typeof current !== "object") return 0
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === "number" ? current : 0
}

function jsonString(data: unknown, path: string[]) {
  let current = data
  for (const segment of path) {
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

function groupByKey<T>(rows: T[], getKey: (row: T) => string, getValue: (row: T) => { tokens: number; cost: number }) {
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
  if (query.search) {
    const searchCondition = or(like(SessionTable.title, `%${query.search}%`), like(SessionTable.directory, `%${query.search}%`))
    if (searchCondition) conditions.push(searchCondition)
  }
  return conditions
}

function selectUsageRows(conditions: SQL[], limit?: number) {
  return Database.use((db) => {
    const query = db
      .select({
        id: PartTable.id,
        sessionID: MessageTable.session_id,
        time: PartTable.time_created,
        sessionTitle: SessionTable.title,
        directory: SessionTable.directory,
        messageData: MessageTable.data,
        partData: PartTable.data,
      })
      .from(PartTable)
      .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
      .innerJoin(SessionTable, eq(SessionTable.id, MessageTable.session_id))
      .where(and(...conditions))
      .orderBy(desc(PartTable.time_created), desc(PartTable.id))

    if (limit != null) return query.limit(limit).all()
    return query.all()
  })
}

function toUsageLog(row: {
  id: string
  sessionID: string
  time: number
  sessionTitle: string
  directory: string
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
  return {
    id: row.id,
    sessionID: row.sessionID,
    sessionTitle: row.sessionTitle,
    directory: row.directory,
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
    duration: null,
    ttft: null,
    status: "completed",
    source: "lfcode",
  } satisfies UsageLog
}

function summarize(logs: UsageLog[]) {
  return logs.reduce(
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
    },
  )
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
    summary: {
      ...summary,
      cacheHitRatio:
        summary.inputTokens + summary.cacheCreateTokens + summary.cacheHitTokens > 0
          ? (summary.cacheHitTokens / (summary.inputTokens + summary.cacheCreateTokens + summary.cacheHitTokens)) * 100
          : null,
      totalTokens: summary.inputTokens + summary.outputTokens + summary.cacheCreateTokens + summary.cacheHitTokens + summary.overheadTokens,
    },
    trend,
    logs,
    providerStats,
    modelStats,
    filters: {
      range,
      provider: query.provider ?? null,
      model: query.model ?? null,
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
