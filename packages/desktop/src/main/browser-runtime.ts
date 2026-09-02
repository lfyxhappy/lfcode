import { session, webContents, type WebContents } from "electron"
import { browserCookieRemovalURL } from "./browser-runtime-core"

const BROWSER_PARTITION = "persist:lfcode-browser"
const SITE_STORAGE_TYPES = ["cachestorage", "filesystem", "indexdb", "localstorage", "serviceworkers", "websql"] as const
const browserRuntimeDebugKey = Symbol.for("lfcode.desktop-browser-runtime-debug")

type BrowserTabKey = `${number}:${string}`
type BrowserTargetOwner = {
  sessionKey: string
  sessionID?: string
}

const guests = new Map<
  BrowserTabKey,
  {
    guestID: number
    cleanup: () => void
  }
>()
const activeTabs = new Map<number, string>()
const recentTabs = new Map<number, string>()
const guestLookup = new Map<number, BrowserTabKey>()
const targetOwners = new Map<BrowserTabKey, BrowserTargetOwner>()
const sessionActiveTargets = new Map<string, BrowserTabKey>()
const sessionRecentTargets = new Map<string, BrowserTabKey[]>()
const readyGuests = new Map<BrowserTabKey, number>()
const performanceLeases = new Map<BrowserTabKey, ReturnType<typeof setTimeout>>()
const consoleEntries = new Map<BrowserTabKey, BrowserConsoleEntry[]>()
const networkEntries = new Map<BrowserTabKey, BrowserNetworkEntry[]>()
const pendingConsoleEntries = new Map<number, BrowserConsoleEntry[]>()
const pendingNetworkEntries = new Map<number, BrowserNetworkEntry[]>()
const ENTRY_LIMIT = 200

export type BrowserSiteDataResult = {
  url: string
  origin?: string
  clearedCookies: number
}

export type BrowserConsoleEntry = {
  level: "log" | "warning" | "error" | "debug" | "info"
  kind?: "console" | "pageerror" | "unhandledrejection"
  message: string
  sourceId?: string
  line?: number
  column?: number
  stack?: string
  time: number
}

export type BrowserNetworkEntry = {
  url: string
  method: string
  resourceType?: string
  statusCode?: number
  fromCache?: boolean
  mimeType?: string
  contentDisposition?: string
  error?: string
  time: number
}

export type BrowserCachedResourceEntry = {
  url: string
  method: string
  resourceType?: string
  statusCode?: number
  fromCache?: boolean
  cacheObserved: boolean
  mimeType?: string
  contentDisposition?: string
  lastSeenAt: number
  observations: number
  sourceWindowID?: number
  tabID?: string
  sessionKey?: string
  sessionID?: string
}

export type BrowserCacheOverview = {
  cacheSizeBytes: number
  indexedEntryCount: number
  lastSeenAt: number | null
}

export function browserPartition() {
  return BROWSER_PARTITION
}

export function trackBrowserGuest(input: {
  sourceWindowID: number
  tabID: string
  guestID: number
  sessionKey?: string
  sessionID?: string
}) {
  const guest = webContents.fromId(input.guestID)
  if (!guest || guest.isDestroyed()) return

  const id = key(input.sourceWindowID, input.tabID)
  guests.get(id)?.cleanup()
  if (input.sessionKey) {
    targetOwners.set(id, {
      sessionKey: input.sessionKey,
      sessionID: input.sessionID,
    })
    touchSessionTarget(input.sessionKey, id)
  }

  const onDestroyed = () => {
    const current = guests.get(id)
    if (current?.guestID !== input.guestID) return
    guests.delete(id)
    guestLookup.delete(input.guestID)
    const lease = performanceLeases.get(id)
    if (lease) clearTimeout(lease)
    performanceLeases.delete(id)
    clearTargetOwner(id)
    clearWindowTab(input.sourceWindowID, input.tabID)
  }

  guest.once("destroyed", onDestroyed)
  guests.set(id, {
    guestID: input.guestID,
    cleanup: () => {
      guest.removeListener("destroyed", onDestroyed)
    },
  })
  guestLookup.set(input.guestID, id)
  flushPendingGuestEntries(input.guestID, id)
  recentTabs.set(input.sourceWindowID, input.tabID)
}

export function markBrowserGuestReady(input: {
  sourceWindowID: number
  tabID: string
  guestID: number
}) {
  const id = key(input.sourceWindowID, input.tabID)
  const current = guests.get(id)
  if (!current) return
  if (current.guestID !== input.guestID) return
  readyGuests.set(id, input.guestID)
}

export function refreshBrowserGuestPerformance(input: { sourceWindowID: number; tabID: string; leaseMs?: number }) {
  const currentKey = key(input.sourceWindowID, input.tabID)
  const current = guests.get(currentKey)
  const guest = current ? webContents.fromId(current.guestID) : undefined
  if (!guest || guest.isDestroyed()) return
  const existing = performanceLeases.get(currentKey)
  if (existing) clearTimeout(existing)
  guest.setBackgroundThrottling(false)
  guest.setFrameRate(60)
  const timer = setTimeout(() => {
    performanceLeases.delete(currentKey)
    if (activeTabs.get(input.sourceWindowID) === input.tabID || guest.isDestroyed()) return
    guest.setBackgroundThrottling(true)
    guest.setFrameRate(30)
  }, input.leaseMs ?? 60000)
  performanceLeases.set(currentKey, timer)
}

export function untrackBrowserGuest(input: {
  sourceWindowID: number
  tabID: string
}) {
  const current = guests.get(key(input.sourceWindowID, input.tabID))
  if (!current) return
  current.cleanup()
  guests.delete(key(input.sourceWindowID, input.tabID))
  guestLookup.delete(current.guestID)
  pendingConsoleEntries.delete(current.guestID)
  pendingNetworkEntries.delete(current.guestID)
  const currentKey = key(input.sourceWindowID, input.tabID)
  const lease = performanceLeases.get(currentKey)
  if (lease) clearTimeout(lease)
  performanceLeases.delete(currentKey)
  readyGuests.delete(key(input.sourceWindowID, input.tabID))
  clearTargetOwner(key(input.sourceWindowID, input.tabID))
  clearWindowTab(input.sourceWindowID, input.tabID)
}

export function clearBrowserWindow(sourceWindowID: number) {
  for (const [currentKey, current] of Array.from(guests.entries())) {
    const split = currentKey.indexOf(":")
    if (split === -1) continue
    if (Number(currentKey.slice(0, split)) !== sourceWindowID) continue
    current.cleanup()
    guests.delete(currentKey)
    guestLookup.delete(current.guestID)
    readyGuests.delete(currentKey)
    const lease = performanceLeases.get(currentKey)
    if (lease) clearTimeout(lease)
    performanceLeases.delete(currentKey)
    clearTargetOwner(currentKey)
  }
  activeTabs.delete(sourceWindowID)
  recentTabs.delete(sourceWindowID)
}

export function setActiveBrowserTab(input: {
  sourceWindowID: number
  tabID?: string
  active?: boolean
  sessionKey?: string
  sessionID?: string
}) {
  if (!input.tabID) {
    return
  }
  const currentKey = key(input.sourceWindowID, input.tabID)
  if (input.sessionKey) {
    targetOwners.set(currentKey, {
      sessionKey: input.sessionKey,
      sessionID: input.sessionID,
    })
    touchSessionTarget(input.sessionKey, currentKey)
  }
  if (input.active === false) {
    if (activeTabs.get(input.sourceWindowID) === input.tabID) {
      activeTabs.delete(input.sourceWindowID)
    }
    if (input.sessionKey && sessionActiveTargets.get(input.sessionKey) === currentKey) {
      sessionActiveTargets.delete(input.sessionKey)
    }
    throttleGuest(currentKey)
    return
  }
  const previousTabID = activeTabs.get(input.sourceWindowID)
  if (previousTabID && previousTabID !== input.tabID) throttleGuest(key(input.sourceWindowID, previousTabID))
  refreshBrowserGuestPerformance({ sourceWindowID: input.sourceWindowID, tabID: input.tabID })
  activeTabs.set(input.sourceWindowID, input.tabID)
  recentTabs.set(input.sourceWindowID, input.tabID)
  const owner = targetOwners.get(currentKey)
  if (owner) {
    sessionActiveTargets.set(owner.sessionKey, currentKey)
    touchSessionTarget(owner.sessionKey, currentKey)
  }
}

function throttleGuest(currentKey: BrowserTabKey) {
  const lease = performanceLeases.get(currentKey)
  if (lease) clearTimeout(lease)
  performanceLeases.delete(currentKey)
  const current = guests.get(currentKey)
  const guest = current ? webContents.fromId(current.guestID) : undefined
  if (!guest || guest.isDestroyed()) return
  guest.setBackgroundThrottling(true)
  guest.setFrameRate(30)
}

export function getActiveBrowserTarget(input: {
  sourceWindowID: number
}) {
  return resolveWindowTarget(input.sourceWindowID)
}

export function getBrowserTargetForSession(sessionKey: string, tabID?: string) {
  if (tabID) return getBrowserTargetForSessionTab(sessionKey, tabID)
  const active = sessionActiveTargets.get(sessionKey) ?? findSessionTargetBySessionID(sessionKey, sessionActiveTargets)
  if (active) {
    const target = resolveOwnedTarget(active)
    if (target) return target
    if (hasPendingOrBlockedTarget(active, false)) return undefined
  }
  for (const item of sessionRecentTargets.get(sessionKey) ?? findRecentTargetsBySessionID(sessionKey)) {
    const target = resolveOwnedTarget(item)
    if (target) return target
  }
  for (const [currentKey, owner] of targetOwners.entries()) {
    if (owner.sessionKey !== sessionKey) continue
    const target = resolveOwnedTarget(currentKey)
    if (target) return target
  }
  return undefined
}

export function getReadyBrowserTargetForSession(sessionKey: string, tabID?: string) {
  if (tabID) return getBrowserTargetForSessionTab(sessionKey, tabID, true)
  const active = sessionActiveTargets.get(sessionKey) ?? findSessionTargetBySessionID(sessionKey, sessionActiveTargets)
  if (active) {
    const target = resolveOwnedTarget(active, true)
    if (target) return target
    if (hasPendingOrBlockedTarget(active, true)) return undefined
  }
  for (const item of sessionRecentTargets.get(sessionKey) ?? findRecentTargetsBySessionID(sessionKey)) {
    const target = resolveOwnedTarget(item, true)
    if (target) return target
  }
  for (const [currentKey, owner] of targetOwners.entries()) {
    if (!ownerMatchesSession(sessionKey, owner)) continue
    const target = resolveOwnedTarget(currentKey, true)
    if (target) return target
  }
  return undefined
}

function getBrowserTargetForSessionTab(sessionKey: string, tabID: string, readyOnly = false) {
  for (const [currentKey, owner] of targetOwners.entries()) {
    if (owner.sessionKey !== sessionKey) continue
    const split = currentKey.indexOf(":")
    if (split < 0 || currentKey.slice(split + 1) !== tabID) continue
    const target = resolveOwnedTarget(currentKey, readyOnly)
    if (target) return target
  }
  return undefined
}

export function hasBrowserTargetForSession(sessionKey: string, tabID?: string) {
  if (tabID) {
    return Array.from(targetOwners.entries()).some(([currentKey, owner]) => {
      if (owner.sessionKey !== sessionKey) return false
      const split = currentKey.indexOf(":")
      return split >= 0 && currentKey.slice(split + 1) === tabID && guests.has(currentKey)
    })
  }
  if (sessionActiveTargets.has(sessionKey) || !!findSessionTargetBySessionID(sessionKey, sessionActiveTargets)) return true
  if ((sessionRecentTargets.get(sessionKey) ?? findRecentTargetsBySessionID(sessionKey)).length > 0) return true
  return Array.from(targetOwners.values()).some((owner) => ownerMatchesSession(sessionKey, owner))
}

export function listActiveBrowserTargets() {
  return Array.from(windowIDs())
    .map((sourceWindowID) => resolveWindowTarget(sourceWindowID))
    .filter((item): item is NonNullable<typeof item> => !!item)
}

export function getBrowserGuestOwner(guestID: number) {
  const currentKey = guestLookup.get(guestID)
  if (!currentKey) return
  const split = currentKey.indexOf(":")
  if (split < 0) return
  const owner = targetOwners.get(currentKey)
  return {
    sourceWindowID: Number(currentKey.slice(0, split)),
    tabID: currentKey.slice(split + 1),
    sessionKey: owner?.sessionKey,
    sessionID: owner?.sessionID,
  }
}

export function recordBrowserConsole(input: {
  guestID: number
  entry: BrowserConsoleEntry
}) {
  const currentKey = guestLookup.get(input.guestID)
  if (!currentKey) {
    pushPendingEntry(pendingConsoleEntries, input.guestID, input.entry)
    return
  }
  pushEntry(consoleEntries, currentKey, input.entry)
}

export function listBrowserConsoleForSession(sessionKey: string, limit = 50, tabID?: string) {
  const currentKey = resolveTargetKeyForSession(sessionKey, tabID)
  if (!currentKey) return []
  return [...(consoleEntries.get(currentKey) ?? [])].slice(-limit)
}

export function recordBrowserNetwork(input: {
  guestID: number
  entry: BrowserNetworkEntry
}) {
  const currentKey = guestLookup.get(input.guestID)
  if (!currentKey) {
    pushPendingEntry(pendingNetworkEntries, input.guestID, input.entry)
    return
  }
  pushEntry(networkEntries, currentKey, input.entry)
}

export function listBrowserNetworkForSession(sessionKey: string, limit = 50, tabID?: string) {
  const currentKey = resolveTargetKeyForSession(sessionKey, tabID)
  if (!currentKey) return []
  return [...(networkEntries.get(currentKey) ?? [])].slice(-limit)
}

export async function listBrowserCachedResources(input?: {
  query?: string
  url?: string
  limit?: number
  resourceTypes?: string[]
}) {
  const normalizedQuery = input?.query?.trim().toLowerCase()
  const normalizedUrl = input?.url?.trim()
  const resourceTypes = new Set((input?.resourceTypes ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean))
  const merged = new Map<string, BrowserCachedResourceEntry>()
  const items = Array.from(networkEntries.entries())
    .flatMap(([currentKey, entries]) =>
      entries.map((entry) => {
        const split = currentKey.indexOf(":")
        const sourceWindowID = split >= 0 ? Number(currentKey.slice(0, split)) : undefined
        const tabID = split >= 0 ? currentKey.slice(split + 1) : undefined
        const owner = targetOwners.get(currentKey)
        return {
          entry,
          sourceWindowID,
          tabID,
          sessionKey: owner?.sessionKey,
          sessionID: owner?.sessionID,
        }
      }),
    )
    .sort((a, b) => b.entry.time - a.entry.time)

  for (const item of items) {
    if (normalizedUrl && item.entry.url !== normalizedUrl) continue
    if (normalizedQuery && !item.entry.url.toLowerCase().includes(normalizedQuery)) continue
    if (resourceTypes.size > 0 && !resourceTypes.has((item.entry.resourceType ?? "").toLowerCase())) continue
    const existing = merged.get(item.entry.url)
    if (!existing) {
      merged.set(item.entry.url, {
        url: item.entry.url,
        method: item.entry.method,
        resourceType: item.entry.resourceType,
        statusCode: item.entry.statusCode,
        fromCache: item.entry.fromCache,
        cacheObserved: item.entry.fromCache === true,
        mimeType: item.entry.mimeType,
        contentDisposition: item.entry.contentDisposition,
        lastSeenAt: item.entry.time,
        observations: 1,
        sourceWindowID: item.sourceWindowID,
        tabID: item.tabID,
        sessionKey: item.sessionKey,
        sessionID: item.sessionID,
      })
      continue
    }
    existing.observations += 1
    existing.cacheObserved ||= item.entry.fromCache === true
    if (existing.fromCache !== true && item.entry.fromCache === true) existing.fromCache = true
  }

  return {
    cacheSizeBytes: await browserSession().getCacheSize().catch(() => 0),
    indexedEntryCount: merged.size,
    entries: Array.from(merged.values())
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, input?.limit && input.limit > 0 ? input.limit : 50),
  }
}

export function findBrowserCachedResourceByUrl(url: string) {
  const normalizedUrl = url.trim()
  if (!normalizedUrl) return
  const merged = new Map<string, BrowserCachedResourceEntry>()
  const items = Array.from(networkEntries.entries())
    .flatMap(([currentKey, entries]) =>
      entries.map((entry) => {
        const split = currentKey.indexOf(":")
        const sourceWindowID = split >= 0 ? Number(currentKey.slice(0, split)) : undefined
        const tabID = split >= 0 ? currentKey.slice(split + 1) : undefined
        const owner = targetOwners.get(currentKey)
        return {
          entry,
          sourceWindowID,
          tabID,
          sessionKey: owner?.sessionKey,
          sessionID: owner?.sessionID,
        }
      }),
    )
    .sort((a, b) => b.entry.time - a.entry.time)

  for (const item of items) {
    if (item.entry.url !== normalizedUrl) continue
    const existing = merged.get(item.entry.url)
    if (!existing) {
      merged.set(item.entry.url, {
        url: item.entry.url,
        method: item.entry.method,
        resourceType: item.entry.resourceType,
        statusCode: item.entry.statusCode,
        fromCache: item.entry.fromCache,
        cacheObserved: item.entry.fromCache === true,
        mimeType: item.entry.mimeType,
        contentDisposition: item.entry.contentDisposition,
        lastSeenAt: item.entry.time,
        observations: 1,
        sourceWindowID: item.sourceWindowID,
        tabID: item.tabID,
        sessionKey: item.sessionKey,
        sessionID: item.sessionID,
      })
      continue
    }
    existing.observations += 1
    existing.cacheObserved ||= item.entry.fromCache === true
    if (existing.fromCache !== true && item.entry.fromCache === true) existing.fromCache = true
  }

  return Array.from(merged.values())
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .at(0)
}

export async function getBrowserCacheOverview(): Promise<BrowserCacheOverview> {
  const cached = await listBrowserCachedResources({ limit: 1 })
  return {
    cacheSizeBytes: cached.cacheSizeBytes,
    indexedEntryCount: cached.indexedEntryCount,
    lastSeenAt: cached.entries[0]?.lastSeenAt ?? null,
  }
}

export async function clearBrowserCache() {
  await browserSession().clearCache()
  networkEntries.clear()
  pendingNetworkEntries.clear()
  return getBrowserCacheOverview()
}

;(globalThis as Record<PropertyKey, unknown>)[browserRuntimeDebugKey] = {
  snapshot: () => ({
    activeTabs: Object.fromEntries(activeTabs.entries()),
    recentTabs: Object.fromEntries(recentTabs.entries()),
    sessionActiveTargets: Object.fromEntries(sessionActiveTargets.entries()),
    sessionRecentTargets: Object.fromEntries(sessionRecentTargets.entries()),
    readyGuests: Object.fromEntries(readyGuests.entries()),
    performanceLeases: performanceLeases.size,
    consoleEntries: Object.fromEntries(consoleEntries.entries()),
    networkEntries: Object.fromEntries(networkEntries.entries()),
    targetOwners: Object.fromEntries(
      Array.from(targetOwners.entries()).map(([currentKey, owner]) => [currentKey, { ...owner }]),
    ),
    guests: Array.from(guests.entries()).map(([key, value]) => ({
      key,
      sourceWindowID: Number(key.slice(0, key.indexOf(":"))),
      tabID: key.slice(key.indexOf(":") + 1),
      guestID: value.guestID,
      url: webContents.fromId(value.guestID)?.getURL?.() ?? null,
      title: webContents.fromId(value.guestID)?.getTitle?.() ?? null,
      destroyed: webContents.fromId(value.guestID)?.isDestroyed?.() ?? true,
      sessionKey: targetOwners.get(key)?.sessionKey ?? null,
      sessionID: targetOwners.get(key)?.sessionID ?? null,
    })),
  }),
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

function browserSession() {
  return session.fromPartition(BROWSER_PARTITION)
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
  return undefined
}

function clearWindowTab(sourceWindowID: number, tabID: string) {
  if (activeTabs.get(sourceWindowID) === tabID) {
    activeTabs.delete(sourceWindowID)
  }
  if (recentTabs.get(sourceWindowID) === tabID) {
    recentTabs.delete(sourceWindowID)
  }
}

function touchSessionTarget(sessionKey: string, currentKey: BrowserTabKey) {
  sessionRecentTargets.set(
    sessionKey,
    [currentKey, ...(sessionRecentTargets.get(sessionKey) ?? []).filter((item) => item !== currentKey)].slice(0, 8),
  )
}

function clearTargetOwner(currentKey: BrowserTabKey) {
  const owner = targetOwners.get(currentKey)
  if (!owner) return
  targetOwners.delete(currentKey)
  readyGuests.delete(currentKey)
  consoleEntries.delete(currentKey)
  networkEntries.delete(currentKey)
  if (sessionActiveTargets.get(owner.sessionKey) === currentKey) {
    sessionActiveTargets.delete(owner.sessionKey)
  }
  const next = (sessionRecentTargets.get(owner.sessionKey) ?? []).filter((item) => item !== currentKey)
  if (next.length === 0) {
    sessionRecentTargets.delete(owner.sessionKey)
    return
  }
  sessionRecentTargets.set(owner.sessionKey, next)
}

function ownerMatchesSession(sessionKey: string, owner: BrowserTargetOwner) {
  if (owner.sessionKey === sessionKey) return true
  const sessionID = sessionIDFromSessionKey(sessionKey)
  return !!sessionID && owner.sessionID === sessionID
}

function findSessionTargetBySessionID(sessionKey: string, map: Map<string, BrowserTabKey>) {
  const sessionID = sessionIDFromSessionKey(sessionKey)
  if (!sessionID) return
  for (const [key, value] of map.entries()) {
    if (sessionIDFromSessionKey(key) === sessionID) return value
  }
  return undefined
}

function findRecentTargetsBySessionID(sessionKey: string) {
  const sessionID = sessionIDFromSessionKey(sessionKey)
  if (!sessionID) return []
  for (const [key, value] of sessionRecentTargets.entries()) {
    if (sessionIDFromSessionKey(key) === sessionID) return value
  }
  return []
}

function sessionIDFromSessionKey(sessionKey: string) {
  const split = sessionKey.lastIndexOf("/")
  if (split < 0) return undefined
  return sessionKey.slice(split + 1) || undefined
}

function resolveOwnedTarget(currentKey: BrowserTabKey, readyOnly = false) {
  const current = guests.get(currentKey)
  if (!current) return undefined
  if (readyOnly && readyGuests.get(currentKey) !== current.guestID) return undefined
  const split = currentKey.indexOf(":")
  if (split < 0) return
  const sourceWindowID = Number(currentKey.slice(0, split))
  const tabID = currentKey.slice(split + 1)
  try {
    return getBrowserTarget({ sourceWindowID, tabID, readyOnly })
  } catch {
    clearTargetOwner(currentKey)
  }
  return undefined
}

function hasPendingOrBlockedTarget(currentKey: BrowserTabKey, readyOnly: boolean) {
  const current = guests.get(currentKey)
  if (!current) return true
  if (!readyOnly) return false
  return readyGuests.get(currentKey) !== current.guestID
}

function resolveTargetKeyForSession(sessionKey: string, tabID?: string) {
  if (tabID) {
    for (const [currentKey, owner] of targetOwners.entries()) {
      if (!ownerMatchesSession(sessionKey, owner)) continue
      const split = currentKey.indexOf(":")
      if (split >= 0 && currentKey.slice(split + 1) === tabID) return currentKey
    }
    return undefined
  }
  const active = sessionActiveTargets.get(sessionKey) ?? findSessionTargetBySessionID(sessionKey, sessionActiveTargets)
  if (active) return active
  const recent = sessionRecentTargets.get(sessionKey) ?? findRecentTargetsBySessionID(sessionKey)
  return recent[0]
}

function pushEntry<T>(store: Map<BrowserTabKey, T[]>, currentKey: BrowserTabKey, entry: T) {
  store.set(currentKey, [...(store.get(currentKey) ?? []), entry].slice(-ENTRY_LIMIT))
}

function pushPendingEntry<T>(store: Map<number, T[]>, guestID: number, entry: T) {
  store.set(guestID, [...(store.get(guestID) ?? []), entry].slice(-ENTRY_LIMIT))
}

function flushPendingGuestEntries(guestID: number, currentKey: BrowserTabKey) {
  const pendingConsole = pendingConsoleEntries.get(guestID)
  if (pendingConsole?.length) {
    consoleEntries.set(currentKey, [...(consoleEntries.get(currentKey) ?? []), ...pendingConsole].slice(-ENTRY_LIMIT))
    pendingConsoleEntries.delete(guestID)
  }
  const pendingNetwork = pendingNetworkEntries.get(guestID)
  if (pendingNetwork?.length) {
    networkEntries.set(currentKey, [...(networkEntries.get(currentKey) ?? []), ...pendingNetwork].slice(-ENTRY_LIMIT))
    pendingNetworkEntries.delete(guestID)
  }
}

function getBrowserTarget(input: {
  sourceWindowID: number
  tabID: string
  readyOnly?: boolean
}) {
  const guest = requireGuest(input)
  const owner = targetOwners.get(key(input.sourceWindowID, input.tabID))
  return {
    sourceWindowID: input.sourceWindowID,
    tabID: input.tabID,
    guest,
    sessionKey: owner?.sessionKey,
    sessionID: owner?.sessionID,
  }
}

function requireGuest(input: {
  sourceWindowID: number
  tabID: string
  readyOnly?: boolean
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
  const guestID = current?.guestID
  if (input.readyOnly && guestID !== undefined && readyGuests.get(key(input.sourceWindowID, input.tabID)) !== guestID) {
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
