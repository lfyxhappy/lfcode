import { type Component, type JSX, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@lfcode-ai/ui/button"
import { Switch } from "@lfcode-ai/ui/switch"
import { showToast } from "@lfcode-ai/ui/toast"
import QRCode from "qrcode"
import type { LanAccessDevice, LanAccessStatus, LanBrowserPairing } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { startVisiblePolling } from "@/utils/visible-poll"

export const lanAccessPairingState = (pairing: LanBrowserPairing | undefined, now: number) => {
  if (!pairing) return "empty"
  return pairing.expiresAt > now ? "active" : "expired"
}

export const SettingsLanAccess: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [status, setStatus] = createSignal<LanAccessStatus>({ enabled: false })
  const [devices, setDevices] = createSignal<LanAccessDevice[]>([])
  const [pairing, setPairing] = createSignal<LanBrowserPairing>()
  const [pairingQRCode, setPairingQRCode] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [now, setNow] = createSignal(Date.now())
  const desktop = createMemo(() => platform.platform === "desktop" && Boolean(platform.getLanAccessStatus))
  const endpoint = createMemo(() => (status().certificateStale ? status().pendingEndpoints : status().endpoints)?.[0])
  const pairingState = createMemo(() => lanAccessPairingState(pairing(), now()))
  const activeDevices = createMemo(() => devices().filter((device) => !device.revokedAt))

  const refresh = async () => {
    if (!platform.getLanAccessStatus) return
    setError(undefined)
    try {
      const next = await platform.getLanAccessStatus()
      setStatus(next)
      setDevices(next.enabled && platform.listLanDevices ? await platform.listLanDevices() : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  onMount(() => {
    void refresh()
    const stopPolling = startVisiblePolling(() => {
      setNow(Date.now())
    }, 1_000, { immediate: false })
    onCleanup(stopPolling)
  })

  const toggle = async (enabled: boolean) => {
    const action = enabled ? platform.enableLanAccess : platform.disableLanAccess
    if (!action || busy()) return
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await action())
      if (!enabled) {
        setPairing(undefined)
        setPairingQRCode(undefined)
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (value: string, toast: string) => {
    try {
      await navigator.clipboard.writeText(value)
      showToast({ variant: "success", title: toast })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const createPairing = async () => {
    if (!platform.createLanBrowserPairing || busy() || !status().enabled) return
    setBusy(true)
    setError(undefined)
    try {
      const next = await platform.createLanBrowserPairing()
      const url = new URL(next.url)
      const route = window.location.hash.startsWith("#/")
        ? window.location.hash.slice(1)
        : `${window.location.pathname}${window.location.search}${window.location.hash}`
      if (route.startsWith("/") && !route.startsWith("//") && /\/session(?:\/|$)/.test(route)) {
        url.searchParams.set("return", route)
      }
      const paired = { ...next, url: url.toString() }
      setPairing(paired)
      setPairingQRCode(await QRCode.toDataURL(paired.url, { errorCorrectionLevel: "M", margin: 1, width: 256 }))
      setNow(Date.now())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (deviceID: string) => {
    if (!platform.revokeLanDevice || busy()) return
    setBusy(true)
    setError(undefined)
    try {
      await platform.revokeLanDevice(deviceID)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const resetCertificate = async () => {
    if (!platform.resetLanAccessCertificate || busy() || status().enabled) return
    setBusy(true)
    setError(undefined)
    try {
      await platform.resetLanAccessCertificate()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const applyNetworkChange = async () => {
    if (!platform.applyLanAccessNetworkChange || busy() || !status().certificateStale) return
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await platform.applyLanAccessNetworkChange())
      setPairing(undefined)
      setPairingQRCode(undefined)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="no-scrollbar h-full w-full overflow-y-auto bg-background-base px-4 pb-10 sm:px-10">
      <div class="mx-auto flex max-w-5xl flex-col gap-8 pt-6">
        <header class="flex flex-wrap items-start justify-between gap-4 border-b border-border-weaker-base pb-6">
          <div class="max-w-2xl">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.lanAccess.title")}</h2>
            <p class="mt-1 text-14-regular text-text-weak">{language.t("settings.lanAccess.description")}</p>
          </div>
          <div
            data-action="settings-lan-status"
            data-enabled={status().enabled ? "true" : "false"}
            class={`rounded-full px-3 py-1 text-12-medium ${status().enabled ? "bg-status-success/10 text-status-success" : "bg-surface-elevated text-text-weak"}`}
          >
            {status().enabled ? language.t("settings.lanAccess.status.running") : language.t("settings.lanAccess.status.stopped")}
          </div>
        </header>

        <Show when={desktop()} fallback={<Message variant="neutral">{language.t("settings.lanAccess.unavailable")}</Message>}>
          <Show when={status().certificateStale}>
            <Message variant="warning">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div><div class="text-14-medium">{language.t("settings.lanAccess.status.networkChanged")}</div><div class="mt-0.5 text-12-regular">{language.t("settings.lanAccess.status.networkChangedDescription")}</div></div>
                <Button size="small" data-action="settings-lan-apply-network-change" onClick={() => void applyNetworkChange()} disabled={busy()}>{language.t("settings.lanAccess.status.applyNetworkChange")}</Button>
              </div>
            </Message>
          </Show>

          <section class="overflow-hidden rounded-xl border border-border-weak-base bg-surface-base">
            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-border-weak-base px-5 py-4">
              <div><h3 class="text-14-medium text-text-strong">{language.t("settings.lanAccess.connection.title")}</h3><p class="mt-0.5 text-12-regular text-text-weak">{language.t("settings.lanAccess.connection.description")}</p></div>
              <div data-action="settings-lan-enabled"><Switch checked={status().enabled} onChange={(value) => void toggle(value)} disabled={busy()} hideLabel>{language.t("settings.lanAccess.enable.title")}</Switch></div>
            </div>
            <div class="grid divide-y divide-border-weak-base sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <Detail label={language.t("settings.lanAccess.address.title")} value={endpoint() ?? (status().enabled ? language.t("settings.lanAccess.address.empty") : language.t("settings.lanAccess.status.stopped"))} mono />
              <Detail label={language.t("settings.lanAccess.devices.active")} value={language.t("settings.lanAccess.devices.count", { count: activeDevices().length })} />
            </div>
          </section>

          <Show when={status().enabled}>
            <section class="flex flex-col gap-4">
              <div><h3 class="text-14-medium text-text-strong">{language.t("settings.lanAccess.browser.title")}</h3><p class="mt-1 text-12-regular text-text-weak">{language.t("settings.lanAccess.browser.description")}</p></div>
              <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div class="overflow-hidden rounded-xl border border-border-weak-base bg-surface-base">
                  <div class="border-b border-border-weak-base px-5 py-4">
                    <div class="flex flex-wrap items-start justify-between gap-3"><div><div class="text-14-medium text-text-strong">{language.t("settings.lanAccess.address.title")}</div><div class="mt-0.5 text-12-regular text-text-weak">{language.t("settings.lanAccess.address.description")}</div></div><Button size="small" variant="secondary" icon="copy" data-action="settings-lan-copy-address" onClick={() => endpoint() && void copy(endpoint()!, language.t("settings.lanAccess.browser.addressCopied"))} disabled={!endpoint()}>{language.t("settings.lanAccess.browser.copy")}</Button></div>
                    <code class="mt-3 block break-all rounded-md bg-surface-elevated px-3 py-2 text-12-regular text-text-strong">{endpoint() ?? language.t("settings.lanAccess.address.empty")}</code>
                  </div>
                  <div class="px-5 py-4" data-action="settings-lan-pairing">
                    <div class="flex flex-wrap items-start justify-between gap-3"><div><div class="text-14-medium text-text-strong">{language.t("settings.lanAccess.pairing.title")}</div><div class="mt-0.5 text-12-regular text-text-weak">{language.t("settings.lanAccess.pairing.description")}</div></div><Button size="small" data-action="settings-lan-create-pairing" onClick={() => void createPairing()} disabled={busy() || !platform.createLanBrowserPairing}>{pairingState() === "active" ? language.t("settings.lanAccess.pairing.refresh") : language.t("settings.lanAccess.pairing.create")}</Button></div>
                    <Show when={pairingState() === "active" && pairing()} fallback={<div class="mt-4 rounded-md border border-dashed border-border-weak-base px-3 py-3 text-12-regular text-text-weak">{pairingState() === "expired" ? language.t("settings.lanAccess.pairing.expired") : language.t("settings.lanAccess.pairing.empty")}</div>}>
                      {(value) => <div class="mt-4"><div class="flex flex-wrap items-center justify-between gap-2 text-12-regular text-text-weak"><span>{language.t("settings.lanAccess.pairing.expires", { time: new Date(value().expiresAt).toLocaleTimeString() })}</span><Button size="small" variant="ghost" icon="copy" data-action="settings-lan-copy-pairing" onClick={() => void copy(value().url, language.t("settings.lanAccess.pairing.copied"))}>{language.t("settings.lanAccess.pairing.copy")}</Button></div><code class="mt-2 block break-all rounded-md bg-surface-elevated px-3 py-2 text-[11px] text-text-strong">{value().url}</code></div>}
                    </Show>
                  </div>
                </div>
                <div class="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-border-weak-base bg-surface-base p-4 text-center">
                  <Show when={pairingQRCode()} fallback={<div class="max-w-[190px] text-12-regular text-text-weak">{language.t("settings.lanAccess.pairing.qrEmpty")}</div>}>
                    {(source) => <><img class="h-52 w-52 rounded-lg bg-white p-2 shadow-sm" src={source()} alt={language.t("settings.lanAccess.pairing.qrAlt")} /><span class="mt-3 text-12-regular text-text-weak">{language.t("settings.lanAccess.pairing.qrHint")}</span></>}
                  </Show>
                </div>
              </div>
            </section>
          </Show>

          <section class="flex flex-col gap-4">
            <div><h3 class="text-14-medium text-text-strong">{language.t("settings.lanAccess.devices.title")}</h3><p class="mt-1 text-12-regular text-text-weak">{language.t("settings.lanAccess.devices.description")}</p></div>
            <div class="overflow-hidden rounded-xl border border-border-weak-base bg-surface-base">
              <Show when={devices().length} fallback={<div class="px-5 py-8 text-center text-12-regular text-text-weak">{language.t("settings.lanAccess.devices.empty")}</div>}>
                <For each={devices()}>{(device) => <div class="flex flex-wrap items-center gap-3 border-b border-border-weak-base px-5 py-4 last:border-none sm:flex-nowrap"><div class="min-w-0 flex-1"><div class="flex items-center gap-2"><span class="truncate text-14-medium text-text-strong">{device.name}</span><span class={`rounded-full px-2 py-0.5 text-[11px] font-medium ${device.revokedAt ? "bg-surface-elevated text-text-weak" : "bg-status-success/10 text-status-success"}`}>{device.revokedAt ? language.t("settings.lanAccess.devices.revoked") : language.t("settings.lanAccess.devices.active")}</span></div><div class="mt-1 text-12-regular text-text-weak">{language.t("settings.lanAccess.devices.lastSeen", { time: new Date(device.lastSeenAt).toLocaleString() })}</div></div><Show when={!device.revokedAt}><Button size="small" variant="secondary" data-action={`settings-lan-revoke-${device.id}`} onClick={() => void revoke(device.id)} disabled={busy()}>{language.t("settings.lanAccess.devices.revoke")}</Button></Show></div>}</For>
              </Show>
            </div>
          </section>

          <section class="overflow-hidden rounded-xl border border-border-weak-base bg-surface-base"><div class="flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div><h3 class="text-14-medium text-text-strong">{language.t("settings.lanAccess.certificate.title")}</h3><p class="mt-0.5 text-12-regular text-text-weak">{language.t("settings.lanAccess.firewall")}</p></div><Button size="small" variant="secondary" data-action="settings-lan-reset-certificate" onClick={() => void resetCertificate()} disabled={busy() || status().enabled}>{language.t("settings.lanAccess.certificate.reset")}</Button></div><div class="border-t border-border-weak-base px-5 py-3"><code class="block break-all text-[11px] text-text-weak">{status().spkiSha256 ?? "-"}</code></div></section>
          <Show when={error()}>{(value) => <Message variant="error">{value()}</Message>}</Show>
        </Show>
      </div>
    </div>
  )
}

const Detail: Component<{ label: string; value: string; mono?: boolean }> = (props) => <div class="min-w-0 px-5 py-4"><div class="text-12-regular text-text-weak">{props.label}</div><div class={`mt-1 break-all text-14-medium text-text-strong ${props.mono ? "font-mono text-[12px]" : ""}`}>{props.value}</div></div>
const Message: Component<{ variant: "error" | "warning" | "neutral"; children: JSX.Element }> = (props) => <div class={`rounded-xl border px-4 py-3 ${props.variant === "error" ? "border-status-error bg-status-error/5 text-status-error" : props.variant === "warning" ? "border-status-warning bg-status-warning/5 text-status-warning" : "border-border-weak-base bg-surface-base text-text-weak"}`}>{props.children}</div>
