// @refresh reload

import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { type Platform, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { BROWSER_REQUEST_OPEN_EVENT, type BrowserOpenRequestDetail } from "@/pages/session/helpers"
import { handleNotificationClick } from "@/utils/notification-click"
import pkg from "../package.json"
import { ServerConnection } from "./context/server"

const DEFAULT_SERVER_URL_KEY = "lfcode.settings.dat:defaultServerUrl"
const COLOR_SCHEME_KEY = "lfcode-color-scheme"

const getLocale = () => {
  if (typeof navigator !== "object") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }
  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()
  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

// A browser has no access to the desktop renderer's saved theme. Use the
// desktop default on first visit, but never override an explicit browser choice.
if (getStorage(COLOR_SCHEME_KEY) === null) setStorage(COLOR_SCHEME_KEY, "dark")

const notify: Platform["notify"] = async (title, description, href) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return

  const notification = new Notification(title, {
    body: description ?? "",
    icon: "https://lfcode.ai/favicon-96x96-v3.png",
  })

  notification.onclick = () => {
    handleNotificationClick(href)
    notification.close()
  }
}

const openLink: Platform["openLink"] = (url, detail) => {
  const event = new CustomEvent<BrowserOpenRequestDetail>(BROWSER_REQUEST_OPEN_EVENT, {
    detail: { url, ...detail },
    cancelable: true,
  })
  const handled = window.dispatchEvent(event)
  if (!handled) return
  window.open(url, "_blank")
}

const back: Platform["back"] = () => {
  window.history.back()
}

const forward: Platform["forward"] = () => {
  window.history.forward()
}

const restart: Platform["restart"] = async () => {
  window.location.reload()
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const getCurrentUrl = () => {
  if (location.hostname.includes("lfcode.ai")) return "http://localhost:4096"
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_LFCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_LFCODE_SERVER_PORT ?? "4096"}`
  return location.origin
}

const getDefaultUrl = () => {
  const lsDefault = readDefaultServerUrl()
  if (lsDefault) return lsDefault
  return getCurrentUrl()
}

const lanAwareFetch = Object.assign(
  async (input: URL | RequestInfo, init?: RequestInit) => {
    const response = await fetch(input, init)
    if (response.status === 401 && response.headers.get("X-Lfcode-Lan-Authorization") === "pairing-required") {
      window.dispatchEvent(new Event("lfcode:lan-pairing-required"))
    }
    return response
  },
  // `fetch.preconnect` is available in Bun/Electron, but not in browsers.
  // The LAN Web UI must retain the fetch shape without assuming that extension.
  { preconnect: globalThis.fetch.preconnect?.bind(globalThis.fetch) ?? (() => undefined) },
) satisfies typeof fetch

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  openLink,
  openExternalLink: (url) => window.open(url, "_blank"),
  back,
  forward,
  restart,
  notify,
  fetch: lanAwareFetch,
  getDefaultServer: async () => {
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: writeDefaultServerUrl,
}

if (root instanceof HTMLElement) {
  const server: ServerConnection.Http = { type: "http", http: { url: getCurrentUrl() } }
  render(
    () => (
      <PlatformProvider value={platform}>
        <AppBaseProviders>
          <AppInterface
            defaultServer={ServerConnection.Key.make(getDefaultUrl())}
            servers={[server]}
            disableHealthCheck
          />
        </AppBaseProviders>
      </PlatformProvider>
    ),
    root,
  )
}
