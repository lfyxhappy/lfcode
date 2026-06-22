import { type Cookie, webContents, type WebContents } from "electron"
import { browserCookieRemovalURL } from "./browser-runtime-core"

const BROWSER_PARTITION = "persist:lfcode-browser"
const SITE_STORAGE_TYPES = ["cachestorage", "filesystem", "indexdb", "localstorage", "serviceworkers", "websql"] as const

type BrowserTabKey = `${number}:${string}`

const guests = new Map<
  BrowserTabKey,
  {
    guestID: number
    cleanup: () => void
  }
>()
const activeTabs = new Map<number, string>()
const recentTabs = new Map<number, string>()

export type BrowserSiteDataResult = {
  url: string
  origin?: string
  clearedCookies: number
}

export function browserPartition() {
  return BROWSER_PARTITION
}

export function trackBrowserGuest(input: {
  sourceWindowID: number
  tabID: string
  guestID: number
}) {
  const guest = webContents.fromId(input.guestID)
  if (!guest || guest.isDestroyed()) return

  const id = key(input.sourceWindowID, input.tabID)
  guests.get(id)?.cleanup()

  const onDestroyed = () => {
    const current = guests.get(id)
    if (current?.guestID !== input.guestID) return
    guests.delete(id)
    clearWindowTab(input.sourceWindowID, input.tabID)
  }

  guest.once("destroyed", onDestroyed)
  guests.set(id, {
    guestID: input.guestID,
    cleanup: () => {
      guest.removeListener("destroyed", onDestroyed)
    },
  })
  recentTabs.set(input.sourceWindowID, input.tabID)
}

export function untrackBrowserGuest(input: {
  sourceWindowID: number
  tabID: string
}) {
  const current = guests.get(key(input.sourceWindowID, input.tabID))
  if (!current) return
  current.cleanup()
  guests.delete(key(input.sourceWindowID, input.tabID))
  clearWindowTab(input.sourceWindowID, input.tabID)
}

export function setActiveBrowserTab(input: {
  sourceWindowID: number
  tabID?: string
}) {
  if (!input.tabID) {
    activeTabs.delete(input.sourceWindowID)
    return
  }
  activeTabs.set(input.sourceWindowID, input.tabID)
  recentTabs.set(input.sourceWindowID, input.tabID)
}

export function getActiveBrowserTarget(input: {
  sourceWindowID: number
}) {
  return resolveWindowTarget(input.sourceWindowID)
}

export function listActiveBrowserTargets() {
  return Array.from(windowIDs())
    .map((sourceWindowID) => resolveWindowTarget(sourceWindowID))
    .filter((item): item is NonNullable<typeof item> => !!item)
}

export function openBrowserGuestDevTools(input: {
  sourceWindowID: number
  tabID?: string
}) {
  const guest = requireGuestWithFallback(input)
  guest.openDevTools({ mode: "detach", activate: true })
}

export async function clearBrowserGuestSiteData(input: {
  sourceWindowID: number
  tabID?: string
}) {
  const guest = requireGuestWithFallback(input)
  const current = parseGuestURL(guest)
  const currentSession = guest.session
  const cookies = current.protocol === "http:" || current.protocol === "https:" ? await currentSession.cookies.get({ url: current.toString() }) : []

  await Promise.all(
    cookies.map((cookie) => currentSession.cookies.remove(browserCookieRemovalURL(cookie, current), cookie.name)),
  )

  if (current.origin !== "null") {
    await currentSession.clearStorageData({
      origin: current.origin,
      storages: [...SITE_STORAGE_TYPES],
    })
  }

  return {
    url: current.toString(),
    ...(current.origin !== "null" ? { origin: current.origin } : {}),
    clearedCookies: cookies.length,
  } satisfies BrowserSiteDataResult
}

function key(sourceWindowID: number, tabID: string): BrowserTabKey {
  return `${sourceWindowID}:${tabID}`
}

function windowIDs() {
  return new Set<number>([
    ...activeTabs.keys(),
    ...recentTabs.keys(),
    ...Array.from(guests.keys()).map((item) => Number(item.slice(0, item.indexOf(":")))),
  ])
}

function trackedTabsForWindow(sourceWindowID: number) {
  return Array.from(guests.keys())
    .flatMap((item) => {
      const split = item.indexOf(":")
      if (split === -1) return []
      if (Number(item.slice(0, split)) !== sourceWindowID) return []
      return [item.slice(split + 1)]
    })
    .toReversed()
}

function preferredTabsForWindow(sourceWindowID: number) {
  return Array.from(
    new Set([
      activeTabs.get(sourceWindowID),
      recentTabs.get(sourceWindowID),
      ...trackedTabsForWindow(sourceWindowID),
    ].filter((item): item is string => !!item)),
  )
}

function resolveWindowTarget(sourceWindowID: number) {
  for (const tabID of preferredTabsForWindow(sourceWindowID)) {
    try {
      return getBrowserTarget({ sourceWindowID, tabID })
    } catch {}
  }
}

function clearWindowTab(sourceWindowID: number, tabID: string) {
  if (activeTabs.get(sourceWindowID) === tabID) {
    activeTabs.delete(sourceWindowID)
  }
  if (recentTabs.get(sourceWindowID) === tabID) {
    recentTabs.delete(sourceWindowID)
  }
}

function getBrowserTarget(input: {
  sourceWindowID: number
  tabID: string
}) {
  const guest = requireGuest(input)
  return {
    sourceWindowID: input.sourceWindowID,
    tabID: input.tabID,
    guest,
  }
}

function requireGuest(input: {
  sourceWindowID: number
  tabID: string
}) {
  const current = guests.get(key(input.sourceWindowID, input.tabID))
  const guest = current ? webContents.fromId(current.guestID) : undefined
  if (!guest || guest.isDestroyed()) {
    if (current) {
      current.cleanup()
      guests.delete(key(input.sourceWindowID, input.tabID))
    }
    clearWindowTab(input.sourceWindowID, input.tabID)
    throw new Error("Side browser target is not ready")
  }
  return guest
}

function requireGuestWithFallback(input: {
  sourceWindowID: number
  tabID?: string
}) {
  if (input.tabID) return requireGuest({ sourceWindowID: input.sourceWindowID, tabID: input.tabID })
  const target = resolveWindowTarget(input.sourceWindowID)
  if (target) return target.guest
  throw new Error("No active side browser tab")
}

function parseGuestURL(guest: WebContents) {
  const url = guest.getURL()
  if (!url) throw new Error("Side browser target has no active page")
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
    throw new Error(`Unsupported side browser URL: ${parsed.protocol}`)
  }
  return parsed
}

export { browserCookieRemovalURL } from "./browser-runtime-core"
