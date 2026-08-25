import { Button } from "@lfcode-ai/ui/button"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Icon } from "@lfcode-ai/ui/icon"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { type Accessor, createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { quotaProviderIDs } from "./provider-quota-capability"

type QuotaWindow = {
  id: string
  percent: number
  resetsAt: string
  status?: "ok" | "rate-limited"
  scope?: "account" | "model"
  modelName?: string
  usedPercent?: number
  remainingPercent?: number
  resetInSeconds?: number
  remaining?: number
  total?: number
  used?: number
  unit?: "requests" | "tokens" | "unknown"
}
type QuotaResult = { ok: true; usage: { windows: QuotaWindow[] } } | { ok: false; error: "missing_api_key" | "unauthorized" | "invalid_response" | "network" }
type QuotaProvider = {
  name: string
  query: (client: ReturnType<typeof useSDK>["client"]) => Promise<{ data?: QuotaResult }>
}

const quotaResultCache = new Map<string, Extract<QuotaResult, { ok: true }>>()

export const quotaProviders: Record<string, QuotaProvider> = {
  opencode: {
    name: "OpenCode Zen",
    query: async (client) => {
      const response = await client.provider.opencode.usage()
      if (!response.data) return { data: { ok: false, error: "network" } }
      if (!response.data.ok) return { data: response.data }
      return {
        data: {
          ok: true,
          usage: {
            windows: [
              { id: "rolling", ...response.data.usage.rolling },
              { id: "weekly", ...response.data.usage.weekly },
              { id: "monthly", ...response.data.usage.monthly },
            ],
          },
        },
      }
    },
  },
  "opencode-go": {
    name: "OpenCode Go",
    query: async (client) => {
      const response = await client.provider.opencodeGo.usage()
      if (!response.data) return { data: { ok: false, error: "network" } }
      if (!response.data.ok) return { data: response.data }
      return {
        data: {
          ok: true,
          usage: {
            windows: [
              { id: "rolling", ...response.data.usage.rolling },
              { id: "weekly", ...response.data.usage.weekly },
              { id: "monthly", ...response.data.usage.monthly },
            ],
          },
        },
      }
    },
  },
  minimax: {
    name: "MiniMax Token Plan",
    query: (client) => client.provider.minimax.usage(),
  },
  "minimax-cn-coding-plan": {
    name: "MiniMax Token Plan",
    query: (client) => client.provider.minimax.usage(),
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

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds))
  const days = Math.floor(value / 86_400)
  const hours = Math.floor((value % 86_400) / 3_600)
  const minutes = Math.floor((value % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function QuotaRow(props: { quota: QuotaWindow; locale: string; label: (id: string) => string; resetLabel: (time: string) => string; updated: boolean }) {
  const language = useLanguage()
  const usedPercent = () => Math.min(100, Math.max(0, props.quota.usedPercent ?? props.quota.percent))
  const remainingPercent = () => Math.min(100, Math.max(0, props.quota.remainingPercent ?? 100 - usedPercent()))
  const status = () => props.quota.status === "rate-limited" ? "provider.quota.status.rateLimited" : "provider.quota.status.ok"
  const details = () => {
    const unit = props.quota.unit === "requests"
      ? ` ${language.t("provider.quota.unit.requests")}`
      : props.quota.unit === "tokens"
        ? ` ${language.t("provider.quota.unit.tokens")}`
        : ""
    const values = []
    if (props.quota.remaining !== undefined) {
      values.push(`${language.t("provider.quota.remaining")}: ${formatNumber(props.quota.remaining, props.locale)}${props.quota.total !== undefined ? ` / ${formatNumber(props.quota.total, props.locale)}` : ""}${unit}`)
    }
    if (props.quota.used !== undefined) {
      values.push(`${language.t("provider.quota.used")}: ${formatNumber(props.quota.used, props.locale)}${props.quota.total !== undefined ? ` / ${formatNumber(props.quota.total, props.locale)}` : ""}${unit}`)
    }
    if (props.quota.total !== undefined && props.quota.remaining === undefined && props.quota.used === undefined) {
      values.push(`${language.t("provider.quota.total")}: ${formatNumber(props.quota.total, props.locale)}${unit}`)
    }
    return values.length ? values.join(" · ") : undefined
  }
  return (
    <div classList={{ "flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0": true, "provider-quota-updated": props.updated }} data-component="provider-quota-window">
      <div class="flex items-center justify-between gap-3 text-12-medium">
        <span class="text-text-strong">{props.label(props.quota.id)}</span>
        <span class={props.quota.status === "rate-limited" ? "text-status-warning" : "text-status-success"}>
          {language.t("provider.quota.percent", { used: usedPercent().toFixed(0), remaining: remainingPercent().toFixed(0) })} · {language.t(status() as never)}
        </span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-sm bg-surface-base" aria-label={`${props.label(props.quota.id)}: ${usedPercent().toFixed(0)}%`}>
        <div class={props.quota.status === "rate-limited" ? "h-full bg-status-warning transition-[width] duration-[var(--motion-content-ms)] ease-[var(--motion-ease-out)]" : "h-full bg-status-success transition-[width] duration-[var(--motion-content-ms)] ease-[var(--motion-ease-out)]"} style={{ width: `${usedPercent()}%` }} />
      </div>
      <Show when={details()}>
        {(value) => <span class="text-11-regular text-text-weak">{value()}</span>}
      </Show>
      <span class="text-11-regular text-text-weak truncate">
        {props.resetLabel(resetTime(props.quota.resetsAt, props.locale))}
        {(() => {
          const seconds = props.quota.resetInSeconds ?? resetSeconds(props.quota.resetsAt)
          return seconds === undefined ? null : <> · {language.t("provider.quota.resetsIn", { time: formatDuration(seconds) })}</>
        })()}
      </span>
    </div>
  )
}

function resetSeconds(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000))
}

function ProviderQuotaCard(props: { providerID: string; refresh: Accessor<number>; onConfigure?: () => void }) {
  const language = useLanguage()
  const sdk = useSDK()
  const [result, setResult] = createSignal<QuotaResult | undefined>(quotaResultCache.get(props.providerID))
  const [loading, setLoading] = createSignal(!quotaResultCache.has(props.providerID))
  const [updated, setUpdated] = createSignal(false)
  const [refreshError, setRefreshError] = createSignal<string>()
  const provider = () => quotaProviders[props.providerID]!
  const usage = () => {
    const value = result()
    if (!value?.ok) return
    return value.usage
  }
  const label = (id: string) => {
    const [, period] = id.includes(":") ? id.split(":", 2) : [undefined, id]
    const translated = language.t(`provider.quota.window.${period}` as never)
    return translated
  }
  const error = () => {
    const value = result()
    if (!value || value.ok) return
    return language.t(`provider.quota.error.${value.error}` as never)
  }
  const missingApiKey = () => {
    const value = result()
    return value?.ok === false && value.error === "missing_api_key"
  }
  const visibleWindows = (windows: QuotaWindow[]) => windows.filter((quota) => quota.modelName !== "video" && !quota.id.startsWith("video:"))

  createEffect(() => {
    props.refresh()
    setLoading(!quotaResultCache.has(props.providerID))
    void (async (): Promise<QuotaResult> => {
      try {
        const response = await provider().query(sdk.client)
        return response.data ?? { ok: false, error: "network" }
      } catch {
        return { ok: false, error: "network" }
      }
    })().then((next) => {
      if (next.ok) {
        setRefreshError(undefined)
        const changed = JSON.stringify(quotaResultCache.get(props.providerID)) !== JSON.stringify(next)
        quotaResultCache.set(props.providerID, next)
        setResult(next)
        if (changed) {
          setUpdated(true)
          window.setTimeout(() => setUpdated(false), 420)
        }
        return
      }
      setRefreshError(next.error)
      if (!quotaResultCache.has(props.providerID)) setResult(next)
    }).finally(() => setLoading(false))
  })

  return (
    <div class="flex min-h-24 flex-col gap-3" data-component="provider-quota-card" data-provider-id={props.providerID}>
      <Show when={loading()}>
        <span class="text-12-regular text-text-weak">{language.t("provider.quota.loading")}</span>
      </Show>
      <Show when={refreshError() && quotaResultCache.has(props.providerID)}>
        <span class="text-11-regular text-status-warning">刷新失败，仍显示上次结果</span>
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
        {(value) => <div class="divide-y divide-border-weak-base"><For each={visibleWindows(value().windows)}>{(quota) => <QuotaRow quota={quota} updated={updated()} locale={language.intl()} label={label} resetLabel={(time) => language.t("provider.quota.resetsAt", { time })} />}</For></div>}
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
        <Tooltip placement="top" value={language.t("provider.quota.refresh")}>
          <IconButton icon="reset" variant="ghost" size="small" aria-label={language.t("provider.quota.refresh")} onClick={() => setRefresh((value) => value + 1)} />
        </Tooltip>
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
          aria-label={language.t("provider.quota.view")}
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="usage" size="normal" />
        </button>
        <Show when={open() && providerID()} keyed>
          {(id) => (
            <Portal mount={document.body}>
              <div ref={content} data-component="popover-content" data-provider-id={id} role="dialog" class="fixed bottom-16 left-24 w-[320px] max-w-[calc(100vw-32px)] rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-lg" style={{ "z-index": "2147483647" }}>
                <div class="flex items-center justify-between border-b border-border-weak-base px-3 py-2">
                  <span class="text-14-medium text-text-strong">{language.t("provider.quota.title")}</span>
                  <IconButton icon="close" variant="ghost" size="small" aria-label={language.t("ui.common.close")} onClick={() => setOpen(false)} />
                </div>
                <div class="p-3"><ProviderQuotaCardContent providerID={id} providerName={providerName() ?? ""} onConfigure={props.onConfigure} /></div>
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
  if (!quotaProviderIDs.has(props.providerID)) return
  return (
    <Button size="small" variant="secondary" icon="settings-gear" data-action={`settings-provider-quota-config-${props.providerID}`} onClick={props.onConfigure}>
      {props.configured ? "管理用量" : language.t("provider.quota.configure")}
    </Button>
  )
}
