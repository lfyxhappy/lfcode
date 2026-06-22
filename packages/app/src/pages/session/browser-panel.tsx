import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
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
  normalizeBrowserURL,
} from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { usePlatform } from "@/context/platform"

export function BrowserPanel(props: { tab: string; visible?: boolean }) {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const file = useFile()
  const { sessionKey, view } = useSessionLayout()
  let webviewRef: any
  let inputRef: HTMLInputElement | HTMLTextAreaElement | undefined
  let lastLoadedURL = ""
  let ready = false
  let registeredGuestID: number | undefined
  let pendingGuestID: number | undefined
  const [windowID, setWindowID] = createSignal<number | null>(null)
  const [siteDataBusy, setSiteDataBusy] = createSignal(false)
  const [guestReady, setGuestReady] = createSignal(false)

  const tabID = createMemo(() => browserTabID(props.tab))
  const browser = createMemo(() => {
    const id = tabID()
    if (!id) return
    return view().browser.get(id)
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
  const desktopTarget = createMemo(() => {
    if (platform.platform !== "desktop") return
    const id = tabID()
    const sourceWindowID = windowID()
    if (!id || sourceWindowID === null) return
    return {
      sourceWindowID,
      tabID: id,
    }
  })

  const ensureGuestRegistration = () => {
    const target = desktopTarget()
    const guestID = resolveGuestID()
    if (!target || typeof guestID !== "number" || guestID <= 0) return
    if (!platform.registerBrowserGuest) {
      registeredGuestID = guestID
      pendingGuestID = undefined
      setGuestReady(true)
      return
    }
    if (registeredGuestID === guestID) {
      pendingGuestID = undefined
      setGuestReady(true)
      return
    }
    if (pendingGuestID === guestID) return

    pendingGuestID = guestID
    setGuestReady(false)
    void platform
      .registerBrowserGuest({
        ...target,
        guestID,
      })
      .then(() => {
        if (pendingGuestID !== guestID) return
        registeredGuestID = guestID
        pendingGuestID = undefined
        setGuestReady(true)
      })
      .catch(() => {
        if (pendingGuestID !== guestID) return
        pendingGuestID = undefined
        registeredGuestID = undefined
        setGuestReady(false)
      })
  }

  const resolveGuestID = () => {
    if (!ready) return
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
      layout.view(sessionKey()).browser.update(id, {
        loading: false,
      })
      if (!webview) return
      webview.stop?.()
      return
    }
    if (command === "back") {
      layout.view(sessionKey()).browser.goBack(id)
      return
    }
    if (command === "forward") {
      layout.view(sessionKey()).browser.goForward(id)
      return
    }
    layout.view(sessionKey()).browser.refresh(id)
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
    layout.view(sessionKey()).browser.open(id, next)
  }

  createEffect(() => {
    const current = state()
    const webview = webviewRef
    if (!current || !webview) return
    if (!ready) {
      lastLoadedURL = current.url
      return
    }
    if (lastLoadedURL === current.url) return
    lastLoadedURL = current.url
    webview.loadURL?.(current.url)
  })

  createEffect(() => {
    const id = tabID()
    const webview = webviewRef
    if (!id || !webview) return

    const sync = (input?: {
      loading?: boolean
      error?: string
      clearError?: boolean
    }) => {
      const current = state()
      const url = ready ? webview.getURL?.() || current?.url || "" : current?.url || ""
      if (url) lastLoadedURL = url
      layout.view(sessionKey()).browser.sync(id, {
        url,
        input: url,
        title: ready ? webview.getTitle?.() || current?.title : current?.title,
        loading: input?.loading ?? current?.loading ?? false,
        error: input?.clearError ? undefined : input?.error ?? current?.error,
      })
    }

    const start = () => {
      layout.view(sessionKey()).browser.update(id, {
        loading: true,
        error: undefined,
      })
      ensureGuestRegistration()
      if (ready) sync()
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
      if (platform.platform === "desktop") return
      const next = (event as { url?: string; detail?: { url?: string } }).url ?? (event as CustomEvent<{ url?: string }>).detail?.url
      if (!next) return
      window.dispatchEvent(new CustomEvent("lfcode:browser-request-open", { detail: { url: next }, cancelable: true }))
    }

    const onReady = () => {
      ready = true
      ensureGuestRegistration()
      sync()
    }
    const finish = () => {
      sync({
        loading: false,
        clearError: true,
      })
    }
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: "back" | "forward" | "reload" | "stop" | "focusAddress"; tabID?: string }>).detail
      if (detail?.tabID !== id) return
      if (!detail.command) return
      runCommand(detail.command)
    }

    webview.addEventListener("did-start-loading", start)
    webview.addEventListener("did-finish-load", finish)
    webview.addEventListener("did-stop-loading", sync)
    webview.addEventListener("did-navigate", sync)
    webview.addEventListener("did-navigate-in-page", sync)
    webview.addEventListener("page-title-updated", sync)
    webview.addEventListener("did-fail-load", fail)
    webview.addEventListener("dom-ready", onReady)
    webview.addEventListener("new-window", openWindow)
    window.addEventListener(BROWSER_COMMAND_EVENT, onCommand)

    onCleanup(() => {
      const target = desktopTarget()
      if (target && platform.unregisterBrowserGuest && registeredGuestID !== undefined) {
        void platform.unregisterBrowserGuest({
          ...target,
          guestID: registeredGuestID,
        })
      }
      pendingGuestID = undefined
      registeredGuestID = undefined
      setGuestReady(false)
      ready = false
      webview.removeEventListener("did-start-loading", start)
      webview.removeEventListener("did-finish-load", finish)
      webview.removeEventListener("did-stop-loading", sync)
      webview.removeEventListener("did-navigate", sync)
      webview.removeEventListener("did-navigate-in-page", sync)
      webview.removeEventListener("page-title-updated", sync)
      webview.removeEventListener("did-fail-load", fail)
      webview.removeEventListener("dom-ready", onReady)
      webview.removeEventListener("new-window", openWindow)
      window.removeEventListener(BROWSER_COMMAND_EVENT, onCommand)
    })
  })

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

  const currentFilePath = createMemo(() => {
    const current = state()
    if (!current) return
    if (!current.url.startsWith("file://")) return
    return file.normalize(current.url)
  })

  const openSource = () => {
    const current = currentFilePath()
    if (!current) return
    layout.view(sessionKey()).reviewPanel.open()
    layout.fileTree.open()
    void file.load(current).then(() => {
      const tab = file.tab(current)
      layout.tabs(sessionKey()).open(tab)
      layout.tabs(sessionKey()).setActive(tab)
    })
  }

  createEffect(() => {
    const target = desktopTarget()
    if (!target || !platform.setActiveBrowserTab) return
    ensureGuestRegistration()
    const active = props.visible !== false
    void platform.setActiveBrowserTab({
      ...target,
      active,
    })
    onCleanup(() => {
      void platform.setActiveBrowserTab?.({
        ...target,
        active: false,
      })
    })
  })

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
            const form = new FormData(event.currentTarget)
            submit(String(form.get("url") ?? ""))
          }}
        >
          <TextField
            ref={(el: HTMLInputElement) => {
              inputRef = el as HTMLInputElement
            }}
            name="url"
            value={state()?.input ?? state()?.url ?? ""}
            onInput={(event) => {
              const id = tabID()
              if (!id) return
              layout.view(sessionKey()).browser.update(id, { input: event.currentTarget.value })
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
                layout.view(sessionKey()).browser.close(id)
                layout.tabs(sessionKey()).close(props.tab)
              }}
              aria-label={language.t("common.closeTab")}
            />
          </Tooltip>
        </div>
      </div>

      <div class="relative flex-1 min-h-0">
        <Show
          when={browser()}
          fallback={<div class="size-full flex items-center justify-center text-12-regular text-text-weak">{language.t("common.loading")}</div>}
        >
          {(current) => (
            <div class="relative size-full">
              <webview
                ref={webviewRef}
                src={current().url}
                class="size-full bg-background-base"
                style={{ display: props.visible === false ? "none" : undefined }}
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
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
