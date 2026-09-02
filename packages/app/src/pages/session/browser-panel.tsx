import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { TextField } from "@lfcode-ai/ui/text-field"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { showToast } from "@lfcode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useFile } from "@/context/file"
import {
  BROWSER_COMMAND_EVENT,
  browserTabID,
  createBrowserRequestID,
  normalizeBrowserURL,
} from "@/pages/session/helpers"
import { usePlatform } from "@/context/platform"

export function BrowserPanel(props: { tab: string; visible?: boolean; sessionKey: string }) {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const file = useFile()
  const currentSessionKey = createMemo(() => props.sessionKey)
  const currentSessionID = createMemo(() => {
    const key = props.sessionKey
    const slash = key.indexOf("/")
    if (slash < 0) return undefined
    const sessionID = key.slice(slash + 1)
    return sessionID || undefined
  })
  const sessionView = createMemo(() => layout.view(currentSessionKey))
  let webviewRef: any
  let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined
  let lastLoadedURL = ""
  let ready = false
  let registeredGuestID: number | undefined
  let pendingGuestID: number | undefined
  let registeredGuestBinding: string | undefined
  let pendingGuestBinding: string | undefined
  let lastReportedBrowserState = ""
  let browserReportFrame: number | undefined
  let browserReportTimer: number | undefined
  let pendingBrowserReport: Parameters<NonNullable<typeof platform.reportBrowserState>>[0] | undefined
  const [windowID, setWindowID] = createSignal<number | null>(null)
  const [siteDataBusy, setSiteDataBusy] = createSignal(false)
  const [guestReady, setGuestReady] = createSignal(false)
  const [addressDraft, setAddressDraft] = createSignal<string>()
  const [webview, setWebview] = createSignal<any>()
  const visible = createMemo(() => props.visible !== false)
  let guestBindingKey: string | undefined

  const flushBrowserReport = () => {
    browserReportTimer = undefined
    const report = pendingBrowserReport
    pendingBrowserReport = undefined
    if (!report || !platform.reportBrowserState) return
    void platform.reportBrowserState(report)
  }

  const reportBrowserState = (
    report: Parameters<NonNullable<typeof platform.reportBrowserState>>[0],
    immediate = false,
  ) => {
    const signature = JSON.stringify(report)
    if (signature === lastReportedBrowserState) return
    lastReportedBrowserState = signature
    if (immediate) {
      pendingBrowserReport = undefined
      if (browserReportFrame !== undefined) cancelAnimationFrame(browserReportFrame)
      browserReportFrame = undefined
      if (browserReportTimer !== undefined) window.clearTimeout(browserReportTimer)
      browserReportTimer = undefined
      void platform.reportBrowserState?.(report)
      return
    }
    pendingBrowserReport = report
    if (browserReportFrame === undefined) {
      browserReportFrame = requestAnimationFrame(() => {
        browserReportFrame = undefined
        if (browserReportTimer === undefined) browserReportTimer = window.setTimeout(flushBrowserReport, 80)
      })
    }
  }

  onCleanup(() => {
    if (browserReportFrame !== undefined) cancelAnimationFrame(browserReportFrame)
    if (browserReportTimer !== undefined) window.clearTimeout(browserReportTimer)
    browserReportFrame = undefined
    browserReportTimer = undefined
    pendingBrowserReport = undefined
  })

  const guestElementAttached = (guest = webview()) => !!guest?.isConnected && !!guest.ownerDocument?.contains(guest)

  const tabID = createMemo(() => browserTabID(props.tab))
  const browser = createMemo(() => {
    const id = tabID()
    if (!id) return
    return sessionView().browser.get(id)
  })
  const state = () => {
    const id = tabID()
    if (!id) return
    return browser()
  }
  const focusAddress = () => {
    inputRef?.focus()
    inputRef?.select?.()
  }
  const resetGuestBeforeDispose = () => {
    const current = webview()
    if (!current) return
    try {
      current.stop?.()
    } catch {}
    try {
      if (current.getURL?.() && current.getURL?.() !== "about:blank") {
        current.loadURL?.("about:blank")
      }
    } catch {}
  }
  const desktopTarget = createMemo(() => {
    if (platform.platform !== "desktop") return
    const id = tabID()
    const sourceWindowID = windowID()
    if (!id || sourceWindowID === null) return
    return {
      sourceWindowID,
      tabID: id,
      sessionKey: currentSessionKey(),
      sessionID: currentSessionID(),
    }
  })

  const syncActiveBrowserTab = () => {
    const target = desktopTarget()
    if (!target || !platform.setActiveBrowserTab) return
    if (!visible()) return
    void platform.setActiveBrowserTab({
      ...target,
      active: true,
    })
  }

  const browserGuestBinding = (input: {
    sourceWindowID: number
    tabID: string
    sessionKey?: string
    sessionID?: string
    guestID: number
  }) => `${input.sourceWindowID}:${input.tabID}:${input.sessionKey ?? ""}:${input.sessionID ?? ""}:${input.guestID}`

  const ensureGuestRegistration = () => {
    const target = desktopTarget()
    const guestID = resolveGuestID()
    if (!target || typeof guestID !== "number" || guestID <= 0) return
    const binding = browserGuestBinding({
      ...target,
      guestID,
    })
    if (!platform.registerBrowserGuest) {
      registeredGuestID = guestID
      pendingGuestID = undefined
      registeredGuestBinding = binding
      pendingGuestBinding = undefined
      setGuestReady(true)
      return
    }
    if (registeredGuestBinding === binding) {
      pendingGuestID = undefined
      pendingGuestBinding = undefined
      setGuestReady(true)
      return
    }
    if (pendingGuestBinding === binding) return

    pendingGuestID = guestID
    pendingGuestBinding = binding
    setGuestReady(false)
    void platform
      .registerBrowserGuest({
        ...target,
        guestID,
      })
      .then(() => {
        if (pendingGuestBinding !== binding) return
        registeredGuestID = guestID
        registeredGuestBinding = binding
        pendingGuestID = undefined
        pendingGuestBinding = undefined
        setGuestReady(true)
        reportGuestReady()
      })
      .catch(() => {
        if (pendingGuestBinding !== binding) return
        pendingGuestID = undefined
        pendingGuestBinding = undefined
        registeredGuestID = undefined
        registeredGuestBinding = undefined
        setGuestReady(false)
      })
  }

  const reportGuestReady = () => {
    const target = desktopTarget()
    const guestID = resolveGuestID()
    if (!target || typeof guestID !== "number" || guestID <= 0 || !platform.markBrowserGuestReady) return
    void platform.markBrowserGuestReady({
      ...target,
      guestID,
    }).catch(() => {})
  }

  const resolveGuestID = () => {
    try {
      return webviewRef?.getWebContentsId?.()
    } catch {
      return
    }
  }

  onMount(() => {
    if (!platform.getWindowID) return
    void platform.getWindowID().then(setWindowID).catch(() => setWindowID(null))
  })

  onCleanup(() => {
    const target = desktopTarget()
    const currentGuestID = resolveGuestID()
    if (
      target &&
      platform.unregisterBrowserGuest &&
      registeredGuestID !== undefined &&
      currentGuestID === registeredGuestID
    ) {
      void platform.unregisterBrowserGuest({
        ...target,
        guestID: registeredGuestID,
      })
    }
    pendingGuestID = undefined
    registeredGuestID = undefined
    pendingGuestBinding = undefined
    registeredGuestBinding = undefined
    setGuestReady(false)
    ready = false
    lastReportedBrowserState = ""
  })

  const runCommand = (command: "back" | "forward" | "reload" | "stop" | "focusAddress") => {
    const id = tabID()
    const current = state()
    const webview = webviewRef
    if (!id || !current) return
    if (command === "focusAddress") {
      focusAddress()
      return
    }
    if (command === "stop") {
      sessionView().browser.update(id, {
        loading: false,
      })
      if (!webview) return
      webview.stop?.()
      return
    }
    if (command === "back") {
      sessionView().browser.goBack(id)
      webview?.goBack?.()
      return
    }
    if (command === "forward") {
      sessionView().browser.goForward(id)
      webview?.goForward?.()
      return
    }
    sessionView().browser.refresh(id)
    if (!webview) return
    webview.reload?.()
  }

  const submit = (value: string) => {
    const id = tabID()
    if (!id) return
    const next = normalizeBrowserURL(value)
    if (!next) {
      showToast({
        title: language.t("toast.browser.invalidUrl.title"),
        description: language.t("toast.browser.invalidUrl.description"),
        variant: "error",
      })
      return
    }
    sessionView().browser.open(id, next)
  }

  createEffect(() => {
    const current = state()
    const guest = webview()
    if (!current || !guest) return
    if (!guestElementAttached(guest)) return
    if (!ready) {
      lastLoadedURL = current.url
      return
    }
    if (lastLoadedURL === current.url) return
    lastLoadedURL = current.url
    guest.loadURL?.(current.url)
  })

  createEffect(
    on([tabID, webview], ([id, guest]) => {
      if (!id || !guest) return
      const guestID = resolveGuestID()
      const bindingKey = `${id}:${typeof guestID === "number" ? guestID : "pending"}`
      if (guestBindingKey === bindingKey) return
      guestBindingKey = bindingKey

      const eventURL = (event?: Event) => {
        const value = (event as { url?: string } | undefined)?.url
        if (typeof value !== "string" || value.length === 0) return
        return value
      }

      const isMainFrameEvent = (event?: Event) => {
        const value = (event as { isMainFrame?: boolean } | undefined)?.isMainFrame
        return value !== false
      }

      const resolveStableURL = (event?: Event) => {
        const current = state()
        const fromEvent = eventURL(event)
        const fromGuest = ready && guestElementAttached(guest) ? guest.getURL?.() : undefined
        const next = fromEvent || fromGuest || current?.url || ""
        if (!next) return current?.url || ""
        if (next !== "about:blank") return next
        if (current?.url && current.url !== "about:blank") return current.url
        return next
      }

      const sync = (
        input?:
          | {
              loading?: boolean
              error?: string
              clearError?: boolean
              event?: Event
            }
          | Event,
      ) => {
        const options =
          input instanceof Event
            ? {
                event: input,
              }
            : input
        const current = state()
        const url = resolveStableURL(options?.event)
        if (url) lastLoadedURL = url
        const next = {
          url,
          input: options?.loading ? current?.input ?? url : url,
          title: ready && guestElementAttached(guest) ? guest.getTitle?.() || current?.title : current?.title,
          loading: options?.loading ?? current?.loading ?? false,
          error: options?.clearError ? undefined : options?.error ?? current?.error,
        }
        sessionView().browser.sync(id, next)
        const report = {
          sessionKey: currentSessionKey(),
          tabID: id,
          ...next,
        }
        reportBrowserState(report, options?.loading !== undefined || options?.error !== undefined)
      }

      const start = () => {
        sessionView().browser.update(id, {
          loading: true,
          error: undefined,
        })
        const report = {
          sessionKey: currentSessionKey(),
          tabID: id,
          loading: true,
        }
        reportBrowserState(report, true)
        ensureGuestRegistration()
      }

      const fail = (event?: Event) => {
        lastLoadedURL = ""
        const details = event as ({ errorCode?: number; errorDescription?: string } & Event) | undefined
        const code = typeof details?.errorCode === "number" ? details.errorCode : undefined
        const description = typeof details?.errorDescription === "string" ? details.errorDescription : undefined
        sync({
          loading: false,
          error: description ?? (code !== undefined ? `Failed to load (${code})` : "Failed to load"),
        })
      }

      const openWindow = (event: Event) => {
        if (platform.platform === "desktop") {
          ;(event as { preventDefault?: () => void }).preventDefault?.()
          return
        }
        ;(event as { preventDefault?: () => void }).preventDefault?.()
        const next = (event as { url?: string; detail?: { url?: string } }).url ?? (event as CustomEvent<{ url?: string }>).detail?.url
        if (!next) return
        window.dispatchEvent(
          new CustomEvent("lfcode:browser-request-open", {
            detail: {
              requestID: createBrowserRequestID(),
              url: next,
              sessionKey: currentSessionKey(),
              sessionID: currentSessionID(),
              reason: "human" as const,
            },
            cancelable: true,
          }),
        )
      }

      const onReady = () => {
        ready = true
        ensureGuestRegistration()
        reportGuestReady()
        syncActiveBrowserTab()
        sync({
          loading: guest.isLoading?.() ? true : false,
          clearError: true,
        })
      }
      const finish = () => {
        sync({
          loading: false,
          clearError: true,
        })
      }
      const syncNavigation = (event?: Event) => {
        if (!isMainFrameEvent(event)) return
        const next = eventURL(event)
        sessionView().browser.update(id, {
          input: next && next !== "about:blank" ? next : state()?.input,
          loading: true,
          error: undefined,
        })
        const report = {
          sessionKey: currentSessionKey(),
          tabID: id,
          input: next && next !== "about:blank" ? next : state()?.input,
          loading: true,
        }
        reportBrowserState(report, true)
      }
      const finishMainNavigation = (event?: Event) => {
        sync({
          event,
          loading: false,
          clearError: true,
        })
      }
      const finishInPageNavigation = (event?: Event) => {
        if (!isMainFrameEvent(event)) return
        if (guest.isLoading?.()) return
        const next = eventURL(event)
        if (!next || next === "about:blank") return
        sync({
          event,
          loading: false,
          clearError: true,
        })
      }
      const onTitleUpdated = () => {
        const current = state()
        sessionView().browser.update(id, {
          title: ready && guestElementAttached(guest) ? guest.getTitle?.() || current?.title : current?.title,
        })
        reportBrowserState({
          sessionKey: currentSessionKey(),
          tabID: id,
          title: ready && guestElementAttached(guest) ? guest.getTitle?.() || current?.title : current?.title,
        })
      }
      const onCommand = (event: Event) => {
        const detail = (event as CustomEvent<{ command?: "back" | "forward" | "reload" | "stop" | "focusAddress"; tabID?: string }>).detail
        if (detail?.tabID !== id) return
        if (!detail.command) return
        runCommand(detail.command)
      }
      const hydrateGuestState = () => {
        if (!guestElementAttached(guest)) return
        // A cached webview can finish loading before this reactive listener attaches.
        // Reuse the DOM-ready synchronization path so persisted loading state converges.
        if (!ready) onReady()
        if (guest.isLoading?.()) {
          start()
          return
        }
        finish()
      }
      let guestProbeFrame = 0
      const probeGuestRegistration = (attempt = 0) => {
        if (!guestElementAttached(guest)) {
          if (attempt >= 12) return
          guestProbeFrame = requestAnimationFrame(() => probeGuestRegistration(attempt + 1))
          return
        }
        ensureGuestRegistration()
        const currentGuestID = resolveGuestID()
        if (!desktopTarget() || attempt >= 12) return
        if (
          typeof currentGuestID === "number" &&
          currentGuestID > 0 &&
          (registeredGuestID === currentGuestID || pendingGuestID === currentGuestID)
        ) {
          return
        }
        guestProbeFrame = requestAnimationFrame(() => probeGuestRegistration(attempt + 1))
      }

      guest.addEventListener("did-start-loading", start)
      guest.addEventListener("did-finish-load", finish)
      guest.addEventListener("did-stop-loading", finish)
      guest.addEventListener("did-start-navigation", syncNavigation)
      guest.addEventListener("did-redirect-navigation", syncNavigation)
      guest.addEventListener("did-navigate", finishMainNavigation)
      guest.addEventListener("did-navigate-in-page", finishInPageNavigation)
      guest.addEventListener("page-title-updated", onTitleUpdated)
      guest.addEventListener("did-fail-load", fail)
      guest.addEventListener("dom-ready", onReady)
      guest.addEventListener("new-window", openWindow)
      window.addEventListener(BROWSER_COMMAND_EVENT, onCommand)
      requestAnimationFrame(hydrateGuestState)
      probeGuestRegistration()

      onCleanup(() => {
        if (guestProbeFrame) cancelAnimationFrame(guestProbeFrame)
        ready = false
        guest.removeEventListener("did-start-loading", start)
        guest.removeEventListener("did-finish-load", finish)
        guest.removeEventListener("did-stop-loading", finish)
        guest.removeEventListener("did-start-navigation", syncNavigation)
        guest.removeEventListener("did-redirect-navigation", syncNavigation)
        guest.removeEventListener("did-navigate", finishMainNavigation)
        guest.removeEventListener("did-navigate-in-page", finishInPageNavigation)
        guest.removeEventListener("page-title-updated", onTitleUpdated)
        guest.removeEventListener("did-fail-load", fail)
        guest.removeEventListener("dom-ready", onReady)
        guest.removeEventListener("new-window", openWindow)
        window.removeEventListener(BROWSER_COMMAND_EVENT, onCommand)
        if (guestBindingKey === bindingKey) guestBindingKey = undefined
      })
    }),
  )

  const copy = async () => {
    const current = state()
    if (!current) return
    await navigator.clipboard.writeText(current.url).catch(() => {})
  }

  const openExternal = () => {
    const current = state()
    if (!current) return
    if (platform.openExternalLink) {
      platform.openExternalLink(current.url)
      return
    }
    window.open(current.url, "_blank", "noopener,noreferrer")
  }

  const openDevTools = () => {
    const target = desktopTarget()
    if (!target || !platform.openBrowserDevTools || !guestReady()) return
    void platform.openBrowserDevTools(target).catch((error) => {
      showToast({
        title: "Failed to open browser DevTools",
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    })
  }

  const clearSiteData = () => {
    const target = desktopTarget()
    if (!target || !platform.clearBrowserSiteData || siteDataBusy() || !guestReady()) return
    setSiteDataBusy(true)
    void platform
      .clearBrowserSiteData(target)
      .then((result) => {
        showToast({
          title: "Site data cleared",
          description: result.clearedCookies > 0 ? `Removed ${result.clearedCookies} cookies for the current page.` : "Cleared storage for the current page.",
        })
        webviewRef?.reload?.()
      })
      .catch((error) => {
        showToast({
          title: "Failed to clear site data",
          description: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
      })
      .finally(() => {
        setSiteDataBusy(false)
      })
  }

  createEffect(() => {
    const target = desktopTarget()
    if (!target || !platform.setActiveBrowserTab) return
    ensureGuestRegistration()
    if (ready) reportGuestReady()
    if (!visible()) return
    syncActiveBrowserTab()
  })

  const currentFilePath = createMemo(() => {
    const current = state()
    if (!current) return
    if (!current.url.startsWith("file://")) return
    return file.normalize(current.url)
  })

  const openSource = () => {
    const current = currentFilePath()
    if (!current) return
    sessionView().reviewPanel.open()
    layout.fileTree.open()
    void file.load(current).then(() => {
      const tab = file.tab(current)
      layout.tabs(currentSessionKey).open(tab)
      layout.tabs(currentSessionKey).setActive(tab)
    })
  }

  return (
    <div class="size-full flex flex-col min-h-0 bg-background-base">
      <div class="shrink-0 border-b border-border-weaker-base px-3 py-2 flex items-center gap-2">
        <div class="flex items-center gap-1">
          <Tooltip value={language.t("common.goBack")} placement="bottom">
            <IconButton
              icon="arrow-left"
              variant="ghost"
              class="size-7 rounded-md"
              disabled={!browser()?.canGoBack}
              onClick={() => {
                runCommand("back")
              }}
              aria-label={language.t("common.goBack")}
            />
          </Tooltip>
          <Tooltip value={language.t("common.goForward")} placement="bottom">
            <IconButton
              icon="arrow-right"
              variant="ghost"
              class="size-7 rounded-md"
              disabled={!browser()?.canGoForward}
              onClick={() => {
                runCommand("forward")
              }}
              aria-label={language.t("common.goForward")}
            />
          </Tooltip>
          <Tooltip value={browser()?.loading ? language.t("common.stop") : language.t("command.browser.reload")} placement="bottom">
            <IconButton
              icon={browser()?.loading ? "stop" : "reset"}
              variant="ghost"
              class="size-7 rounded-md"
              onClick={() => {
                if (browser()?.loading) {
                  runCommand("stop")
                  return
                }
                runCommand("reload")
              }}
              aria-label={browser()?.loading ? language.t("common.stop") : language.t("command.browser.reload")}
            />
          </Tooltip>
        </div>

        <form
          class="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit(addressDraft() ?? state()?.url ?? "")
            setAddressDraft(undefined)
          }}
        >
          <TextField
            ref={(el: HTMLInputElement) => {
              inputRef = el as HTMLInputElement
            }}
            name="url"
            value={addressDraft() ?? state()?.url ?? ""}
            onFocus={() => {
              setAddressDraft(state()?.url ?? "")
            }}
            onInput={(event) => {
              setAddressDraft(event.currentTarget.value)
            }}
            onBlur={() => {
              setAddressDraft(undefined)
            }}
            class="h-8 flex-1 min-w-0 rounded-md"
            placeholder={language.t("browser.address.placeholder")}
          />
        </form>

        <div class="flex items-center gap-1">
          <Show when={currentFilePath()}>
            <Tooltip value={language.t("browser.openSource")} placement="bottom">
              <IconButton
                icon="code"
                variant="ghost"
                class="size-7 rounded-md"
                onClick={openSource}
                aria-label={language.t("browser.openSource")}
              />
            </Tooltip>
          </Show>
          <Show when={platform.platform === "desktop" && platform.openBrowserDevTools}>
            <Tooltip value="Open page DevTools" placement="bottom">
              <IconButton
                icon="console"
                variant="ghost"
                class="size-7 rounded-md"
                disabled={!guestReady()}
                onClick={openDevTools}
                aria-label="Open page DevTools"
              />
            </Tooltip>
          </Show>
          <Show when={platform.platform === "desktop" && platform.clearBrowserSiteData}>
            <Tooltip value="Clear current site data" placement="bottom">
              <IconButton
                icon="trash"
                variant="ghost"
                class="size-7 rounded-md"
                disabled={siteDataBusy() || !guestReady()}
                onClick={clearSiteData}
                aria-label="Clear current site data"
              />
            </Tooltip>
          </Show>
          <Tooltip value={language.t("session.header.open.copyPath")} placement="bottom">
            <IconButton icon="copy" variant="ghost" class="size-7 rounded-md" onClick={copy} aria-label={language.t("session.header.open.copyPath")} />
          </Tooltip>
          <Tooltip value={language.t("session.header.open.menu")} placement="bottom">
            <IconButton
              icon="open-file"
              variant="ghost"
              class="size-7 rounded-md"
              onClick={openExternal}
              aria-label={language.t("session.header.open.menu")}
            />
          </Tooltip>
          <Tooltip value={language.t("common.closeTab")} placement="bottom">
            <IconButton
              icon="close-small"
              variant="ghost"
              class="size-7 rounded-md"
              onClick={() => {
                const id = tabID()
                if (!id) return
                resetGuestBeforeDispose()
                sessionView().browser.close(id)
                layout.tabs(currentSessionKey).close(props.tab)
                reportBrowserState({
                  sessionKey: currentSessionKey(),
                  tabID: id,
                  closed: true,
                }, true)
              }}
              aria-label={language.t("common.closeTab")}
            />
          </Tooltip>
        </div>
      </div>

      <div class="relative flex-1 min-h-0 overflow-hidden">
        <Show
          when={browser()}
          fallback={<div class="size-full flex items-center justify-center text-12-regular text-text-weak">{language.t("common.loading")}</div>}
        >
          {(current) => (
            <div class="relative size-full overflow-hidden">
              <webview
                ref={(el) => {
                  webviewRef = el
                  setWebview(el)
                }}
                src={current().url}
                class="size-full overflow-hidden bg-background-base"
                partition="persist:lfcode-browser"
                allowpopups
              />
              <Show when={current().loading}>
                <div class="pointer-events-none absolute left-3 top-3 rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 py-1 text-12-regular text-text-weak shadow-sm">
                  {language.t("browser.loading")}
                </div>
              </Show>
              <Show when={current().error}>
                <div class="absolute inset-0 flex items-center justify-center bg-background-base px-6 text-center">
                  <div class="max-w-96 rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-4 py-3 shadow-sm space-y-2">
                    <div class="text-13-medium text-text-base">{language.t("browser.error.title")}</div>
                    <div class="text-12-regular text-text-weak break-words">{current().error}</div>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
