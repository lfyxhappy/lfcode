import { createInfiniteQuery, createQuery } from "@tanstack/solid-query"
import { Icon } from "@lfcode-ai/ui/icon"
import { Select } from "@lfcode-ai/ui/select"
import { TextField } from "@lfcode-ai/ui/text-field"
import { type Component, For, Show, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { SettingsList } from "./settings-list"
import {
  buildUsageFilters,
  buildUsageOptions,
  hasMoreUsageLogs,
  selectedUsageOption,
  USAGE_ALL,
  type UsageAgentKind,
  type UsageData,
  type UsageLog,
  type UsageRange,
  type UsageStatus,
} from "./settings-usage-helpers"

const PAGE_SIZE = 50

const ranges: Array<{ value: UsageRange; label: string }> = [
  { value: "today", label: "settings.usage.range.today" },
  { value: "7d", label: "settings.usage.range.7d" },
  { value: "30d", label: "settings.usage.range.30d" },
  { value: "all", label: "settings.usage.range.all" },
]

const statuses: UsageStatus[] = ["completed", "error", "aborted"]
const agentKinds: UsageAgentKind[] = ["main", "subagent"]

function compactNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function decimal(value: number, locale: string, digits = 2) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

function currency(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value)
}

function percent(value: number | null, locale: string) {
  if (value == null) return "N/A"
  return `${decimal(value, locale)}%`
}

function dateTime(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
}

function nullableMetric(value: number | null, locale: string) {
  if (value == null) return "N/A"
  return `${decimal(value, locale)} ms`
}

function statusTone(status: UsageLog["status"]) {
  if (status === "completed") return "bg-emerald-500/10 text-emerald-600"
  if (status === "error") return "bg-rose-500/10 text-rose-600"
  return "bg-amber-500/10 text-amber-600"
}

const MetricCard: Component<{ title: string; value: string; hint?: string }> = (props) => (
  <div class="rounded-lg border border-border-weak-base bg-background-base/50 px-4 py-4">
    <div class="text-12-regular text-text-weak">{props.title}</div>
    <div class="pt-2 text-20-medium text-text-strong">{props.value}</div>
    <Show when={props.hint}>
      {(hint) => <div class="pt-1 text-12-regular text-text-weak">{hint()}</div>}
    </Show>
  </div>
)

const SectionTitle: Component<{ title: string; trailing?: string }> = (props) => (
  <div class="flex items-center justify-between gap-4 pb-2">
    <h3 class="text-14-medium text-text-strong">{props.title}</h3>
    <Show when={props.trailing}>
      {(trailing) => <span class="text-12-regular text-text-weak">{trailing()}</span>}
    </Show>
  </div>
)

const EmptyState: Component<{ title: string; description: string }> = (props) => (
  <div class="rounded-lg border border-dashed border-border-weak-base px-4 py-10 text-center">
    <div class="text-14-medium text-text-strong">{props.title}</div>
    <div class="pt-1 text-14-regular text-text-weak">{props.description}</div>
  </div>
)

const TrendChart: Component<{
  points: UsageData["trend"]
  locale: string
  labels: Record<"input" | "output" | "cacheCreate" | "cacheHit" | "cost", string>
}> = (props) => {
  const width = 960
  const height = 280
  const padding = { top: 12, right: 12, bottom: 28, left: 12 }

  const series = createMemo(() => {
    const keys = [
      { key: "input", color: "#2563eb", label: props.labels.input },
      { key: "output", color: "#16a34a", label: props.labels.output },
      { key: "cacheCreate", color: "#ea580c", label: props.labels.cacheCreate },
      { key: "cacheHit", color: "#7c3aed", label: props.labels.cacheHit },
      { key: "cost", color: "#e11d48", label: props.labels.cost },
    ] as const
    const max = Math.max(1, ...props.points.flatMap((point) => keys.map((item) => Number(point[item.key]))))
    return keys.map((item) => ({
      ...item,
      path: props.points
        .map((point, index) => {
          const x = padding.left + ((width - padding.left - padding.right) * index) / Math.max(1, props.points.length - 1)
          const y = height - padding.bottom - ((height - padding.top - padding.bottom) * Number(point[item.key])) / max
          return `${index === 0 ? "M" : "L"}${x},${y}`
        })
        .join(" "),
    }))
  })

  return (
    <div class="rounded-lg border border-border-weak-base bg-background-base/50 px-4 py-4">
      <svg viewBox={`0 0 ${width} ${height}`} class="h-[280px] w-full">
        <line x1="12" y1={height - 28} x2={width - 12} y2={height - 28} stroke="var(--border-weak-base)" />
        <For each={series()}>{(item) => <path d={item.path} fill="none" stroke={item.color} stroke-width="3" stroke-linecap="round" />}</For>
      </svg>
      <div class="flex flex-wrap gap-x-4 gap-y-2 pt-2 text-12-regular text-text-weak">
        <For each={series()}>
          {(item) => (
            <span class="inline-flex items-center gap-2">
              <span class="size-2 rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
          )}
        </For>
      </div>
      <div class="pt-2 text-12-regular text-text-weak">
        <Show when={props.points.length > 0}>
          {dateTime(props.points[0]!.time, props.locale)} - {dateTime(props.points[props.points.length - 1]!.time, props.locale)}
        </Show>
      </div>
    </div>
  )
}

const StatRow: Component<{ title: string; subtitle?: string; amount: string; meta: string }> = (props) => (
  <div class="flex items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-none">
    <div class="min-w-0">
      <div class="truncate text-14-medium text-text-strong">{props.title}</div>
      <Show when={props.subtitle}>
        {(subtitle) => <div class="truncate pt-1 text-12-regular text-text-weak">{subtitle()}</div>}
      </Show>
    </div>
    <div class="text-right">
      <div class="text-14-medium text-text-strong">{props.amount}</div>
      <div class="pt-1 text-12-regular text-text-weak">{props.meta}</div>
    </div>
  </div>
)

export const SettingsUsage: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [range, setRange] = createSignal<UsageRange>("all")
  const [provider, setProvider] = createSignal(USAGE_ALL)
  const [model, setModel] = createSignal(USAGE_ALL)
  const [project, setProject] = createSignal(USAGE_ALL)
  const [session, setSession] = createSignal(USAGE_ALL)
  const [status, setStatus] = createSignal(USAGE_ALL)
  const [agentKind, setAgentKind] = createSignal(USAGE_ALL)
  const [search, setSearch] = createSignal("")

  const filters = createMemo(() =>
    buildUsageFilters({
      range: range(),
      provider: provider(),
      model: model(),
      project: project(),
      session: session(),
      status: status(),
      agentKind: agentKind(),
      search: search(),
    }),
  )

  const usageQuery = createQuery(() => ({
    queryKey: [
      "settings-usage",
      "summary",
      globalSDK.url,
      range(),
      provider(),
      model(),
      project(),
      session(),
      status(),
      agentKind(),
      search(),
    ],
    queryFn: () =>
      globalSDK.client.usage.get({
        ...filters(),
        limit: 1,
      }),
  }))

  const logsQuery = createInfiniteQuery(() => ({
    queryKey: [
      "settings-usage",
      "logs",
      globalSDK.url,
      range(),
      provider(),
      model(),
      project(),
      session(),
      status(),
      agentKind(),
      search(),
    ],
    queryFn: ({ pageParam }) =>
      globalSDK.client.usage.get({
        ...filters(),
        limit: PAGE_SIZE,
        cursor: typeof pageParam === "number" ? pageParam : undefined,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.data?.nextCursor ?? undefined,
  }))

  const data = createMemo(() => usageQuery.data?.data)
  const locale = createMemo(() => language.intl())
  const unknown = createMemo(() => language.t("common.unknown"))
  const logs = createMemo(() => logsQuery.data?.pages.flatMap((page) => page.data?.logs ?? []) ?? [])
  const chartLabels = createMemo(() => ({
    input: language.t("settings.usage.chart.input"),
    output: language.t("settings.usage.chart.output"),
    cacheCreate: language.t("settings.usage.chart.cacheCreate"),
    cacheHit: language.t("settings.usage.chart.cacheHit"),
    cost: language.t("settings.usage.chart.cost"),
  }))
  const rangeOptions = createMemo(() => ranges.map((item) => ({ value: item.value, label: language.t(item.label as never) })))
  const providerOptions = createMemo(() =>
    buildUsageOptions(language.t("settings.usage.filter.allProviders"), data()?.providerStats ?? [], (item) => ({
      value: item.provider,
      label: item.provider,
    })),
  )
  const modelOptions = createMemo(() =>
    buildUsageOptions(language.t("settings.usage.filter.allModels"), data()?.modelStats ?? [], (item) => ({
      value: item.model,
      label: item.model,
    })),
  )
  const projectOptions = createMemo(() =>
    buildUsageOptions(language.t("settings.usage.filter.allProjects"), data()?.projectStats ?? [], (item) => ({
      value: item.projectID,
      label: item.projectName,
    })),
  )
  const sessionOptions = createMemo(() =>
    buildUsageOptions(language.t("settings.usage.filter.allSessions"), data()?.sessionStats ?? [], (item) => ({
      value: item.sessionID,
      label: item.sessionTitle || item.directory,
    })),
  )
  const statusOptions = createMemo(() =>
    buildUsageOptions(language.t("settings.usage.filter.allStatuses"), statuses, (item) => ({
      value: item,
      label: language.t(`settings.usage.status.${item}` as never),
    })),
  )
  const agentKindOptions = createMemo(() =>
    buildUsageOptions(language.t("settings.usage.filter.allAgentKinds"), agentKinds, (item) => ({
      value: item,
      label: language.t(`settings.usage.agent.${item}` as never),
    })),
  )
  const selectedRange = createMemo(() => selectedUsageOption(rangeOptions(), range()))
  const selectedProvider = createMemo(() => selectedUsageOption(providerOptions(), provider()))
  const selectedModel = createMemo(() => selectedUsageOption(modelOptions(), model()))
  const selectedProject = createMemo(() => selectedUsageOption(projectOptions(), project()))
  const selectedSession = createMemo(() => selectedUsageOption(sessionOptions(), session()))
  const selectedStatus = createMemo(() => selectedUsageOption(statusOptions(), status()))
  const selectedAgentKind = createMemo(() => selectedUsageOption(agentKindOptions(), agentKind()))
  const hasUsage = createMemo(() => (data()?.summary.requestCount ?? 0) > 0)
  const hasMoreLogs = createMemo(() => {
    const pages = logsQuery.data?.pages
    const lastPage = pages?.[pages.length - 1]
    return hasMoreUsageLogs(lastPage?.data?.nextCursor)
  })

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex max-w-[1180px] flex-col gap-4 pb-6 pt-6">
          <div>
            <h2 class="text-16-medium text-text-strong">{language.t("settings.usage.title")}</h2>
            <p class="pt-1 text-14-regular text-text-weak">{language.t("settings.usage.description")}</p>
          </div>
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <Select
              options={rangeOptions()}
              current={selectedRange()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setRange(item?.value as UsageRange)}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
            <Select
              options={providerOptions()}
              current={selectedProvider()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setProvider(item?.value ?? USAGE_ALL)}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
            <Select
              options={modelOptions()}
              current={selectedModel()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setModel(item?.value ?? USAGE_ALL)}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
            <Select
              options={projectOptions()}
              current={selectedProject()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setProject(item?.value ?? USAGE_ALL)}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
          </div>
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <Select
              options={sessionOptions()}
              current={selectedSession()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setSession(item?.value ?? USAGE_ALL)}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
            <Select
              options={statusOptions()}
              current={selectedStatus()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setStatus(item?.value ?? USAGE_ALL)}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
            <Select
              options={agentKindOptions()}
              current={selectedAgentKind()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setAgentKind(item?.value ?? USAGE_ALL)}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
            <div class="flex h-9 items-center gap-2 rounded-lg bg-surface-base px-3">
              <Icon name="magnifying-glass" class="flex-shrink-0 text-icon-weak-base" />
              <TextField
                variant="ghost"
                type="text"
                value={search()}
                onChange={setSearch}
                placeholder={language.t("settings.usage.filter.search")}
                class="flex-1"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="flex max-w-[1180px] flex-col gap-8">
        <Show
          when={!usageQuery.isLoading && !logsQuery.isLoading}
          fallback={<EmptyState title={language.t("common.loading")} description={language.t("common.loading.ellipsis")} />}
        >
          <Show
            when={hasUsage()}
            fallback={<EmptyState title={language.t("settings.usage.empty.title")} description={language.t("settings.usage.empty.description")} />}
          >
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard title={language.t("settings.usage.metric.totalTokens")} value={compactNumber(data()!.summary.totalTokens, locale())} />
              <MetricCard title={language.t("settings.usage.metric.totalCost")} value={currency(data()!.summary.totalCost, locale())} />
              <MetricCard
                title={language.t("settings.usage.metric.requests")}
                value={decimal(data()!.summary.requestCount, locale(), 0)}
                hint={`${language.t("settings.usage.metric.successRate")}: ${percent(data()!.summary.successRate, locale())}`}
              />
              <MetricCard title={language.t("settings.usage.metric.avgDuration")} value={nullableMetric(data()!.summary.avgDuration, locale())} />
              <MetricCard title={language.t("settings.usage.metric.avgTtft")} value={nullableMetric(data()!.summary.avgTtft, locale())} />
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard title={language.t("settings.usage.metric.input")} value={compactNumber(data()!.summary.inputTokens, locale())} />
              <MetricCard title={language.t("settings.usage.metric.output")} value={compactNumber(data()!.summary.outputTokens, locale())} />
              <MetricCard title={language.t("settings.usage.metric.cacheCreate")} value={compactNumber(data()!.summary.cacheCreateTokens, locale())} />
              <MetricCard title={language.t("settings.usage.metric.cacheHit")} value={compactNumber(data()!.summary.cacheHitTokens, locale())} />
              <MetricCard title={language.t("settings.usage.metric.cacheHitRatio")} value={percent(data()!.summary.cacheHitRatio, locale())} />
            </div>

            <div class="flex flex-col gap-2">
              <SectionTitle title={language.t("settings.usage.section.trend")} />
              <TrendChart points={data()!.trend} locale={locale()} labels={chartLabels()} />
            </div>

            <div class="grid grid-cols-1 gap-8 xl:grid-cols-2">
              <div class="flex flex-col gap-2">
                <SectionTitle title={language.t("settings.usage.section.projects")} />
                <SettingsList>
                  <For each={data()!.projectStats}>
                    {(item) => (
                      <StatRow
                        title={item.projectName}
                        subtitle={item.directory}
                        amount={currency(item.totalCost, locale())}
                        meta={`${compactNumber(item.totalTokens, locale())} · ${language.t("settings.usage.label.requests")}: ${decimal(item.requestCount, locale(), 0)} · ${decimal(item.share, locale())}%`}
                      />
                    )}
                  </For>
                </SettingsList>
              </div>

              <div class="flex flex-col gap-2">
                <SectionTitle title={language.t("settings.usage.section.sessions")} />
                <SettingsList>
                  <For each={data()!.sessionStats}>
                    {(item) => (
                      <StatRow
                        title={item.sessionTitle || unknown()}
                        subtitle={`${item.projectName} · ${item.directory}`}
                        amount={currency(item.totalCost, locale())}
                        meta={`${compactNumber(item.totalTokens, locale())} · ${language.t("settings.usage.label.requests")}: ${decimal(item.requestCount, locale(), 0)} · ${decimal(item.share, locale())}%`}
                      />
                    )}
                  </For>
                </SettingsList>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-8 xl:grid-cols-2">
              <div class="flex flex-col gap-2">
                <SectionTitle title={language.t("settings.usage.section.providers")} />
                <SettingsList>
                  <For each={data()!.providerStats}>
                    {(item) => (
                      <StatRow
                        title={item.provider || unknown()}
                        amount={currency(item.totalCost, locale())}
                        meta={`${compactNumber(item.totalTokens, locale())} · ${language.t("settings.usage.label.requests")}: ${decimal(item.requestCount, locale(), 0)} · ${decimal(item.share, locale())}%`}
                      />
                    )}
                  </For>
                </SettingsList>
              </div>

              <div class="flex flex-col gap-2">
                <SectionTitle title={language.t("settings.usage.section.models")} />
                <SettingsList>
                  <For each={data()!.modelStats}>
                    {(item) => (
                      <StatRow
                        title={item.model || unknown()}
                        subtitle={item.provider || unknown()}
                        amount={currency(item.totalCost, locale())}
                        meta={`${compactNumber(item.totalTokens, locale())} · ${language.t("settings.usage.label.requests")}: ${decimal(item.requestCount, locale(), 0)} · ${decimal(item.share, locale())}%`}
                      />
                    )}
                  </For>
                </SettingsList>
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <SectionTitle
                title={language.t("settings.usage.section.logs")}
                trailing={`${decimal(logs().length, locale(), 0)} / ${decimal(data()!.summary.requestCount, locale(), 0)}`}
              />
              <div class="overflow-x-auto rounded-lg border border-border-weak-base bg-surface-base">
                <table class="min-w-full text-left">
                  <thead class="border-b border-border-weak-base text-12-medium text-text-weak">
                    <tr>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.time")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.project")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.session")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.provider")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.agentKind")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.input")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.output")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.reasoning")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.cacheRead")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.cacheWrite")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.cost")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.latency")}</th>
                      <th class="px-3 py-2.5">{language.t("settings.usage.table.status")}</th>
                    </tr>
                  </thead>
                  <tbody class="text-13-regular text-text-strong">
                    <For each={logs()}>
                      {(item) => (
                        <tr class="border-b border-border-weak-base align-top last:border-none">
                          <td class="whitespace-nowrap px-3 py-2.5">{dateTime(item.time, locale())}</td>
                          <td class="px-3 py-2.5">
                            <div class="max-w-[180px] truncate">{item.projectName || unknown()}</div>
                            <div class="max-w-[180px] truncate pt-1 text-12-regular text-text-weak">{item.projectDirectory || unknown()}</div>
                          </td>
                          <td class="px-3 py-2.5">
                            <div class="max-w-[180px] truncate">{item.sessionTitle || unknown()}</div>
                            <div class="max-w-[180px] truncate pt-1 text-12-regular text-text-weak">{item.directory || unknown()}</div>
                          </td>
                          <td class="px-3 py-2.5">
                            <div class="whitespace-nowrap">{item.provider || unknown()}</div>
                            <div class="whitespace-nowrap pt-1 text-12-regular text-text-weak">{item.model || unknown()}</div>
                          </td>
                          <td class="px-3 py-2.5">
                            <div class="whitespace-nowrap">{language.t(`settings.usage.agent.${item.agentKind}` as never)}</div>
                            <Show when={item.agentKind === "subagent"}>
                              <div class="whitespace-nowrap pt-1 text-12-regular text-text-weak">{item.agentID}</div>
                            </Show>
                          </td>
                          <td class="whitespace-nowrap px-3 py-2.5">{compactNumber(item.input, locale())}</td>
                          <td class="whitespace-nowrap px-3 py-2.5">{compactNumber(item.output, locale())}</td>
                          <td class="whitespace-nowrap px-3 py-2.5">{compactNumber(item.reasoning, locale())}</td>
                          <td class="whitespace-nowrap px-3 py-2.5">{compactNumber(item.cacheRead, locale())}</td>
                          <td class="whitespace-nowrap px-3 py-2.5">{compactNumber(item.cacheWrite, locale())}</td>
                          <td class="whitespace-nowrap px-3 py-2.5">{currency(item.cost, locale())}</td>
                          <td class="px-3 py-2.5">
                            <div class="whitespace-nowrap">{nullableMetric(item.duration, locale())}</div>
                            <div class="whitespace-nowrap pt-1 text-12-regular text-text-weak">{nullableMetric(item.ttft, locale())}</div>
                          </td>
                          <td class="px-3 py-2.5">
                            <span class={`inline-flex rounded-full px-2 py-1 text-12-medium ${statusTone(item.status)}`}>
                              {language.t(`settings.usage.status.${item.status}` as never)}
                            </span>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show when={hasMoreLogs()}>
                <button
                  type="button"
                  class="inline-flex h-9 items-center justify-center rounded-lg border border-border-weak-base px-4 text-12-medium text-text-strong transition-colors hover:bg-surface-base"
                  onClick={() => void logsQuery.fetchNextPage()}
                  disabled={logsQuery.isFetchingNextPage}
                >
                  {logsQuery.isFetchingNextPage ? language.t("common.loading") : language.t("settings.usage.logs.more")}
                </button>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
