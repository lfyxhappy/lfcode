import { createInfiniteQuery, createQuery } from "@tanstack/solid-query"
import { formatTokenCount } from "@lfcode-ai/shared/token-format"
import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Select } from "@lfcode-ai/ui/select"
import { TextField } from "@lfcode-ai/ui/text-field"
import { type Component, type JSX, For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { SettingsList } from "./settings-list"
import {
  buildUsageFilters,
  buildUsageHeatmap,
  buildUsageOptions,
  formatUsageDuration,
  hasMoreUsageLogs,
  selectedUsageOption,
  usageHeatmapIntensity,
  usagePollingEnabled,
  USAGE_CACHE_TIME,
  USAGE_ALL,
  USAGE_REFRESH_INTERVAL,
  type UsageAgentKind,
  type UsageData,
  type UsageHeatmapCell,
  type UsageHeatmapGranularity,
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
  void locale
  return formatTokenCount(value)
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
  return `${decimal(value ?? 0, locale)}%`
}

function dateTime(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
}

function statusTone(status: UsageLog["status"]) {
  if (status === "completed") return "bg-status-success/10 text-status-success"
  if (status === "error") return "bg-status-error/10 text-status-error"
  return "bg-status-warning/10 text-status-warning"
}

function usageModelLabel(item: UsageLog) {
  return item.variant && item.variant !== "default" ? `${item.model} (${item.variant})` : item.model
}

const MiniMetric: Component<{ title: string; value: string; hint?: string }> = (props) => (
  <div class="px-4 py-3">
    <div class="text-12-regular text-text-weak">{props.title}</div>
    <div class="pt-2 text-18-medium text-text-strong">{props.value}</div>
    <Show when={props.hint}>
      {(hint) => <div class="pt-1 text-12-regular text-text-weak">{hint()}</div>}
    </Show>
  </div>
)

const HeatmapMetric: Component<{ title: string; value: string }> = (props) => (
  <div class="min-h-0 overflow-hidden bg-surface-raised-base px-5 py-5">
    <div class="text-[clamp(1.75rem,3vw,2.35rem)] font-medium leading-none text-text-strong">{props.value}</div>
    <div class="pt-2 text-14-regular text-text-weak">{props.title}</div>
  </div>
)

const SectionHeader: Component<{ title: string; description?: string; trailing?: string; controls?: JSX.Element }> = (props) => (
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
    <Show when={props.controls}>{props.controls}</Show>
  </div>
)

const StatRow: Component<{ title: string; subtitle?: string; amount: string; meta: string; share?: number }> = (props) => (
  <div class="px-4 py-3">
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

const UsageHeatmap: Component<{
  points: UsageData["heatmap"]
  summary: UsageData["heatmapSummary"]
  granularity: UsageHeatmapGranularity
  locale: string
  labels: {
    aria: string
    noData: string
    low: string
    high: string
    tokens: string
    total: string
    peak: string
    activeDays: string
  }
}> = (props) => {
  let heatmapArea: HTMLDivElement | undefined
  const [heatmapHeight, setHeatmapHeight] = createSignal<number>()
  const heatmap = createMemo(() => buildUsageHeatmap(props.points, props.granularity))
  const month = createMemo(() => {
    const value = heatmap()
    return value.kind === "month" ? value : undefined
  })
  const week = createMemo(() => {
    const value = heatmap()
    return value.kind === "week" ? value : undefined
  })
  const day = createMemo(() => {
    const value = heatmap()
    return value.kind === "day" ? value : undefined
  })
  const max = createMemo(() => Math.max(0, ...props.points.map((point) => point.totalTokens)))
  const dateLabel = (time: number) =>
    new Intl.DateTimeFormat(props.locale, { month: "numeric", day: "numeric" }).format(time)
  const monthLabel = (time: number) => new Intl.DateTimeFormat(props.locale, { month: "numeric" }).format(time)
  const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`
  const hourRange = (hour: number) => `${String(hour).padStart(2, "0")}-${String(hour + 2).padStart(2, "0")}`
  const weekLabel = (time: number) => {
    const date = new Date(time)
    const firstDay = new Date(date.getFullYear(), 0, 1)
    return `第${Math.ceil(((date.getTime() - firstDay.getTime()) / 86_400_000 + firstDay.getDay() + 1) / 7)}周`
  }
  const cell = (point: UsageHeatmapCell | undefined, label: string, className = "size-5") => (
    <button
      type="button"
      class={`${className} rounded-[3px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#60a5fa]`}
      style={{ background: point ? `rgb(37 99 235 / ${usageHeatmapIntensity(point.totalTokens, max())})` : "var(--surface-raised-base)" }}
      aria-label={point ? `${label}: ${formatTokenCount(point.totalTokens)} ${props.labels.tokens}` : `${label}: ${props.labels.noData}`}
      title={point ? `${label}: ${formatTokenCount(point.totalTokens)} ${props.labels.tokens}` : `${label}: ${props.labels.noData}`}
    />
  )

  createEffect(() => {
    if (!heatmapArea) return
    const observer = new ResizeObserver(() => setHeatmapHeight(Math.ceil(heatmapArea?.getBoundingClientRect().height ?? 0)))
    observer.observe(heatmapArea)
    setHeatmapHeight(Math.ceil(heatmapArea.getBoundingClientRect().height))
    onCleanup(() => observer.disconnect())
  })

  return (
    <div class="grid items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_250px]">
      <div class="min-w-0 py-1">
        <div ref={(element) => (heatmapArea = element)}>
          <Switch>
          <Match when={month()}>
            <div class="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2">
              <div />
              <div class="grid h-4 gap-1 text-[10px] text-text-weak" style={{ "grid-template-columns": `repeat(${month()!.columns.length}, minmax(0, 1fr))` }}>
                <For each={month()!.columns}>
                  {(column, index) => {
                    const monthStart = column.cells.find((item) => new Date(item.day).getDate() === 1)
                    return <span class="truncate">{monthStart ? monthLabel(monthStart.day) : index() === 0 ? monthLabel(column.cells[3]?.day ?? column.cells[0].day) : ""}</span>
                  }}
                </For>
              </div>
              <div class="grid grid-rows-7 gap-1 text-right text-[10px] leading-none text-text-weak">
                <For each={month()!.columns[0]?.cells ?? []}>
                  {(_, index) => <span class="flex items-center justify-end">{["一", "二", "三", "四", "五", "六", "七"][index()]}</span>}
                </For>
              </div>
              <div class="grid w-full gap-1" role="grid" aria-label={props.labels.aria} style={{ "grid-template-columns": `repeat(${month()!.columns.length}, minmax(0, 1fr))` }}>
                <For each={month()!.columns}>
                  {(column) => (
                    <div class="grid h-full grid-rows-7 gap-1">
                      <For each={column.cells}>{(item) => cell(item.cell, dateLabel(item.day), "aspect-square w-full")}</For>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Match>
          <Match when={week()}>
            <div class="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2">
              <div />
              <div class="grid h-4 grid-cols-2 gap-1 text-[10px] text-text-weak">
                <For each={[0, 7]}>{(index) => <span class="truncate">{weekLabel(week()!.columns[index]?.day ?? week()!.columns[0].day)}</span>}</For>
              </div>
              <div class="grid grid-rows-8 gap-1 text-right text-[10px] leading-none text-text-weak">
                <For each={Array.from({ length: 8 })}>{(_, slot) => <span class="flex items-center justify-end">{slot() % 2 === 0 ? hourRange(slot() * 3) : ""}</span>}</For>
              </div>
              <div class="grid w-full gap-1" role="grid" aria-label={props.labels.aria} style={{ "grid-template-columns": `repeat(${week()!.columns.length}, minmax(0, 1fr))` }}>
                <For each={week()!.columns}>
                  {(column) => (
                    <div class="grid h-full grid-rows-8 gap-1">
                      <For each={column.cells}>{(point, slot) => cell(point, dateLabel(column.day) + " " + hourLabel(slot() * 3), "aspect-square w-full")}</For>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Match>
          <Match when={day()}>
            <div>
              <div class="grid h-4 gap-1 text-[10px] text-text-weak" style={{ "grid-template-columns": `repeat(${day()!.columns.length}, minmax(0, 1fr))` }}>
                <For each={day()!.columns}>{(column) => <span class="truncate">{dateLabel(column.day)}</span>}</For>
              </div>
              <div class="grid w-full gap-1" role="grid" aria-label={props.labels.aria} style={{ "grid-template-columns": `repeat(${day()!.columns.length}, minmax(0, 1fr))` }}>
                <For each={day()!.columns}>
                  {(column) => (
                    <div class="grid grid-cols-3 grid-rows-8 gap-1">
                      <For each={column.cells}>{(point, hour) => cell(point, dateLabel(column.day) + " " + hourLabel(hour()), "aspect-square w-full")}</For>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Match>
          </Switch>
        </div>
        <div class="flex items-center justify-end gap-2 pt-3 text-12-regular text-text-weak">
          <span>{props.labels.low}</span>
          <For each={[0.16, 0.32, 0.5, 0.72, 1]}>{(opacity) => <span class="size-3 rounded-sm" style={{ background: `rgb(37 99 235 / ${opacity})` }} />}</For>
          <span>{props.labels.high}</span>
        </div>
      </div>
      <div
        class="grid min-h-0 grid-rows-3 gap-3"
        style={{ height: heatmapHeight() ? `${heatmapHeight()}px` : undefined }}
      >
        <HeatmapMetric title={props.labels.total} value={compactNumber(props.summary.totalTokens, props.locale)} />
        <HeatmapMetric title={props.labels.peak} value={compactNumber(props.summary.peakDailyTokens, props.locale)} />
        <HeatmapMetric title={props.labels.activeDays} value={decimal(props.summary.activeDays, props.locale, 0)} />
      </div>
    </div>
  )
}

export const SettingsUsage: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [range, setRange] = createSignal<UsageRange>("today")
  const [provider, setProvider] = createSignal(USAGE_ALL)
  const [model, setModel] = createSignal(USAGE_ALL)
  const [session, setSession] = createSignal(USAGE_ALL)
  const [status, setStatus] = createSignal<UsageStatus | typeof USAGE_ALL>(USAGE_ALL)
  const [agentKind, setAgentKind] = createSignal<UsageAgentKind | typeof USAGE_ALL>(USAGE_ALL)
  const [heatmapGranularity, setHeatmapGranularity] = createSignal<UsageHeatmapGranularity>("month")
  const [search, setSearch] = createSignal("")
  const [tab, setTab] = createSignal<(typeof detailTabs)[number]["value"]>("logs")
  const [documentVisible, setDocumentVisible] = createSignal(
    typeof document === "undefined" || document.visibilityState === "visible",
  )
  const [nativeWindowVisible, setNativeWindowVisible] = createSignal(true)
  const windowVisible = createMemo(() => usagePollingEnabled({ documentVisible: documentVisible(), nativeVisible: nativeWindowVisible() }))

  onMount(() => {
    const updateDocumentVisibility = () => setDocumentVisible(document.visibilityState === "visible")
    updateDocumentVisibility()
    document.addEventListener("visibilitychange", updateDocumentVisibility)

    const getNativeVisibility = window.api?.getWindowVisibility
    const removeNativeVisibilityListener = window.api?.onWindowVisibility?.(setNativeWindowVisible)
    if (getNativeVisibility) void getNativeVisibility().then(setNativeWindowVisible).catch(() => undefined)

    onCleanup(() => {
      document.removeEventListener("visibilitychange", updateDocumentVisibility)
      removeNativeVisibilityListener?.()
    })
  })

  const filters = createMemo(() =>
    buildUsageFilters({
      range: range(),
      heatmapGranularity: "month",
      provider: provider(),
      model: model(),
      project: USAGE_ALL,
      session: session(),
      status: status(),
      agentKind: agentKind(),
      search: search(),
    }),
  )

  const heatmapFilters = createMemo(() =>
    buildUsageFilters({
      // The heatmap owns its time window. The top-level range only filters
      // summary, trend, and log data and must not hide historical heatmap cells.
      range: "all",
      heatmapGranularity: heatmapGranularity(),
      provider: provider(),
      model: model(),
      project: USAGE_ALL,
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
      "month",
      provider(),
      model(),
      session(),
      status(),
      agentKind(),
      search(),
    ],
    queryFn: () =>
      globalSDK.client.usage.get({
        ...filters(),
        limit: PAGE_SIZE,
      }),
    staleTime: USAGE_CACHE_TIME,
    gcTime: 30 * 60 * 1000,
    enabled: () => windowVisible(),
    refetchInterval: USAGE_REFRESH_INTERVAL,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  }))

  const data = createMemo(() => usageQuery.data?.data)

  const logsQuery = createInfiniteQuery(() => ({
    queryKey: [
      "settings-usage",
      "logs",
      globalSDK.url,
      range(),
      provider(),
      model(),
      session(),
      status(),
      agentKind(),
      search(),
    ],
    queryFn: ({ pageParam }) =>
      globalSDK.client.usage.get({
        ...filters(),
        limit: PAGE_SIZE,
        cursor: typeof pageParam === "number" ? pageParam : data()?.nextCursor ?? undefined,
      }),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.data?.nextCursor ?? undefined,
    enabled: false,
    staleTime: USAGE_CACHE_TIME,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  }))

  const heatmapQuery = createQuery(() => ({
    queryKey: [
      "settings-usage",
      "heatmap",
      globalSDK.url,
      heatmapGranularity(),
      provider(),
      model(),
      session(),
      status(),
      agentKind(),
      search(),
    ],
    queryFn: () => globalSDK.client.usage.get({ ...heatmapFilters(), limit: 1 }),
    enabled: () => windowVisible(),
    placeholderData: (previous) => previous,
    staleTime: USAGE_CACHE_TIME,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  }))

  const heatmapData = createMemo(() => heatmapQuery.data?.data)
  const locale = createMemo(() => language.intl())
  const logs = createMemo(() => [
    ...(data()?.logs ?? []),
    ...(logsQuery.data?.pages.flatMap((page) => page.data?.logs ?? []) ?? []),
  ])
  const errorText = createMemo(() => {
    const error = usageQuery.error ?? heatmapQuery.error ?? logsQuery.error
    if (!error) return
    if (error instanceof Error) return error.message
    return String(error)
  })
  const activeFilterCount = createMemo(
    () =>
      [provider(), model(), session(), status(), agentKind()]
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
  const selectedSession = createMemo(() => selectedUsageOption(sessionOptions(), session()))
  const selectedStatus = createMemo(() => selectedUsageOption(statusOptions(), status()))
  const selectedAgentKind = createMemo(() => selectedUsageOption(agentKindOptions(), agentKind()))
  const hasMoreLogs = createMemo(() => {
    const pages = logsQuery.data?.pages
    const lastPage = pages?.[pages.length - 1]
    return hasMoreUsageLogs(lastPage?.data?.nextCursor ?? data()?.nextCursor)
  })
  const heatmapLabels = createMemo(() => ({
    aria: language.t("settings.usage.heatmap.aria"),
    noData: language.t("settings.usage.heatmap.noData"),
    low: language.t("settings.usage.heatmap.low"),
    high: language.t("settings.usage.heatmap.high"),
    tokens: language.t("settings.usage.metric.totalTokens"),
    total: language.t("settings.usage.heatmap.total"),
    peak: language.t("settings.usage.heatmap.peak"),
    activeDays: language.t("settings.usage.heatmap.activeDays"),
    granularity: {
      month: language.t("settings.usage.heatmap.month"),
      week: language.t("settings.usage.heatmap.week"),
      day: language.t("settings.usage.heatmap.day"),
    },
  }))

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 border-b border-border-weaker-base bg-background-base">
        <div class="flex w-full items-end justify-between gap-4 pb-6 pt-6">
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

      <div class="w-full space-y-8 pt-6">
        <Show when={errorText()}>
          {(message) => (
            <div class="rounded-[6px] border border-border-weak-base bg-surface-base px-4 py-4 text-14-regular text-status-warning">
              {message()}
            </div>
          )}
        </Show>

        <Show
          when={!usageQuery.isLoading}
          fallback={
            <SettingsList>
              <div class="py-10 text-center text-14-regular text-text-weak">{language.t("common.loading")}</div>
            </SettingsList>
          }
        >
          <SettingsList class="border-y border-border-weak-base px-0 py-0">
              <div class="grid divide-y divide-border-weak-base">
                <div class="grid divide-y divide-border-weak-base sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
                  <MiniMetric
                    title={language.t("settings.usage.metric.totalTokens")}
                    value={compactNumber(data()!.summary.totalTokens, locale())}
                    hint={`${language.t("settings.usage.metric.input")} · ${compactNumber(data()!.summary.inputTokens, locale())}`}
                  />
                  <MiniMetric
                    title={language.t("settings.usage.metric.totalCost")}
                    value={currency(data()!.summary.totalCost, locale())}
                    hint={`${language.t("settings.usage.metric.output")} · ${compactNumber(data()!.summary.outputTokens, locale())}`}
                  />
                  <MiniMetric
                    title={language.t("settings.usage.metric.requests")}
                    value={decimal(data()!.summary.requestCount, locale(), 0)}
                    hint={`${language.t("settings.usage.metric.successRate")} · ${percent(data()!.summary.successRate, locale())}`}
                  />
                  <MiniMetric
                    title={language.t("settings.usage.metric.cacheHitRatio")}
                    value={percent(data()!.summary.cacheHitRatio, locale())}
                    hint={`${language.t("settings.usage.metric.cacheHit")} · ${compactNumber(data()!.summary.cacheHitTokens, locale())}`}
                  />
                </div>
                <div class="grid divide-y divide-border-weak-base sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                  <MiniMetric
                    title={language.t("settings.usage.metric.cacheCreate")}
                    value={compactNumber(data()!.summary.cacheCreateTokens, locale())}
                    hint={`${language.t("settings.usage.metric.totalCost")} · ${currency(data()!.summary.overheadCost, locale())}`}
                  />
                  <MiniMetric title={language.t("settings.usage.metric.avgDuration")} value={formatUsageDuration(data()!.summary.avgDuration, locale())} />
                  <MiniMetric title={language.t("settings.usage.metric.avgTtft")} value={formatUsageDuration(data()!.summary.avgTtft, locale())} />
                </div>
              </div>
          </SettingsList>

            <SettingsList>
              <SectionHeader
                title={language.t("settings.usage.section.heatmap")}
                description={language.t("settings.usage.heatmap.description")}
                controls={
                  <div
                    class="flex items-center gap-1"
                    role="group"
                    aria-label={heatmapLabels().aria}
                    data-ui-control-group="usage-heatmap-granularity"
                    data-ui-control-intent="mode-switch"
                    data-ui-control-presentation="toggle-button"
                    data-ui-option-count="3"
                  >
                    <For each={["month", "week", "day"] as UsageHeatmapGranularity[]}>
                      {(value) => (
                        <button
                          type="button"
                          aria-pressed={heatmapGranularity() === value}
                          class={heatmapGranularity() === value ? "rounded-[4px] bg-surface-raised-base px-2 py-1 text-12-medium text-text-strong" : "rounded-[4px] px-2 py-1 text-12-medium text-text-weak hover:bg-surface-raised-base hover:text-text-strong"}
                          onClick={() => setHeatmapGranularity(value)}
                        >
                          {heatmapLabels().granularity[value]}
                        </button>
                      )}
                    </For>
                  </div>
                }
              />
              <UsageHeatmap
                points={heatmapData()?.heatmap ?? []}
                summary={heatmapData()?.heatmapSummary ?? { totalTokens: 0, peakDailyTokens: 0, activeDays: 0 }}
                granularity={heatmapGranularity()}
                locale={locale()}
                labels={heatmapLabels()}
              />
            </SettingsList>

            <SettingsList>
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-3 rounded-[6px] border border-border-weak-base bg-surface-base p-2 xl:flex-row xl:items-center xl:justify-between">
                  <div
                    class="flex min-w-0 shrink-0 items-center gap-1 rounded-md bg-surface-raised-base p-1"
                    role="group"
                    aria-label={language.t("settings.usage.section.logs")}
                    data-ui-control-group="usage-detail-tabs"
                    data-ui-control-intent="content-switch"
                    data-ui-control-presentation="segmented"
                    data-ui-option-count={detailTabs.length}
                  >
                    <For each={detailTabs}>
                      {(item) => (
                        <button
                          type="button"
                          aria-pressed={tab() === item.value}
                          class={
                            tab() === item.value
                              ? "rounded px-3 py-1.5 text-12-medium text-text-strong shadow-sm bg-surface-base"
                              : "rounded px-3 py-1.5 text-12-medium text-text-weak hover:bg-surface-base-hover hover:text-text-strong"
                          }
                          onClick={() => setTab(item.value)}
                        >
                          {language.t(item.label as never)}
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="grid min-w-0 gap-2 sm:grid-cols-2 xl:w-[440px] xl:flex-shrink-0">
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

                <div class="rounded-[6px] border border-border-weak-base bg-surface-base">
                  <div class="flex items-center justify-between gap-4 px-3 py-2">
                    <div>
                      <div class="text-13-medium text-text-strong">{language.t("settings.usage.filter.advanced")}</div>
                    </div>
                    <div class="flex items-center gap-2 text-12-regular text-text-weak" aria-live="polite">
                      <span>{language.t("settings.usage.filter.advancedHint", { count: activeFilterCount().toString() })}</span>
                      <Show when={activeFilterCount() > 0}>
                        <span class="rounded-full bg-surface-raised-base px-1.5 py-0.5 text-text-strong">{activeFilterCount()}</span>
                      </Show>
                    </div>
                  </div>
                  <div class="border-t border-border-weak-base px-3 py-3">
                    <div class="grid min-w-0 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
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
                      <div class="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border-weak-base bg-surface-base px-3">
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

                <div class="pt-1">
                  <Switch>
                    <Match when={tab() === "logs"}>
                      <div class="overflow-hidden rounded-[6px] border border-border-weak-base">
                        <div class="h-[360px] overflow-y-auto sm:h-[420px]">
                          <table class="w-full table-fixed text-left text-12-regular text-text-weak">
                            <colgroup>
                              <col class="w-[14%]" />
                              <col class="w-[23%]" />
                              <col class="w-[17%]" />
                              <col class="w-[18%]" />
                              <col class="w-[10%]" />
                              <col class="w-[10%]" />
                              <col class="w-[8%]" />
                            </colgroup>
                            <thead class="sticky top-0 z-[1] bg-surface-base text-text-strong shadow-[0_1px_0_var(--border-weak-base)]">
                              <tr>
                                <th class="px-3 py-2.5">{language.t("settings.usage.table.time")}</th>
                                <th class="px-3 py-2.5">{language.t("settings.usage.table.provider")} / {language.t("settings.usage.table.model")}</th>
                                <th class="px-3 py-2.5">{language.t("settings.usage.table.input")} / {language.t("settings.usage.table.output")}</th>
                                <th class="px-3 py-2.5">{language.t("settings.usage.table.reasoning")} / {language.t("settings.usage.table.cacheRead")} / {language.t("settings.usage.table.cacheWrite")}</th>
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
                                    <td class="min-w-0 px-3 py-3">
                                      <div class="truncate text-text-strong" title={`${item.provider} / ${usageModelLabel(item)}`}>{item.provider}</div>
                                      <div class="truncate pt-1" title={usageModelLabel(item)}>{usageModelLabel(item)}</div>
                                    </td>
                                    <td class="whitespace-nowrap px-3 py-3">
                                      <div class="text-text-strong">{compactNumber(item.input, locale())} / {compactNumber(item.output, locale())}</div>
                                      <div class="pt-1">{language.t("settings.usage.table.input")} / {language.t("settings.usage.table.output")}</div>
                                    </td>
                                    <td class="whitespace-nowrap px-3 py-3">
                                      <div class="text-text-strong">{compactNumber(item.reasoning, locale())}</div>
                                      <div class="pt-1">{compactNumber(item.cacheRead, locale())} / {compactNumber(item.cacheWrite, locale())}</div>
                                    </td>
                                    <td class="whitespace-nowrap px-3 py-3">{currency(item.cost, locale())}</td>
                                    <td class="px-3 py-3">
                                      <div>{formatUsageDuration(item.duration, locale())}</div>
                                      <div class="pt-1">{formatUsageDuration(item.ttft, locale())}</div>
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
      </div>
    </div>
  )
}
