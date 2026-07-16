import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { TextField } from "@lfcode-ai/ui/text-field"
import { Tooltip } from "@lfcode-ai/ui/tooltip"
import { showToast } from "@lfcode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useFile } from "@/context/file"
import { usePrompt } from "@/context/prompt"
import {
  BROWSER_COMMAND_EVENT,
  browserTabID,
  createBrowserRequestID,
  normalizeBrowserURL,
} from "@/pages/session/helpers"
import { usePlatform } from "@/context/platform"
import {
  appendBrowserReferenceToPrompt,
  type BrowserReferenceCandidate,
  type BrowserReferenceState,
} from "./browser-reference"

const BROWSER_REFERENCE_CHANNEL = "lfcode-browser-reference"

export function BrowserPanel(props: { tab: string; visible?: boolean; sessionKey: string }) {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const file = useFile()
  const prompt = usePrompt()
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
  let referenceOverlayRef: HTMLDivElement | undefined
  let referenceTextRef: HTMLDivElement | undefined
  let selectionActionRef: HTMLDivElement | undefined
  let elementActionRef: HTMLDivElement | undefined
  let lastLoadedURL = ""
  let ready = false
  let registeredGuestID: number | undefined
  let pendingGuestID: number | undefined
  let registeredGuestBinding: string | undefined
  let pendingGuestBinding: string | undefined
  let latestReferenceState: BrowserReferenceState = {}
  const [windowID, setWindowID] = createSignal<number | null>(null)
  const [siteDataBusy, setSiteDataBusy] = createSignal(false)
  const [guestReady, setGuestReady] = createSignal(false)
  const [addressDraft, setAddressDraft] = createSignal<string>()
  const [referenceState, setReferenceState] = createSignal<BrowserReferenceState>({})
  const [webview, setWebview] = createSignal<any>()
  const visible = createMemo(() => props.visible !== false)
  let guestBindingKey: string | undefined

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

  const appendWebReference = (candidate: BrowserReferenceCandidate | undefined) => {
    const next = appendBrowserReferenceToPrompt(prompt.current(), candidate)
    if (!next) return
    prompt.set(next.prompt, next.cursor)
    showToast({
      title: "已加入引用",
      description: candidate?.mode === "element" ? "当前网页元素已加入输入框。" : "当前网页选区已加入输入框。",
    })
  }

  const applyReferenceState = (next: BrowserReferenceState | undefined) => {
    latestReferenceState = next ?? {}
    setReferenceState(latestReferenceState)
    const overlay = referenceOverlayRef
    if (!overlay) return
    const selection = latestReferenceState.selection
    const element = latestReferenceState.element
    const visible = !!(selection || element)
    overlay.style.display = visible ? "" : "none"
    overlay.dataset.browserReferenceSelectionLabel = selection?.label ?? ""
    overlay.dataset.browserReferenceSelectionText = selection?.text ?? ""
    overlay.dataset.browserReferenceSelectionUrl = selection?.url ?? ""
    overlay.dataset.browserReferenceSelectionTitle = selection?.title ?? ""
    overlay.dataset.browserReferenceSelectionSelector = selection?.selector ?? ""
    overlay.dataset.browserReferenceSelectionMode = selection?.mode ?? ""
    overlay.dataset.browserReferenceElementLabel = element?.label ?? ""
    overlay.dataset.browserReferenceElementText = element?.text ?? ""
    overlay.dataset.browserReferenceElementUrl = element?.url ?? ""
    overlay.dataset.browserReferenceElementTitle = element?.title ?? ""
    overlay.dataset.browserReferenceElementSelector = element?.selector ?? ""
    overlay.dataset.browserReferenceElementMode = element?.mode ?? ""
    if (referenceTextRef) {
      referenceTextRef.textContent =
        selection?.text || element?.text || "选中文本或点击页面元素后，可直接加入当前输入框。"
    }
    if (selectionActionRef) {
      selectionActionRef.style.display = selection?.text ? "" : "none"
    }
    if (elementActionRef) {
      elementActionRef.style.display = element?.text ? "" : "none"
    }
  }

  const readReferenceStateFromGuest = async () => {
    const current = webview()
    if (!ready || !guestReady() || !guestElementAttached(current) || !current?.executeJavaScript) return
    let next: unknown
    try {
      next = await current.executeJavaScript(`(() => {
        const raw = document.documentElement?.dataset?.lfcodeBrowserReference
        if (!raw) return {}
        try {
          const parsed = JSON.parse(raw)
          return parsed && typeof parsed === "object" ? parsed : {}
        } catch {
          return {}
        }
      })()`)
    } catch {
      return
    }
    if (!next || typeof next !== "object") return
    return next as BrowserReferenceState
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
        sessionView().browser.sync(id, {
          url,
          input: options?.loading ? current?.input ?? url : url,
          title: ready && guestElementAttached(guest) ? guest.getTitle?.() || current?.title : current?.title,
          loading: options?.loading ?? current?.loading ?? false,
          error: options?.clearError ? undefined : options?.error ?? current?.error,
        })
      }

      const start = () => {
        setReferenceState({})
        applyReferenceState({})
        sessionView().browser.update(id, {
          loading: true,
          error: undefined,
        })
        ensureGuestRegistration()
      }

      const fail = (event?: Event) => {
        lastLoadedURL = ""
        applyReferenceState({})
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
      }
      const onIpcMessage = (event: Event) => {
        const detail = event as { channel?: string; args?: unknown[]; detail?: { channel?: string; args?: unknown[] } }
        const payload = detail.detail ?? detail
        if (payload.channel !== BROWSER_REFERENCE_CHANNEL) return
        const next = payload.args?.[0]
        if (!next || typeof next !== "object") {
          applyReferenceState({})
          return
        }
        applyReferenceState(next as BrowserReferenceState)
      }
      const onCommand = (event: Event) => {
        const detail = (event as CustomEvent<{ command?: "back" | "forward" | "reload" | "stop" | "focusAddress"; tabID?: string }>).detail
        if (detail?.tabID !== id) return
        if (!detail.command) return
        runCommand(detail.command)
      }
      const hydrateGuestState = () => {
        if (!guestElementAttached(guest)) return
        if (!ready) return
        if (guest.isLoading?.()) {
          start()
          return
        }
        finish()
        pollReferenceState()
      }
      let guestProbeFrame = 0
      let referencePollTimer: number | undefined
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
      const pollReferenceState = () => {
        if (!guestElementAttached(guest) || !ready || !guestReady() || !untrack(visible)) return
        void readReferenceStateFromGuest().then((next) => {
          if (next) {
            applyReferenceState(next)
            return
          }
          const target = desktopTarget()
          if (!target || !platform.getBrowserReferenceState) return
          void platform
            .getBrowserReferenceState(target)
            .then((fallback) => {
              if (!fallback || typeof fallback !== "object") return
              applyReferenceState(fallback as BrowserReferenceState)
            })
            .catch(() => {})
        })
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
      guest.addEventListener("ipc-message", onIpcMessage)
      guest.addEventListener("new-window", openWindow)
      window.addEventListener(BROWSER_COMMAND_EVENT, onCommand)
      requestAnimationFrame(hydrateGuestState)
      probeGuestRegistration()
      pollReferenceState()
      if (platform.getBrowserReferenceState) {
        referencePollTimer = window.setInterval(pollReferenceState, 400)
      }

      onCleanup(() => {
        if (guestProbeFrame) cancelAnimationFrame(guestProbeFrame)
        if (referencePollTimer !== undefined) clearInterval(referencePollTimer)
        ready = false
        applyReferenceState({})
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
        guest.removeEventListener("ipc-message", onIpcMessage)
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
                <div class="absolute inset-0 flex items-center justify-center px-6 text-center bg-background-base/70 backdrop-blur-[1px]">
                  <div class="max-w-96 rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-4 py-3 shadow-sm space-y-2">
                    <div class="text-13-medium text-text-base">{language.t("browser.error.title")}</div>
                    <div class="text-12-regular text-text-weak break-words">{current().error}</div>
                  </div>
                </div>
              </Show>
              <div
                ref={referenceOverlayRef}
                data-browser-reference-active="true"
                class="absolute right-3 top-3 z-10 max-w-[22rem] rounded-xl border border-border-weak-base bg-surface-raised-stronger-non-alpha/95 px-3 py-2 shadow-lg backdrop-blur"
                style={{ display: "none" }}
              >
                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">网页引用</div>
                <div ref={referenceTextRef} class="mt-1 text-12-regular text-text-weak line-clamp-2">
                  选中文本或点击页面元素后，可直接加入当前输入框。
                </div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <div ref={selectionActionRef} data-browser-reference-kind="selection" style={{ display: "none" }}>
                    <IconButton
                      icon="plus"
                      variant="secondary"
                      class="size-8 rounded-lg"
                      onClick={() => appendWebReference(latestReferenceState.selection)}
                      aria-label="加入网页选区引用"
                    />
                  </div>
                  <div ref={elementActionRef} data-browser-reference-kind="element" style={{ display: "none" }}>
                    <IconButton
                      icon="selector"
                      variant="secondary"
                      class="size-8 rounded-lg"
                      onClick={() => appendWebReference(latestReferenceState.element)}
                      aria-label="加入网页元素引用"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
