import { Button } from "@lfcode-ai/ui/button"
import { formatTokenCount } from "@lfcode-ai/shared/token-format"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { type Accessor, createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { Link } from "./link"
import {
  quotaBalanceFields,
  quotaProviderDocsURL,
  quotaProviderIDs,
  quotaRefreshResult,
  shouldRefreshQuota,
  supportsQuotaQuery,
  visibleQuotaWindows,
  type QuotaBalance,
  type QuotaResult,
  type QuotaWindow,
} from "./provider-quota-capability"

type QuotaProvider = {
  name: string
  query: (client: ReturnType<typeof useSDK>["client"]) => Promise<{ data?: QuotaResult }>
}

type QuotaCacheEntry = {
  result: Extract<QuotaResult, { ok: true }>
  cachedAt: number
}

const quotaResultCache = new Map<string, QuotaCacheEntry>()

export const quotaProviders: Record<string, QuotaProvider> = {
  opencode: {
    name: "OpenCode Zen",
    query: (client) => client.provider.opencode.usage(),
  },
  "opencode-go": {
    name: "OpenCode Go",
    query: (client) => client.provider.opencodeGo.usage(),
  },
  minimax: {
    name: "MiniMax Token Plan",
    query: (client) => client.provider.minimax.usage(),
  },
  "minimax-cn-coding-plan": {
    name: "MiniMax Token Plan",
    query: (client) => client.provider.minimax.usage(),
  },
  deepseek: {
    name: "DeepSeek",
    query: (client) => client.provider.deepseek.usage(),
  },
  moonshotai: {
    name: "Moonshot AI",
    query: (client) => client.provider.moonshot.usage(),
  },
  siliconflow: {
    name: "SiliconFlow",
    query: (client) => client.provider.siliconflow.usage(),
  },
  openrouter: {
    name: "OpenRouter",
    query: (client) => client.provider.openrouter.usage(),
  },
} satisfies Record<string, QuotaProvider>

function resetTime(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
}

function formatAmount(value: number, currency: string, locale: string) {
  return `${formatNumber(value, locale)} ${currency}`
}

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds))
  const days = Math.floor(value / 86_400)
  const hours = Math.floor((value % 86_400) / 3_600)
  const minutes = Math.floor((value % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function resetSeconds(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
}

function quotaWindowPeriod(quota: QuotaWindow) {
  if (quota.resetPeriod) return quota.resetPeriod
  return quota.id.includes(":") ? quota.id.split(":", 2)[1] : quota.id
}

function readableQuotaWindowID(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function networkQuotaResult(): Extract<QuotaResult, { ok: false }> {
  return { ok: false, error: "network" }
}

function QuotaBalanceGroup(props: { balance: QuotaBalance; locale: string }) {
  const language = useLanguage()
  const fields = () => quotaBalanceFields(props.balance)
  return (
    <section class="flex flex-col gap-2 py-2 first:pt-0 last:pb-0" data-component="provider-quota-balance" aria-label={language.t("provider.quota.scope.account")}>
      <div class="flex items-center justify-between gap-3 text-12-medium">
        <span class="text-text-strong">{language.t("provider.quota.scope.account")}</span>
        <Show when={props.balance.isAvailable === false}>
          <span class="text-status-warning">{language.t("provider.quota.unavailable")}</span>
        </Show>
      </div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <For each={fields()}>
          {(field) => (
            <div class="flex min-w-0 items-baseline justify-between gap-2" data-component="provider-quota-balance-field" data-balance-field={field.id}>
              <dt class="text-11-regular text-text-weak">{language.t(`provider.quota.balance.${field.id}` as never)}</dt>
              <dd class="truncate text-12-medium text-text-strong" title={formatAmount(field.value, props.balance.currency, props.locale)}>{formatAmount(field.value, props.balance.currency, props.locale)}</dd>
            </div>
          )}
        </For>
      </dl>
    </section>
  )
}

function QuotaRow(props: { quota: QuotaWindow; locale: string; label: (quota: QuotaWindow) => string; updated: boolean }) {
  const language = useLanguage()
  const usedPercent = () => {
    const explicit = props.quota.usedPercent ?? props.quota.percent
    if (explicit !== undefined) return Math.min(100, Math.max(0, explicit))
    if (props.quota.used !== undefined && props.quota.total !== undefined && props.quota.total > 0) return Math.min(100, Math.max(0, (props.quota.used / props.quota.total) * 100))
    if (props.quota.remaining !== undefined && props.quota.total !== undefined && props.quota.total > 0) return Math.min(100, Math.max(0, (1 - props.quota.remaining / props.quota.total) * 100))
  }
  const remainingPercent = () => {
    const explicit = props.quota.remainingPercent
    if (explicit !== undefined) return Math.min(100, Math.max(0, explicit))
    const used = usedPercent()
    if (used === undefined) return
    return 100 - used
  }
  const hasPercent = () => usedPercent() !== undefined
  const details = () => {
    const unit = props.quota.unit === "requests"
      ? ` ${language.t("provider.quota.unit.requests")}`
      : props.quota.unit === "tokens"
        ? ` ${language.t("provider.quota.unit.tokens")}`
        : ""
    const value = (amount: number) => props.quota.currency
      ? formatAmount(amount, props.quota.currency, props.locale)
      : props.quota.unit === "tokens"
        ? `${formatTokenCount(amount)}${unit}`
        : `${formatNumber(amount, props.locale)}${unit}`
    const values = []
    if (props.quota.remaining !== undefined) {
      values.push(`${language.t("provider.quota.remaining")}: ${value(props.quota.remaining)}${props.quota.total !== undefined ? ` / ${value(props.quota.total)}` : ""}`)
    }
    if (props.quota.used !== undefined) {
      values.push(`${language.t("provider.quota.used")}: ${value(props.quota.used)}${props.quota.total !== undefined ? ` / ${value(props.quota.total)}` : ""}`)
    }
    if (props.quota.total !== undefined && props.quota.remaining === undefined && props.quota.used === undefined) {
      values.push(`${language.t("provider.quota.total")}: ${value(props.quota.total)}`)
    }
    return values.length ? values.join(" · ") : undefined
  }
  const reset = () => {
    if (!props.quota.resetsAt) return
    return props.quota.resetInSeconds ?? resetSeconds(props.quota.resetsAt)
  }

  return (
    <div classList={{ "flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0": true, "provider-quota-updated": props.updated }} data-component="provider-quota-window">
      <div class="flex items-center justify-between gap-3 text-12-medium">
        <span class="min-w-0 truncate text-text-strong">{props.label(props.quota)}</span>
        <Show when={hasPercent()}>
          <span class={props.quota.status === "rate-limited" ? "shrink-0 text-status-warning" : "shrink-0 text-status-success"}>
            {language.t("provider.quota.percent", { used: (usedPercent() ?? 0).toFixed(0), remaining: (remainingPercent() ?? 0).toFixed(0) })}
          </span>
        </Show>
        <Show when={!hasPercent() && props.quota.status === "rate-limited"}>
          <span class="shrink-0 text-status-warning">{language.t("provider.quota.status.rateLimited")}</span>
        </Show>
      </div>
      <Show when={hasPercent()}>
        <div class="h-1.5 overflow-hidden rounded-sm bg-surface-base" aria-label={`${props.label(props.quota)}: ${(usedPercent() ?? 0).toFixed(0)}%`}>
          <div class={props.quota.status === "rate-limited" ? "h-full bg-status-warning transition-[width] duration-[var(--motion-content-ms)] ease-[var(--motion-ease-out)]" : "h-full bg-status-success transition-[width] duration-[var(--motion-content-ms)] ease-[var(--motion-ease-out)]"} style={{ width: `${usedPercent() ?? 0}%` }} />
        </div>
      </Show>
      <Show when={details()}>
        {(value) => <span class="text-11-regular text-text-weak">{value()}</span>}
      </Show>
      <Show when={props.quota.resetsAt}>
        {(resetsAt) => (
          <span class="text-11-regular text-text-weak leading-4">
            {language.t("provider.quota.resetsAt", { time: resetTime(resetsAt(), props.locale) })}
            {(() => {
              const seconds = reset()
              return seconds === undefined ? null : <> · {language.t("provider.quota.resetsIn", { time: formatDuration(seconds) })}</>
            })()}
          </span>
        )}
      </Show>
    </div>
  )
}

function ProviderQuotaCard(props: { providerID: string; refresh: Accessor<number>; onConfigure?: () => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const cached = quotaResultCache.get(props.providerID)
  const [result, setResult] = createSignal<QuotaResult | undefined>(cached?.result)
  const [loading, setLoading] = createSignal(!cached)
  const [updated, setUpdated] = createSignal(false)
  const [refreshError, setRefreshError] = createSignal<Extract<QuotaResult, { ok: false }>["error"]>()
  const provider = () => quotaProviders[props.providerID]
  const usage = () => {
    const value = result()
    if (!value?.ok) return
    return value.usage
  }
  const unsupported = () => !supportsQuotaQuery(props.providerID)
  const error = () => {
    const value = result()
    if (!value || value.ok) return
    if (value.error === "rate_limited") return language.t("provider.quota.status.rateLimited")
    return language.t(`provider.quota.error.${value.error}` as never)
  }
  const missingApiKey = () => {
    const value = result()
    return value?.ok === false && value.error === "missing_api_key"
  }
  const label = (quota: QuotaWindow) => {
    const period = quotaWindowPeriod(quota)
    if (["rolling", "five_hour", "daily", "weekly", "monthly"].includes(period)) return language.t(`provider.quota.window.${period}` as never)
    return language.t("provider.quota.window.unknown" as never, { name: readableQuotaWindowID(period) })
  }
  const lastSuccessfulAt = () => {
    const value = usage()
    if (!value) return
    return value.fetchedAt ?? new Date(quotaResultCache.get(props.providerID)?.cachedAt ?? Date.now()).toISOString()
  }

  createEffect(() => {
    const refresh = props.refresh()
    const source = provider()
    if (!source || unsupported()) {
      setLoading(false)
      return
    }
    const entry = quotaResultCache.get(props.providerID)
    if (!shouldRefreshQuota({ cachedAt: entry?.cachedAt, force: refresh > 0 })) {
      setResult(entry?.result)
      setRefreshError(undefined)
      setLoading(false)
      return
    }
    let disposed = false
    onCleanup(() => {
      disposed = true
    })
    setLoading(true)
    setRefreshError(undefined)
    void (async () => {
      try {
        const response = await source.query(sdk.client)
        return response.data ?? networkQuotaResult()
      } catch {
        return networkQuotaResult()
      }
    })().then((next) => {
      if (disposed) return
      if (next.ok) {
        const changed = JSON.stringify(quotaResultCache.get(props.providerID)?.result) !== JSON.stringify(next)
        quotaResultCache.set(props.providerID, { result: next, cachedAt: Date.now() })
        setResult(next)
        if (!changed) return
        setUpdated(true)
        window.setTimeout(() => setUpdated(false), 420)
        return
      }
      const applied = quotaRefreshResult({ cached: quotaResultCache.get(props.providerID)?.result, next })
      setRefreshError(applied.refreshError)
      setResult(applied.result)
    }).finally(() => {
      if (!disposed) setLoading(false)
    })
  })

  return (
    <div class="flex min-h-24 flex-col gap-3" data-component="provider-quota-card" data-provider-id={props.providerID}>
      <Show
        when={!unsupported()}
        fallback={
          <div class="flex flex-col items-start gap-2">
            <span class="text-12-regular text-text-weak">{language.t("provider.quota.unsupported" as never)}</span>
            <Show when={quotaProviderDocsURL(props.providerID)}>
              {(url) => <Link href={url()} data-action={`provider-quota-docs-${props.providerID}`}>{language.t("provider.quota.view")}</Link>}
            </Show>
          </div>
        }
      >
        <Show when={loading()}>
          <span class="text-12-regular text-text-weak">{language.t("provider.quota.loading")}</span>
        </Show>
        <Show when={refreshError() && quotaResultCache.has(props.providerID)}>
          <span class="text-11-regular text-status-warning">{language.t("provider.quota.refreshFailed" as never)}</span>
        </Show>
        <Show
          when={usage()}
          fallback={
            <Show when={!loading()}>
              <div class="flex flex-col items-start gap-3">
                <span class="text-12-regular text-status-warning">{error()}</span>
                <Show when={props.onConfigure && missingApiKey()}>
                  <Button size="small" variant="secondary" icon="settings-gear" onClick={props.onConfigure}>
                    {language.t("provider.quota.configure")}
                  </Button>
                </Show>
              </div>
            </Show>
          }
        >
          {(value) => {
            const windows = () => visibleQuotaWindows(value().windows)
            return (
              <div class="divide-y divide-border-weak-base">
                <Show when={value().balance}>
                  {(balance) => <QuotaBalanceGroup balance={balance()} locale={language.intl()} />}
                </Show>
                <Show when={windows().length > 0}>
                  <section class="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0" data-component="provider-quota-windows" aria-label={language.t("provider.quota.title")}>
                    <span class="text-12-medium text-text-strong">{language.t("provider.quota.title")}</span>
                    <div class="divide-y divide-border-weak-base">
                      <For each={windows()}>{(quota) => <QuotaRow quota={quota} updated={updated()} locale={language.intl()} label={label} />}</For>
                    </div>
                  </section>
                </Show>
                <Show when={!value().balance && windows().length === 0}>
                  <span class="block py-2 text-12-regular text-text-weak">{language.t("provider.quota.unavailable")}</span>
                </Show>
              </div>
            )
          }}
        </Show>
        <Show when={lastSuccessfulAt()}>
          {(fetchedAt) => <span class="text-11-regular text-text-weak" data-component="provider-quota-fetched-at">{language.t("provider.quota.lastUpdated" as never, { time: resetTime(fetchedAt(), language.intl()) })}</span>}
        </Show>
        <Show when={usage()?.source}>
          <span class="text-11-regular text-text-weak" data-component="provider-quota-source">{language.t("provider.quota.source.providerApi" as never)}</span>
        </Show>
      </Show>
    </div>
  )
}

export function ProviderQuotaCardContent(props: { providerID: string; providerName: string; onConfigure?: () => void }) {
  const language = useLanguage()
  const [refresh, setRefresh] = createSignal(0)

  return (
    <div class="flex min-w-[260px] flex-col gap-2" data-component="provider-quota-card" data-provider-id={props.providerID}>
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <span class="text-14-medium text-text-strong truncate">{props.providerName}</span>
        </div>
        <Show when={supportsQuotaQuery(props.providerID)}>
          <div data-ui-control-group="provider-quota-refresh" data-ui-control-intent="command" data-ui-control-presentation="icon-button" data-ui-option-count="1">
            <Tooltip placement="top" value={language.t("provider.quota.refresh")}>
              <IconButton icon="reset" variant="ghost" size="small" aria-label={language.t("provider.quota.refresh")} data-action={`provider-quota-refresh-${props.providerID}`} onClick={() => setRefresh((value) => value + 1)} />
            </Tooltip>
          </div>
        </Show>
      </div>
      <ProviderQuotaCard providerID={props.providerID} refresh={refresh} onConfigure={props.onConfigure} />
    </div>
  )
}

export function ProviderQuotaSidebarAction(props: { providerID: string | Accessor<string | undefined>; providerName: string | Accessor<string | undefined>; onConfigure: () => void }) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const providerID = () => typeof props.providerID === "function" ? props.providerID() : props.providerID
  const providerName = () => typeof props.providerName === "function" ? props.providerName() : props.providerName
  let trigger: HTMLButtonElement | undefined
  let content: HTMLDivElement | undefined

  createEffect(() => {
    if (!open()) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (trigger?.contains(target) || content?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown, true)
    onCleanup(() => {
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown, true)
    })
  })

  return (
    <Show when={providerID()}>
      <Show when={quotaProviderIDs.has(providerID()!)}>
        <button
          ref={trigger}
          type="button"
          data-component="icon-button"
          data-icon="usage"
          data-variant="ghost"
          data-size="large"
          data-action={`sidebar-provider-quota-${providerID()}`}
          data-ui-control-group="provider-quota-sidebar"
          data-ui-control-intent="command"
          data-ui-control-presentation="icon-button"
          data-ui-option-count="1"
          aria-label={language.t("provider.quota.view")}
          aria-expanded={open()}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="usage" size="normal" />
        </button>
        <Show when={open() && providerID()} keyed>
          {(id) => (
            <Portal mount={document.body}>
              <div ref={content} data-component="popover-content" data-provider-id={id} role="dialog" class="fixed bottom-16 left-4 sm:left-24 w-[320px] max-w-[calc(100vw-32px)] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-lg" style={{ "z-index": "2147483647" }}>
                <div class="flex items-center justify-between border-b border-border-weak-base px-3 py-2">
                  <span class="text-14-medium text-text-strong">{language.t("provider.quota.title")}</span>
                  <IconButton icon="close" variant="ghost" size="small" aria-label={language.t("ui.common.close")} onClick={() => setOpen(false)} />
                </div>
                <div class="p-3"><ProviderQuotaCardContent providerID={id} providerName={providerName() ?? ""} onConfigure={supportsQuotaQuery(id) ? props.onConfigure : undefined} /></div>
              </div>
            </Portal>
          )}
        </Show>
      </Show>
    </Show>
  )
}

export function ProviderQuotaConfigurationAction(props: { providerID: string; providerName: string; onConfigure: () => void; configured?: boolean }) {
  const language = useLanguage()
  const docsURL = quotaProviderDocsURL(props.providerID)
  if (!quotaProviderIDs.has(props.providerID)) return
  if (!supportsQuotaQuery(props.providerID) && docsURL) {
    return <Link href={docsURL} class="text-12-medium whitespace-nowrap" data-action={`settings-provider-quota-docs-${props.providerID}`}>{language.t("provider.quota.view")}</Link>
  }
  return (
    <Button size="small" variant="secondary" icon="settings-gear" data-action={`settings-provider-quota-config-${props.providerID}`} onClick={props.onConfigure}>
      {props.configured ? language.t("provider.quota.manage" as never) : language.t("provider.quota.configure")}
    </Button>
  )
}
