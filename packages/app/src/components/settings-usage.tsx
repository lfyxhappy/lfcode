import { createInfiniteQuery, createQuery } from "@tanstack/solid-query"
import { Button } from "@lfcode-ai/ui/button"
import { Collapsible } from "@lfcode-ai/ui/collapsible"
import { Icon } from "@lfcode-ai/ui/icon"
import { Select } from "@lfcode-ai/ui/select"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { TextField } from "@lfcode-ai/ui/text-field"
import { type Component, For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
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

const detailTabs = [
  { value: "logs", label: "settings.usage.section.logs" },
  { value: "providers", label: "settings.usage.section.providers" },
  { value: "models", label: "settings.usage.section.models" },
] as const

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

const EmptyState: Component<{ title: string; description: string }> = (props) => (
  <div class="rounded-[20px] border border-dashed border-border-weak-base px-4 py-10 text-center">
    <div class="text-14-medium text-text-strong">{props.title}</div>
    <div class="pt-1 text-14-regular text-text-weak">{props.description}</div>
  </div>
)

const MiniMetric: Component<{ title: string; value: string; hint?: string }> = (props) => (
  <div class="rounded-[20px] border border-border-weak-base bg-surface-base/70 px-4 py-4">
    <div class="text-12-regular text-text-weak">{props.title}</div>
    <div class="pt-2 text-18-medium text-text-strong">{props.value}</div>
    <Show when={props.hint}>
      {(hint) => <div class="pt-1 text-12-regular text-text-weak">{hint()}</div>}
    </Show>
  </div>
)

const SectionHeader: Component<{ title: string; description?: string; trailing?: string }> = (props) => (
  <div class="flex flex-wrap items-start justify-between gap-3 pb-4">
    <div>
      <div class="text-14-medium text-text-strong">{props.title}</div>
      <Show when={props.description}>
        {(description) => <div class="pt-1 text-12-regular text-text-weak">{description()}</div>}
      </Show>
    </div>
    <Show when={props.trailing}>
      {(trailing) => <div class="text-12-regular text-text-weak">{trailing()}</div>}
    </Show>
  </div>
)

const StatRow: Component<{ title: string; subtitle?: string; amount: string; meta: string; share?: number }> = (props) => (
  <div class="rounded-[18px] border border-border-weak-base bg-surface-base/60 px-4 py-3">
    <div class="flex items-center justify-between gap-4">
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
    <Show when={props.share != null}>
      <div class="pt-3">
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-raised-base">
          <div class="h-full rounded-full bg-[#2563eb]" style={{ width: `${Math.max(0, Math.min(100, props.share ?? 0))}%` }} />
        </div>
      </div>
    </Show>
  </div>
)

const TrendChart: Component<{
  points: UsageData["trend"]
  locale: string
  labels: Record<"input" | "output" | "cacheCreate" | "cacheHit" | "cost", string>
}> = (props) => {
  const width = 960
  const height = 280
  const padding = { top: 18, right: 18, bottom: 34, left: 18 }
  const baseline = height - padding.bottom

  const series = createMemo(() => {
    const keys = [
      { key: "input", color: "#2563eb", fill: "rgba(37,99,235,0.16)", label: props.labels.input },
      { key: "output", color: "#16a34a", fill: "rgba(22,163,74,0.12)", label: props.labels.output },
      { key: "cacheCreate", color: "#ea580c", fill: "rgba(234,88,12,0.1)", label: props.labels.cacheCreate },
      { key: "cacheHit", color: "#7c3aed", fill: "rgba(124,58,237,0.1)", label: props.labels.cacheHit },
      { key: "cost", color: "#e11d48", fill: "rgba(225,29,72,0.1)", label: props.labels.cost },
    ] as const
    const max = Math.max(1, ...props.points.flatMap((point) => keys.map((item) => Number(point[item.key]))))
    return keys.map((item) => {
      const coords = props.points.map((point, index) => {
        const x = padding.left + ((width - padding.left - padding.right) * index) / Math.max(1, props.points.length - 1)
        const y = baseline - ((height - padding.top - padding.bottom) * Number(point[item.key])) / max
        return { x, y }
      })
      const path = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ")
      const area =
        coords.length === 0
          ? ""
          : `${path} L${coords[coords.length - 1]!.x},${baseline} L${coords[0]!.x},${baseline} Z`
      return {
        ...item,
        path,
        area,
      }
    })
  })

  return (
    <div class="rounded-[20px] border border-border-weak-base bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.08),_transparent_45%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)] px-4 py-4">
      <svg viewBox={`0 0 ${width} ${height}`} class="h-[280px] w-full">
        <For each={[0, 1, 2, 3]}>
          {(step) => {
            const y = padding.top + ((height - padding.top - padding.bottom) * step) / 3
            return <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(148,163,184,0.18)" />
          }}
        </For>
        <line x1={padding.left} y1={baseline} x2={width - padding.right} y2={baseline} stroke="rgba(148,163,184,0.28)" />
        <Show when={series()[0]?.area}>
          {(area) => <path d={area()} fill={series()[0]!.fill} />}
        </Show>
        <For each={series()}>
          {(item, index) => (
            <path
              d={item.path}
              fill="none"
              stroke={item.color}
              stroke-width={index() === 0 ? "3.25" : "2.25"}
              stroke-linecap="round"
              stroke-dasharray={index() >= 2 ? "6 6" : undefined}
            />
          )}
        </For>
      </svg>
      <div class="flex flex-wrap gap-x-5 gap-y-2 pt-3 text-12-regular text-text-weak">
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
  const [provider, setProvider] = createSignal(USAGE_ALL)
  const [model, setModel] = createSignal(USAGE_ALL)
  const [project, setProject] = createSignal(USAGE_ALL)
  const [session, setSession] = createSignal(USAGE_ALL)
  const [status, setStatus] = createSignal<UsageStatus | typeof USAGE_ALL>(USAGE_ALL)
  const [agentKind, setAgentKind] = createSignal<UsageAgentKind | typeof USAGE_ALL>(USAGE_ALL)
  const [search, setSearch] = createSignal("")
  const [tab, setTab] = createSignal<(typeof detailTabs)[number]["value"]>("logs")
  const [advancedOpen, setAdvancedOpen] = createSignal(false)

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
  const logs = createMemo(() => logsQuery.data?.pages.flatMap((page) => page.data?.logs ?? []) ?? [])
  const hasUsage = createMemo(() => (data()?.summary.requestCount ?? 0) > 0)
  const errorText = createMemo(() => {
    const error = usageQuery.error ?? logsQuery.error
    if (!error) return
    if (error instanceof Error) return error.message
    return String(error)
  })
  const activeFilterCount = createMemo(
    () =>
      [provider(), model(), project(), session(), status(), agentKind()]
        .filter((value) => value && value !== USAGE_ALL).length + (search().trim() ? 1 : 0),
  )
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
  const hasMoreLogs = createMemo(() => {
    const pages = logsQuery.data?.pages
    const lastPage = pages?.[pages.length - 1]
    return hasMoreUsageLogs(lastPage?.data?.nextCursor)
  })
  const chartLabels = createMemo(() => ({
    input: language.t("settings.usage.chart.input"),
    output: language.t("settings.usage.chart.output"),
    cacheCreate: language.t("settings.usage.chart.cacheCreate"),
    cacheHit: language.t("settings.usage.chart.cacheHit"),
    cost: language.t("settings.usage.chart.cost"),
  }))

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex max-w-[1180px] items-end justify-between gap-4 pb-6 pt-6">
          <div>
            <h2 class="text-16-medium text-text-strong">{language.t("settings.usage.title")}</h2>
            <p class="pt-1 text-14-regular text-text-weak">{language.t("settings.usage.description")}</p>
          </div>
          <div class="w-full max-w-[220px]">
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
          </div>
        </div>
      </div>

      <div class="max-w-[1180px] space-y-6">
        <Show when={errorText()}>
          {(message) => (
            <div class="rounded-[20px] border border-border-weak-base bg-surface-base px-4 py-4 text-14-regular text-status-warning">
              {message()}
            </div>
          )}
        </Show>

        <Show
          when={!usageQuery.isLoading && !logsQuery.isLoading}
          fallback={
            <SettingsList>
              <div class="py-10 text-center text-14-regular text-text-weak">{language.t("common.loading")}</div>
            </SettingsList>
          }
        >
          <Show
            when={hasUsage()}
            fallback={<EmptyState title={language.t("settings.usage.empty.title")} description={language.t("settings.usage.empty.description")} />}
          >
            <div class="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
              <SettingsList class="overflow-hidden border border-border-weak-base bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div class="text-12-medium uppercase tracking-[0.16em] text-text-weak">
                      {language.t("settings.usage.metric.totalTokens")}
                    </div>
                    <div class="pt-3 text-[clamp(2rem,5vw,3.2rem)] font-medium leading-none text-text-strong">
                      {compactNumber(data()!.summary.totalTokens, locale())}
                    </div>
                    <div class="pt-3 text-14-regular text-text-weak">
                      {language.t("settings.usage.metric.totalCost")} · {currency(data()!.summary.totalCost, locale())}
                    </div>
                  </div>
                  <div class="rounded-[18px] border border-white/10 bg-black/10 px-4 py-3 text-right backdrop-blur-sm">
                    <div class="text-12-regular text-text-weak">{language.t("settings.usage.metric.requests")}</div>
                    <div class="pt-1 text-20-medium text-text-strong">{decimal(data()!.summary.requestCount, locale(), 0)}</div>
                    <div class="pt-1 text-12-regular text-text-weak">
                      {language.t("settings.usage.metric.successRate")} · {percent(data()!.summary.successRate, locale())}
                    </div>
                  </div>
                </div>
                <div class="grid gap-3 pt-6 md:grid-cols-3">
                  <MiniMetric
                    title={language.t("settings.usage.metric.input")}
                    value={compactNumber(data()!.summary.inputTokens, locale())}
                    hint={`${language.t("settings.usage.metric.output")} · ${compactNumber(data()!.summary.outputTokens, locale())}`}
                  />
                  <MiniMetric
                    title={language.t("settings.usage.metric.cacheCreate")}
                    value={compactNumber(data()!.summary.cacheCreateTokens, locale())}
                    hint={`${language.t("settings.usage.metric.cacheHit")} · ${compactNumber(data()!.summary.cacheHitTokens, locale())}`}
                  />
                  <MiniMetric
                    title={language.t("settings.usage.metric.cacheHitRatio")}
                    value={percent(data()!.summary.cacheHitRatio, locale())}
                    hint={`${language.t("settings.usage.metric.totalCost")} · ${currency(data()!.summary.overheadCost, locale())}`}
                  />
                </div>
              </SettingsList>

              <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
                <MiniMetric title={language.t("settings.usage.metric.totalCost")} value={currency(data()!.summary.totalCost, locale())} />
                <MiniMetric title={language.t("settings.usage.metric.requests")} value={decimal(data()!.summary.requestCount, locale(), 0)} />
                <MiniMetric title={language.t("settings.usage.metric.avgDuration")} value={nullableMetric(data()!.summary.avgDuration, locale())} />
                <MiniMetric title={language.t("settings.usage.metric.avgTtft")} value={nullableMetric(data()!.summary.avgTtft, locale())} />
              </div>
            </div>

            <SettingsList class="border border-border-weak-base bg-surface-base/70">
              <SectionHeader
                title={language.t("settings.usage.section.trend")}
                trailing={`${language.t("settings.usage.metric.cacheHitRatio")} · ${percent(data()!.summary.cacheHitRatio, locale())}`}
              />
              <TrendChart points={data()!.trend} locale={locale()} labels={chartLabels()} />
            </SettingsList>

            <SettingsList class="border border-border-weak-base bg-surface-base/70">
              <SectionHeader
                title={language.t("settings.usage.section.projects")}
                description={language.t("settings.usage.projects.description")}
                trailing={language.t("settings.usage.projects.trailing", { count: data()!.projectStats.length.toString() })}
              />
              <div class="grid gap-3">
                <For each={data()!.projectStats.slice(0, 8)}>
                  {(item) => (
                    <StatRow
                      title={item.projectName}
                      subtitle={item.directory}
                      amount={currency(item.totalCost, locale())}
                      meta={`${compactNumber(item.totalTokens, locale())} · ${language.t("settings.usage.label.requests")}: ${decimal(item.requestCount, locale(), 0)}`}
                      share={item.share}
                    />
                  )}
                </For>
              </div>
            </SettingsList>

            <SettingsList class="border border-border-weak-base bg-surface-base/70">
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <Tabs value={tab()} onChange={(value) => setTab((value as (typeof detailTabs)[number]["value"]) ?? "logs")} variant="pill">
                    <Tabs.List class="gap-2">
                      <For each={detailTabs}>
                        {(item) => <Tabs.Trigger value={item.value}>{language.t(item.label as never)}</Tabs.Trigger>}
                      </For>
                    </Tabs.List>
                  </Tabs>
                  <div class="grid gap-3 sm:grid-cols-2 xl:min-w-[420px] xl:grid-cols-2">
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
                  </div>
                </div>

                <Collapsible open={advancedOpen()} onOpenChange={setAdvancedOpen} class="rounded-[18px] border border-border-weak-base bg-surface-base/70">
                  <Collapsible.Trigger class="flex w-full items-center justify-between gap-4 px-4 py-3 text-left">
                    <div>
                      <div class="text-14-medium text-text-strong">{language.t("settings.usage.filter.advanced")}</div>
                      <div class="pt-1 text-12-regular text-text-weak">
                        {language.t("settings.usage.filter.advancedHint", { count: activeFilterCount().toString() })}
                      </div>
                    </div>
                    <div class="flex items-center gap-2 text-12-regular text-text-weak">
                      <Show when={activeFilterCount() > 0}>
                        <span class="rounded-full bg-surface-raised-base px-2 py-1 text-text-strong">{activeFilterCount()}</span>
                      </Show>
                      <Icon name="chevron-down" size="small" />
                    </div>
                  </Collapsible.Trigger>
                  <Collapsible.Content class="border-t border-border-weak-base px-4 py-4">
                    <div class="grid gap-3 lg:grid-cols-2 2xl:grid-cols-5">
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
                      onSelect={(item) => setStatus((item?.value ?? USAGE_ALL) as UsageStatus | typeof USAGE_ALL)}
                        triggerVariant="settings"
                        variant="secondary"
                        size="small"
                      />
                      <Select
                        options={agentKindOptions()}
                        current={selectedAgentKind()}
                        value={(item) => item.value}
                        label={(item) => item.label}
                      onSelect={(item) => setAgentKind((item?.value ?? USAGE_ALL) as UsageAgentKind | typeof USAGE_ALL)}
                        triggerVariant="settings"
                        variant="secondary"
                        size="small"
                      />
                      <div class="flex h-9 items-center gap-2 rounded-lg border border-border-weak-base bg-surface-base px-3">
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
                  </Collapsible.Content>
                </Collapsible>

                <div class="pt-1">
                  <Switch>
                    <Match when={tab() === "logs"}>
                      <div class="overflow-hidden rounded-[18px] border border-border-weak-base">
                        <div class="overflow-x-auto">
                          <table class="min-w-full text-left text-12-regular text-text-weak">
                            <thead class="bg-surface-base/80 text-text-strong">
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
                            <tbody>
                              <For each={logs()}>
                                {(item) => (
                                  <tr class="border-t border-border-weak-base align-top">
                                    <td class="whitespace-nowrap px-3 py-3">{dateTime(item.time, locale())}</td>
                                    <td class="px-3 py-3">
                                      <div class="max-w-[220px] truncate text-text-strong">{item.projectName || item.projectID}</div>
                                      <div class="max-w-[220px] truncate pt-1">{item.directory}</div>
                                    </td>
                                    <td class="px-3 py-3">
                                      <div class="max-w-[220px] truncate text-text-strong">{item.sessionTitle || item.sessionID}</div>
                                      <div class="pt-1">{item.model}</div>
                                    </td>
                                    <td class="whitespace-nowrap px-3 py-3">{item.provider}</td>
                                    <td class="px-3 py-3">
                                      <div class="whitespace-nowrap text-text-strong">{language.t(`settings.usage.agent.${item.agentKind}` as never)}</div>
                                      <Show when={item.agentID && item.agentID !== "main"}>
                                        <div class="pt-1">{item.agentID}</div>
                                      </Show>
                                    </td>
                                    <td class="whitespace-nowrap px-3 py-3">{compactNumber(item.input, locale())}</td>
                                    <td class="whitespace-nowrap px-3 py-3">{compactNumber(item.output, locale())}</td>
                                    <td class="whitespace-nowrap px-3 py-3">{compactNumber(item.reasoning, locale())}</td>
                                    <td class="whitespace-nowrap px-3 py-3">{compactNumber(item.cacheRead, locale())}</td>
                                    <td class="whitespace-nowrap px-3 py-3">{compactNumber(item.cacheWrite, locale())}</td>
                                    <td class="whitespace-nowrap px-3 py-3">{currency(item.cost, locale())}</td>
                                    <td class="px-3 py-3">
                                      <div>{nullableMetric(item.duration, locale())}</div>
                                      <div class="pt-1">{nullableMetric(item.ttft, locale())}</div>
                                    </td>
                                    <td class="px-3 py-3">
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
                          <div class="border-t border-border-weak-base px-4 py-4">
                            <Button
                              variant="secondary"
                              size="small"
                              disabled={logsQuery.isFetchingNextPage}
                              onClick={() => void logsQuery.fetchNextPage()}
                            >
                              {logsQuery.isFetchingNextPage ? language.t("common.loading") : language.t("settings.usage.logs.more")}
                            </Button>
                          </div>
                        </Show>
                      </div>
                    </Match>

                    <Match when={tab() === "providers"}>
                      <div class="grid gap-3">
                        <For each={data()!.providerStats}>
                          {(item) => (
                            <StatRow
                              title={item.provider}
                              amount={currency(item.totalCost, locale())}
                              meta={`${compactNumber(item.totalTokens, locale())} · ${language.t("settings.usage.label.requests")}: ${decimal(item.requestCount, locale(), 0)}`}
                              share={item.share}
                            />
                          )}
                        </For>
                      </div>
                    </Match>

                    <Match when={tab() === "models"}>
                      <div class="grid gap-3">
                        <For each={data()!.modelStats}>
                          {(item) => (
                            <StatRow
                              title={item.model}
                              subtitle={item.provider}
                              amount={currency(item.totalCost, locale())}
                              meta={`${compactNumber(item.totalTokens, locale())} · ${language.t("settings.usage.label.requests")}: ${decimal(item.requestCount, locale(), 0)}`}
                              share={item.share}
                            />
                          )}
                        </For>
                      </div>
                    </Match>
                  </Switch>
                </div>
              </div>
            </SettingsList>
          </Show>
        </Show>
      </div>
    </div>
  )
}
