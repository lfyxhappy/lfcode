import { createInfiniteQuery, createQuery } from "@tanstack/solid-query"
import { Icon } from "@mimo-ai/ui/icon"
import { Select } from "@mimo-ai/ui/select"
import { TextField } from "@mimo-ai/ui/text-field"
import { type Component, For, Show, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { SettingsList } from "./settings-list"

type UsageRange = "today" | "7d" | "30d" | "all"

type TrendPoint = {
  time: number
  input: number
  output: number
  cacheCreate: number
  cacheHit: number
  cost: number
}

const PAGE_SIZE = 50

const ranges: Array<{ value: UsageRange; label: string }> = [
  { value: "today", label: "settings.usage.range.today" },
  { value: "7d", label: "settings.usage.range.7d" },
  { value: "30d", label: "settings.usage.range.30d" },
  { value: "all", label: "settings.usage.range.all" },
]

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

const TrendChart: Component<{ points: TrendPoint[]; locale: string; labels: Record<string, string> }> = (props) => {
  const width = 960
  const height = 280
  const padding = { top: 12, right: 12, bottom: 28, left: 12 }

  const series = createMemo(() => {
    const keys = [
      { key: "input", color: "#3b82f6", label: props.labels.input },
      { key: "output", color: "#22c55e", label: props.labels.output },
      { key: "cacheCreate", color: "#f97316", label: props.labels.cacheCreate },
      { key: "cacheHit", color: "#a855f7", label: props.labels.cacheHit },
      { key: "cost", color: "#f43f5e", label: props.labels.cost },
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
        <For each={series()}>
          {(item) => <path d={item.path} fill="none" stroke={item.color} stroke-width="3" stroke-linecap="round" />}
        </For>
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

export const SettingsUsage: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [range, setRange] = createSignal<UsageRange>("all")
  const [provider, setProvider] = createSignal("")
  const [model, setModel] = createSignal("")
  const [search, setSearch] = createSignal("")

  const filters = createMemo(() => ({
    range: range(),
    provider: provider() || undefined,
    model: model() || undefined,
    search: search() || undefined,
    source: "opencode" as const,
  }))

  const usageQuery = createQuery(() => ({
    queryKey: ["settings-usage", "summary", globalSDK.url, range(), provider(), model(), search()],
    queryFn: () =>
      globalSDK.client.usage.get({
        ...filters(),
        limit: 1,
      }),
  }))

  const logsQuery = createInfiniteQuery(() => ({
    queryKey: ["settings-usage", "logs", globalSDK.url, range(), provider(), model(), search()],
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
  const logs = createMemo(() => logsQuery.data?.pages.flatMap((page) => page.data?.logs ?? []) ?? [])
  const providers = createMemo(() => data()?.providerStats.map((item) => item.provider) ?? [])
  const models = createMemo(() => data()?.modelStats.map((item) => item.model) ?? [])
  const rangeOptions = createMemo(() => ranges.map((item) => ({ value: item.value, label: language.t(item.label as never) })))
  const providerOptions = createMemo(() => [
    { value: "", label: language.t("settings.usage.filter.allProviders") },
    ...providers().map((item) => ({ value: item, label: item })),
  ])
  const modelOptions = createMemo(() => [
    { value: "", label: language.t("settings.usage.filter.allModels") },
    ...models().map((item) => ({ value: item, label: item })),
  ])
  const selectedRange = createMemo(() => rangeOptions().find((item) => item.value === range()) ?? rangeOptions()[0])
  const selectedProvider = createMemo(() => providerOptions().find((item) => item.value === provider()) ?? providerOptions()[0])
  const selectedModel = createMemo(() => modelOptions().find((item) => item.value === model()) ?? modelOptions()[0])
  const chartLabels = createMemo(() => ({
    input: language.t("settings.usage.chart.input"),
    output: language.t("settings.usage.chart.output"),
    cacheCreate: language.t("settings.usage.chart.cacheCreate"),
    cacheHit: language.t("settings.usage.chart.cacheHit"),
    cost: language.t("settings.usage.chart.cost"),
  }))
  const hasUsage = createMemo(() => (data()?.summary.requestCount ?? 0) > 0)
  const hasMoreLogs = createMemo(() => {
    const pages = logsQuery.data?.pages
    if (!pages?.length) return false
    const lastPage = pages[pages.length - 1]
    return lastPage?.data?.nextCursor != null
  })

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex max-w-[980px] flex-col gap-4 pb-6 pt-6">
          <div>
            <h2 class="text-16-medium text-text-strong">{language.t("settings.usage.title")}</h2>
            <p class="pt-1 text-14-regular text-text-weak">{language.t("settings.usage.description")}</p>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-[160px_180px_220px_1fr]">
            <Select
              options={rangeOptions()}
              current={selectedRange()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setRange(item?.value ?? "all")}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
            <Select
              options={providerOptions()}
              current={selectedProvider()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setProvider(item?.value ?? "")}
              triggerVariant="settings"
              variant="secondary"
              size="small"
            />
            <Select
              options={modelOptions()}
              current={selectedModel()}
              value={(item) => item.value}
              label={(item) => item.label}
              onSelect={(item) => setModel(item?.value ?? "")}
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

      <div class="flex max-w-[980px] flex-col gap-8">
        <Show
          when={!usageQuery.isLoading && !logsQuery.isLoading}
          fallback={<EmptyState title={language.t("common.loading")} description={language.t("common.loading.ellipsis")} />}
        >
          <Show
            when={hasUsage()}
            fallback={<EmptyState title={language.t("settings.usage.empty.title")} description={language.t("settings.usage.empty.description")} />}
          >
            <div class="grid grid-cols-1 gap-3 lg:grid-cols-4">
              <MetricCard
                title={language.t("settings.usage.metric.totalTokens")}
                value={compactNumber(data()!.summary.totalTokens, locale())}
                hint={decimal(data()!.summary.totalTokens, locale(), 0)}
              />
              <MetricCard
                title={language.t("settings.usage.metric.input")}
                value={compactNumber(data()!.summary.inputTokens, locale())}
              />
              <MetricCard
                title={language.t("settings.usage.metric.output")}
                value={compactNumber(data()!.summary.outputTokens, locale())}
              />
              <MetricCard
                title={language.t("settings.usage.metric.totalCost")}
                value={currency(data()!.summary.totalCost, locale())}
                hint={`${language.t("settings.usage.metric.requests")}: ${decimal(data()!.summary.requestCount, locale(), 0)}`}
              />
            </div>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title={language.t("settings.usage.metric.cacheCreate")} value={compactNumber(data()!.summary.cacheCreateTokens, locale())} />
              <MetricCard title={language.t("settings.usage.metric.cacheHit")} value={compactNumber(data()!.summary.cacheHitTokens, locale())} />
              <MetricCard
                title={language.t("settings.usage.metric.cacheHitRatio")}
                value={data()!.summary.cacheHitRatio == null ? "N/A" : `${decimal(data()!.summary.cacheHitRatio ?? 0, locale())}%`}
              />
              <MetricCard title={language.t("settings.usage.metric.requests")} value={decimal(data()!.summary.requestCount, locale(), 0)} />
            </div>

            <div class="flex flex-col gap-2">
              <SectionTitle title={language.t("settings.usage.section.trend")} />
              <TrendChart points={data()!.trend} locale={locale()} labels={chartLabels()} />
            </div>

            <div class="grid grid-cols-1 gap-8 xl:grid-cols-2">
              <div class="flex flex-col gap-2">
                <SectionTitle title={language.t("settings.usage.section.providers")} />
                <SettingsList>
                  <For each={data()!.providerStats}>
                    {(item) => (
                      <div class="flex items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-none">
                        <div>
                          <div class="text-14-medium text-text-strong">{item.provider}</div>
                          <div class="pt-1 text-12-regular text-text-weak">
                            {language.t("settings.usage.label.requests")}: {decimal(item.requestCount, locale(), 0)}
                          </div>
                        </div>
                        <div class="text-right">
                          <div class="text-14-medium text-text-strong">{currency(item.totalCost, locale())}</div>
                          <div class="pt-1 text-12-regular text-text-weak">
                            {compactNumber(item.totalTokens, locale())} · {decimal(item.share, locale())}%
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </SettingsList>
              </div>

              <div class="flex flex-col gap-2">
                <SectionTitle title={language.t("settings.usage.section.models")} />
                <SettingsList>
                  <For each={data()!.modelStats}>
                    {(item) => (
                      <div class="flex items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-none">
                        <div>
                          <div class="text-14-medium text-text-strong">{item.model}</div>
                          <div class="pt-1 text-12-regular text-text-weak">{item.provider}</div>
                        </div>
                        <div class="text-right">
                          <div class="text-14-medium text-text-strong">{currency(item.totalCost, locale())}</div>
                          <div class="pt-1 text-12-regular text-text-weak">
                            {compactNumber(item.totalTokens, locale())} · {decimal(item.share, locale())}%
                          </div>
                        </div>
                      </div>
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
                      <th class="px-4 py-3">{language.t("settings.usage.table.time")}</th>
                      <th class="px-4 py-3">{language.t("settings.usage.table.provider")}</th>
                      <th class="px-4 py-3">{language.t("settings.usage.table.model")}</th>
                      <th class="px-4 py-3">{language.t("settings.usage.table.input")}</th>
                      <th class="px-4 py-3">{language.t("settings.usage.table.output")}</th>
                      <th class="px-4 py-3">{language.t("settings.usage.table.cost")}</th>
                      <th class="px-4 py-3">{language.t("settings.usage.table.latency")}</th>
                      <th class="px-4 py-3">{language.t("settings.usage.table.status")}</th>
                      <th class="px-4 py-3">{language.t("settings.usage.table.source")}</th>
                    </tr>
                  </thead>
                  <tbody class="text-14-regular text-text-strong">
                    <For each={logs()}>
                      {(item) => (
                        <tr class="border-b border-border-weak-base last:border-none">
                          <td class="px-4 py-3">{dateTime(item.time, locale())}</td>
                          <td class="px-4 py-3">{item.provider || "N/A"}</td>
                          <td class="px-4 py-3">
                            <div>{item.model || "N/A"}</div>
                            <div class="max-w-[240px] truncate pt-1 text-12-regular text-text-weak">{item.sessionTitle || item.directory || "N/A"}</div>
                          </td>
                          <td class="px-4 py-3">{compactNumber(item.input, locale())}</td>
                          <td class="px-4 py-3">
                            <div>{compactNumber(item.output + item.reasoning, locale())}</div>
                            <div class="pt-1 text-12-regular text-text-weak">R{compactNumber(item.reasoning, locale())}</div>
                          </td>
                          <td class="px-4 py-3">{currency(item.cost, locale())}</td>
                          <td class="px-4 py-3">
                            <div>{nullableMetric(item.duration, locale())}</div>
                            <div class="pt-1 text-12-regular text-text-weak">{nullableMetric(item.ttft, locale())}</div>
                          </td>
                          <td class="px-4 py-3">{item.status || "N/A"}</td>
                          <td class="px-4 py-3">{item.source || "N/A"}</td>
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
