import type { UsageGetResponse } from "@lfcode-ai/sdk/v2/client"

export type UsageData = UsageGetResponse
export type UsageLog = UsageData["logs"][number]
export type UsageRange = UsageData["filters"]["range"]
export type UsageStatus = NonNullable<UsageData["filters"]["status"]>
export type UsageAgentKind = NonNullable<UsageData["filters"]["agent_kind"]>
export type UsageHeatmapGranularity = NonNullable<UsageData["filters"]["heatmap_granularity"]>
export type UsageOption = { value: string; label: string }
export const USAGE_ALL = "__all__"
export const USAGE_CACHE_TIME = 60 * 1000
export const USAGE_REFRESH_INTERVAL = 60 * 1000

export function usagePollingEnabled(input: { documentVisible: boolean; nativeVisible: boolean }) {
  return input.documentVisible && input.nativeVisible
}

export type UsageHeatmapCell = {
  time: number
  totalTokens: number
}

export type UsageHeatmap =
  | { kind: "month"; columns: Array<{ cells: Array<{ day: number; cell: UsageHeatmapCell | undefined }> }> }
  | { kind: "week"; columns: Array<{ day: number; cells: Array<UsageHeatmapCell | undefined> }> }
  | { kind: "day"; columns: Array<{ day: number; cells: Array<UsageHeatmapCell | undefined> }> }

const DAY = 86_400_000
const MONTH_VIEW_DAYS = 12 * 7
const WEEK_VIEW_DAYS = 2 * 7
const DAY_VIEW_DAYS = 5

function startOfDay(time: number) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function buildUsageHeatmap(points: UsageData["heatmap"], granularity: UsageHeatmapGranularity, now = Date.now()): UsageHeatmap {
  const today = startOfDay(now)
  if (granularity === "day") {
    const firstDay = today - (DAY_VIEW_DAYS - 1) * DAY
    const columns = Array.from({ length: DAY_VIEW_DAYS }, (_, dayIndex) => ({
      day: firstDay + dayIndex * DAY,
      cells: Array<UsageHeatmapCell | undefined>(24),
    }))
    for (const point of points) {
      const dayIndex = Math.floor((startOfDay(point.time) - firstDay) / DAY)
      if (dayIndex < 0 || dayIndex >= DAY_VIEW_DAYS) continue
      const hour = new Date(point.time).getHours()
      const current = columns[dayIndex].cells[hour]
      columns[dayIndex].cells[hour] = current ? { time: current.time, totalTokens: current.totalTokens + point.totalTokens } : point
    }
    return {
      kind: "day",
      columns,
    }
  }

  if (granularity === "week") {
    const firstDay = today - (WEEK_VIEW_DAYS - 1) * DAY
    const columns = Array.from({ length: WEEK_VIEW_DAYS }, (_, dayIndex) => ({
      day: firstDay + dayIndex * DAY,
      cells: Array<UsageHeatmapCell | undefined>(8),
    }))
    for (const point of points) {
      const dayIndex = Math.floor((startOfDay(point.time) - firstDay) / DAY)
      if (dayIndex < 0 || dayIndex >= WEEK_VIEW_DAYS) continue
      const slot = Math.floor(new Date(point.time).getHours() / 3)
      const current = columns[dayIndex].cells[slot]
      columns[dayIndex].cells[slot] = current ? { time: current.time, totalTokens: current.totalTokens + point.totalTokens } : point
    }
    return {
      kind: "week",
      columns,
    }
  }

  const firstDay = today - (MONTH_VIEW_DAYS - 1) * DAY
  const firstWeekday = new Date(firstDay).getDay()
  const columnCount = Math.ceil((firstWeekday + MONTH_VIEW_DAYS) / 7)
  const daily = new Map<number, UsageHeatmapCell>()
  for (const point of points) {
    const day = startOfDay(point.time)
    if (day < firstDay || day > today) continue
    const current = daily.get(day)
    daily.set(day, current ? { time: current.time, totalTokens: current.totalTokens + point.totalTokens } : point)
  }
  return {
    kind: "month",
    columns: Array.from({ length: columnCount }, (_, column) => ({
      cells: Array.from({ length: 7 }, (_, row) => {
        const day = firstDay + (column * 7 + row - firstWeekday) * DAY
        const index = Math.floor((day - firstDay) / DAY)
        return {
          day,
          cell: index < 0 || index >= MONTH_VIEW_DAYS ? undefined : daily.get(day),
        }
      }),
    })),
  }
}

export function usageHeatmapIntensity(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0
  return Math.max(0.16, Math.min(1, Math.sqrt(value / max)))
}

export function formatUsageDuration(value: number | null, locale: string) {
  const totalSeconds = Math.max(0, (value ?? 0) / 1000)
  if (totalSeconds <= 60) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(totalSeconds) + " s"
  }
  const wholeSeconds = Math.round(totalSeconds)
  return `${Math.floor(wholeSeconds / 60)}m ${wholeSeconds % 60}s`
}

export function buildUsageFilters(input: {
  range: UsageRange
  heatmapGranularity: UsageHeatmapGranularity
  provider: string
  model: string
  project: string
  session: string
  status: UsageStatus | typeof USAGE_ALL
  agentKind: UsageAgentKind | typeof USAGE_ALL
  search: string
}) {
  return {
    range: input.range,
    heatmap_granularity: input.heatmapGranularity,
    provider: input.provider && input.provider !== USAGE_ALL ? input.provider : undefined,
    model: input.model && input.model !== USAGE_ALL ? input.model : undefined,
    project: input.project && input.project !== USAGE_ALL ? input.project : undefined,
    session: input.session && input.session !== USAGE_ALL ? input.session : undefined,
    status: input.status !== USAGE_ALL ? input.status : undefined,
    agent_kind: input.agentKind !== USAGE_ALL ? input.agentKind : undefined,
    search: input.search.trim() || undefined,
    source: "lfcode" as const,
  }
}

export function buildUsageOptions<T>(allLabel: string, items: T[], option: (item: T) => UsageOption) {
  const seen = new Set<string>()
  return [
    { value: USAGE_ALL, label: allLabel },
    ...items.flatMap((item) => {
      const next = option(item)
      if (!next.value || seen.has(next.value)) return []
      seen.add(next.value)
      return [next]
    }),
  ]
}

export function selectedUsageOption(options: UsageOption[], value: string) {
  return options.find((item) => item.value === value) ?? options[0]
}

export function hasMoreUsageLogs(nextCursor: number | null | undefined) {
  return nextCursor != null
}
