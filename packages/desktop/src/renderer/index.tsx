// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FILE_TYPES,
  AppBaseProviders,
  AppInterface,
  getDetachedSidePanelContext,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  type Locale,
  type Platform,
  PlatformProvider,
  ServerConnection,
  useCommand,
} from "@lfcode-ai/app"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import type { BrowserWindowOpenRequest } from "../preload/types"
import type { AsyncStorage } from "@solid-primitives/storage"
import type { BaseRouterProps } from "@solidjs/router"
import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createEffect, createResource, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { initI18n, t } from "./i18n"
import { webviewZoom } from "./webview-zoom"
import "./styles.css"
import { useTheme } from "@lfcode-ai/ui/theme"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

void initI18n()

const deepLinkEvent = "lfcode:deep-link"
const browserOpenEvent = "lfcode:browser-request-open"

window.__LFCODE__ ??= {}
window.__LFCODE__.detachedSidePanel = getDetachedSidePanelContext()

const currentRendererRoute = () => window.location.hash.slice(1) || "/"
const emitAutomationEvent = (type: string, data?: unknown) => {
  window.api.automationEvent({
    type,
    data,
  })
}

const routerHistory = createMemoryHistory()
const initialRoute = (() => {
  const detachedRoute = window.__LFCODE__.detachedSidePanel?.route
  if (detachedRoute) return detachedRoute
  const hashRoute = window.location.hash.slice(1)
  if (hashRoute) return hashRoute
  return "/"
})()
if (initialRoute !== "/") {
  routerHistory.set({ value: initialRoute, replace: true, scroll: false })
}
const syncRendererRoute = (route: string) => {
  const url = new URL(window.location.href)
  const nextHash = route === "/" ? "" : `#${route}`
  if (url.hash === nextHash) return
  url.hash = route === "/" ? "" : route
  window.history.replaceState(window.history.state, "", url)
}
routerHistory.listen((route) => {
  syncRendererRoute(route)
  emitAutomationEvent("route.changed", { route })
})
syncRendererRoute(initialRoute)
window.__LFCODE__.navigate = (route: string) => {
  routerHistory.set({ value: route, replace: true, scroll: false })
}
window.__LFCODE__.automation = {
  getState: () => ({
    route: currentRendererRoute(),
    title: document.title,
    windowFocused: document.hasFocus(),
    detachedSidePanel: !!window.__LFCODE__?.detachedSidePanel,
    session: window.__LFCODE__?.sessionAutomation?.getState?.() ?? null,
  }),
  call: async (action, input) => {
    if (action === "ui.query") {
      const result = await window.__LFCODE__?.sessionAutomation?.ui?.query?.(input as never)
      if (!result) throw new Error("Renderer UI automation query is not available")
      return result
    }
    if (action === "ui.click") {
      const result = await window.__LFCODE__?.sessionAutomation?.ui?.click?.(input as never)
      if (!result) throw new Error("Renderer UI automation click is not available")
      return result
    }
    if (action === "ui.type") {
      const result = await window.__LFCODE__?.sessionAutomation?.ui?.type?.(input as never)
      if (!result) throw new Error("Renderer UI automation type is not available")
      return result
    }
    if (action === "ui.readText") {
      const result = window.__LFCODE__?.sessionAutomation?.ui?.readText?.(input as never)
      if (result === undefined) throw new Error("Renderer UI automation readText is not available")
      return result
    }
    if (action === "ui.wait") {
      const result = await window.__LFCODE__?.sessionAutomation?.ui?.wait?.(input as never)
      if (!result) throw new Error("Renderer UI automation wait is not available")
      return result
    }
    if (action === "ui.editor") {
      if (!window.__LFCODE__?.sessionAutomation?.ui?.editor) {
        throw new Error("Renderer UI automation editor is not available")
      }
      return window.__LFCODE__.sessionAutomation.ui.editor(input as never)
    }
    if (action === "route.navigate") {
      const route = typeof input === "object" && input && "route" in input ? String((input as { route: unknown }).route ?? "") : ""
      if (!route) throw new Error("Missing route")
      window.__LFCODE__?.navigate?.(route)
      return { route: currentRendererRoute() }
    }
    if (action === "session.open") {
      const value = input as { directory?: unknown; sessionID?: unknown } | undefined
      const directory = typeof value?.directory === "string" ? value.directory : ""
      const sessionID = typeof value?.sessionID === "string" ? value.sessionID : ""
      if (!directory || !sessionID) throw new Error("Missing directory or sessionID")
      const route = `/${base64Encode(directory)}/session/${sessionID}`
      window.__LFCODE__?.navigate?.(route)
      return { route }
    }
    const bridge = window.__LFCODE__?.sessionAutomation
    if (!bridge?.call) throw new Error(`Renderer automation action is not available: ${action}`)
    return bridge.call(action, input)
  },
}
window.addEventListener("error", (event) => {
  emitAutomationEvent("renderer.error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  })
})
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error
    ? { name: event.reason.name, message: event.reason.message, stack: event.reason.stack }
    : String(event.reason)
  emitAutomationEvent("renderer.unhandledrejection", { reason })
})

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__LFCODE__ ??= {}
  const pending = window.__LFCODE__.deepLinks ?? []
  window.__LFCODE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = () => {
  void window.api.consumeInitialDeepLinks().then((urls) => emitDeepLinks(urls))
  return window.api.onDeepLink((urls) => emitDeepLinks(urls))
}

const emitBrowserOpen = (detail: BrowserWindowOpenRequest) => {
  if (!detail?.url) return
  window.dispatchEvent(new CustomEvent(browserOpenEvent, { detail, cancelable: true }))
}

const createPlatform = (): Platform => {
  const os = (() => {
    const ua = navigator.userAgent
    if (ua.includes("Mac")) return "macos"
    if (ua.includes("Windows")) return "windows"
    if (ua.includes("Linux")) return "linux"
    return undefined
  })()

  const isWslEnabled = async () => {
    if (os !== "windows") return false
    return window.api
      .getWslConfig()
      .then((config) => config.enabled)
      .catch(() => false)
  }

  const wslHome = async () => {
    if (!(await isWslEnabled())) return undefined
    return window.api.wslPath("~", "windows").catch(() => undefined)
  }

  const handleWslPicker = async <T extends string | string[]>(result: T | null): Promise<T | null> => {
    if (!result || !(await isWslEnabled())) return result
    if (Array.isArray(result)) {
      return Promise.all(result.map((path) => window.api.wslPath(path, "linux").catch(() => path))) as any
    }
    return window.api.wslPath(result, "linux").catch(() => result) as any
  }

  const storage = (() => {
    const cache = new Map<string, AsyncStorage>()

    const createStorage = (name: string) => {
      const api: AsyncStorage = {
        getItem: (key: string) => window.api.storeGet(name, key),
        setItem: (key: string, value: string) => window.api.storeSet(name, key, value),
        removeItem: (key: string) => window.api.storeDelete(name, key),
        clear: () => window.api.storeClear(name),
        key: async (index: number) => (await window.api.storeKeys(name))[index],
        getLength: () => window.api.storeLength(name),
        get length() {
          return api.getLength()
        },
      }
      return api
    }

    return (name = "default.dat") => {
      const cached = cache.get(name)
      if (cached) return cached
      const api = createStorage(name)
      cache.set(name, api)
      return api
    }
  })()

  return {
    platform: "desktop",
    os,
    version: pkg.version,
    getRendererMemoryInfo: () => window.api.getRendererMemoryInfo(),

    async openDirectoryPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await window.api.openDirectoryPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath,
      })
      return await handleWslPicker(result)
    },

    async openFilePickerDialog(opts) {
      const result = await window.api.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
        accept: opts?.accept ?? ACCEPTED_FILE_TYPES,
        extensions: opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS,
      })
      return handleWslPicker(result)
    },

    async openAttachmentPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await window.api.openAttachmentPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? "Attach files or folders",
        defaultPath,
      })
      return handleWslPicker(result)
    },

    async saveFilePickerDialog(opts) {
      const result = await window.api.saveFilePicker({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return handleWslPicker(result)
    },

    openLink(url: string, detail) {
      emitBrowserOpen({ url, ...detail })
    },
    openExternalLink(url: string) {
      window.api.openExternalLink(url)
    },
    openBrowserDevTools: async (target) => {
      await window.api.openBrowserDevTools(target)
    },
    clearBrowserSiteData: async (target) => {
      return window.api.clearBrowserSiteData(target)
    },
    getBrowserReferenceState: async (target) => {
      return window.api.getBrowserReferenceState(target)
    },
    getBrowserCacheOverview: async () => {
      return window.api.getBrowserCacheOverview()
    },
    clearBrowserCache: async () => {
      return window.api.clearBrowserCache()
    },
    listBrowserCookies: async () => {
      return window.api.listBrowserCookies()
    },
    removeBrowserCookie: async (cookie) => {
      await window.api.removeBrowserCookie(cookie)
    },
    clearBrowserCookiesByDomain: async (domain) => {
      return window.api.clearBrowserCookiesByDomain(domain)
    },
    clearAllBrowserCookies: async () => {
      return window.api.clearAllBrowserCookies()
    },
    getBrowserPasswordStorageState: async () => {
      return window.api.getBrowserPasswordStorageState()
    },
    listSavedBrowserLogins: async () => {
      return window.api.listSavedBrowserLogins()
    },
    upsertSavedBrowserLogin: async (input) => {
      return window.api.upsertSavedBrowserLogin(input)
    },
    deleteSavedBrowserLogin: async (id) => {
      await window.api.deleteSavedBrowserLogin(id)
    },
    acknowledgeBrowserSavePasswordPrompt: async (input) => {
      return window.api.acknowledgeBrowserSavePasswordPrompt(input)
    },
    onBrowserPasswordCapture: (cb) => window.api.onBrowserPasswordCapture(cb),
    registerBrowserGuest: async (target) => {
      await window.api.registerBrowserGuest(target)
    },
    markBrowserGuestReady: async (target) => {
      await window.api.markBrowserGuestReady(target)
    },
    unregisterBrowserGuest: async (target) => {
      await window.api.unregisterBrowserGuest(target)
    },
    setActiveBrowserTab: async (target) => {
      await window.api.setActiveBrowserTab(target)
    },
    async openPath(path: string, app?: string) {
      if (os === "windows") {
        const resolvedApp = app ? await window.api.resolveAppPath(app).catch(() => null) : null
        if (app && !resolvedApp) throw new Error(`The selected application is not available: ${app}`)
        const resolvedPath = await (async () => {
          if (await isWslEnabled()) {
            const converted = await window.api.wslPath(path, "windows").catch(() => null)
            if (converted) return converted
          }
          return path
        })()
        return window.api.openPath(resolvedPath, resolvedApp ?? undefined)
      }
      return window.api.openPath(path, app)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage,

    checkUpdate: async () => {
      const config = await window.api.getWindowConfig().catch(() => ({ updaterEnabled: false }))
      if (!config.updaterEnabled) return { updateAvailable: false }
      return window.api.checkUpdate()
    },

    update: async () => {
      const config = await window.api.getWindowConfig().catch(() => ({ updaterEnabled: false }))
      if (!config.updaterEnabled) return
      await window.api.installUpdate()
    },

    restart: async () => {
      await window.api.killSidecar().catch(() => undefined)
      window.api.relaunch()
    },

    notify: async (title, description, href) => {
      const focused = await window.api.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://lfcode.ai/favicon-96x96-v3.png",
      })
      notification.onclick = () => {
        void window.api.showWindow()
        void window.api.setWindowFocus()
        handleNotificationClick(href)
        notification.close()
      }
    },

    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)
      return fetch(input, init)
    },

    getWslEnabled: () => isWslEnabled(),

    setWslEnabled: async (enabled) => {
      await window.api.setWslConfig({ enabled })
    },

    getDefaultServer: async () => {
      const url = await window.api.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: string | null) => {
      await window.api.setDefaultServerUrl(url)
    },

    getDisplayBackend: async () => {
      return window.api.getDisplayBackend().catch(() => null)
    },

    setDisplayBackend: async (backend) => {
      await window.api.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => window.api.parseMarkdownCommand(markdown),

    webviewZoom,

    getWindowID: async () => {
      return window.api.getWindowID()
    },

    checkAppExists: async (appName: string) => {
      return window.api.checkAppExists(appName)
    },

    async readClipboardImage() {
      const image = await window.api.readClipboardImage().catch(() => null)
      if (!image) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, {
        type: "image/png",
      })
    },
    getPathForFile: (file: File) => window.api.getPathForFile(file),
    readDroppedImage: (path: string) => window.api.readDroppedImage(path),
    readEditorSnippets: (directory: string) => window.api.readEditorSnippets(directory),
    onNativeFileTransfer: (cb) => window.api.onNativeFileTransfer(cb),
    createDetachedSidePanelWindow: async (input) => {
      await window.api.createDetachedSidePanelWindow(input)
    },
    redockDetachedSidePanelWindow: async (detachedWindowID, placement) => {
      await window.api.redockDetachedSidePanelWindow(detachedWindowID, placement)
    },
    setDetachedDockTarget: async (input) => {
      await window.api.setDetachedDockTarget(input)
    },
    clearDetachedDockTarget: async () => {
      await window.api.clearDetachedDockTarget()
    },
    onDetachedSidePanelEvent: (cb) => window.api.onDetachedSidePanelEvent(cb),
  }
}

function DetachedRouter(props: BaseRouterProps) {
  return (
    <MemoryRouter history={routerHistory} root={props.root}>
      {props.children}
    </MemoryRouter>
  )
}

let menuTrigger = null as null | ((id: string) => void)
window.api.onMenuCommand((id) => {
  menuTrigger?.(id)
})
listenForDeepLinks()
window.api.onBrowserWindowOpen((detail) => emitBrowserOpen(detail))

render(() => {
  const platform = createPlatform()
  const [windowConfig] = createResource(() => window.api.getWindowConfig().catch(() => ({ updaterEnabled: false })))
  const loadLocale = async () => {
    const current = await platform.storage?.("lfcode.global.dat").getItem("language")
    const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
    const raw = current ?? legacy
    if (!raw) return
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) return
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  const [windowCount] = createResource(() => window.api.getWindowCount())

  // Fetch sidecar credentials (available immediately, before health check)
  const [sidecar] = createResource(() => window.api.awaitInitialization(() => undefined))

  const [defaultServer] = createResource(() =>
    platform.getDefaultServer?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    }),
  )
  const [locale] = createResource(loadLocale)

  const servers = () => {
    const data = sidecar()
    if (!data) return []
    const server: ServerConnection.Sidecar = {
      displayName: "Local Server",
      type: "sidecar",
      variant: "base",
      http: {
        url: data.url,
        username: data.username ?? undefined,
        password: data.password ?? undefined,
      },
    }
    return [server] as ServerConnection.Any[]
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)

    const theme = useTheme()

    createEffect(() => {
      theme.themeId()
      theme.mode()
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
      if (bg) {
        void window.api.setBackgroundColor(bg)
      }
    })

    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show
          when={
            !defaultServer.loading &&
            !sidecar.loading &&
            !windowConfig.loading &&
            !windowCount.loading &&
            !locale.loading
          }
        >
          {(_) => {
            return (
              <AppInterface
                defaultServer={defaultServer.latest ?? ServerConnection.Key.make("sidecar")}
                servers={servers()}
                router={DetachedRouter}
              >
                <Inner />
              </AppInterface>
            )
          }}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
