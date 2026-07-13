import type { UsageGetResponse } from "@lfcode-ai/sdk/v2/client"

export type UsageData = UsageGetResponse
export type UsageLog = UsageData["logs"][number]
export type UsageRange = UsageData["filters"]["range"]
export type UsageStatus = NonNullable<UsageData["filters"]["status"]>
export type UsageAgentKind = NonNullable<UsageData["filters"]["agent_kind"]>
export type UsageOption = { value: string; label: string }
export const USAGE_ALL = "__all__"

export function buildUsageFilters(input: {
  range: UsageRange
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
