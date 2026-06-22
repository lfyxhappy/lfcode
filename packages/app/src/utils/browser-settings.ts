import type { BrowserCookieRecord } from "@lfcode-ai/shared/desktop-browser-management"
import { normalizeBrowserURL } from "@/pages/session/helpers"

export type BrowserBookmark = {
  id: string
  title: string
  url: string
  createdAt: number
  updatedAt: number
}

export function sortBrowserBookmarks(bookmarks: BrowserBookmark[]) {
  return [...bookmarks].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.title.localeCompare(b.title)
  })
}

export function upsertBrowserBookmark(
  bookmarks: BrowserBookmark[],
  input: {
    id: string
    title: string
    url: string
    now: number
  },
) {
  const normalized = normalizeBrowserURL(input.url)
  if (!normalized) return
  const current = bookmarks.find((item) => item.id === input.id)
  const next = {
    id: input.id,
    title: input.title.trim() || normalized,
    url: normalized,
    createdAt: current?.createdAt ?? input.now,
    updatedAt: input.now,
  } satisfies BrowserBookmark
  return sortBrowserBookmarks(
    current ? bookmarks.map((item) => (item.id === input.id ? next : item)) : [...bookmarks, next],
  )
}

export function removeBrowserBookmark(bookmarks: BrowserBookmark[], id: string) {
  return bookmarks.filter((item) => item.id !== id)
}

export function filterBrowserBookmarks(bookmarks: BrowserBookmark[], query: string) {
  const term = query.trim().toLowerCase()
  if (!term) return sortBrowserBookmarks(bookmarks)
  return sortBrowserBookmarks(
    bookmarks.filter((item) => [item.title, item.url].some((value) => value.toLowerCase().includes(term))),
  )
}

export function normalizeBrowserLoginOrigin(value: string) {
  const normalized = normalizeBrowserURL(value)
  if (!normalized) return
  try {
    const url = new URL(normalized)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    return url.origin
  } catch {
    return
  }
}

function cookieDomain(value: string) {
  return value.replace(/^\./, "").toLowerCase()
}

export function filterBrowserCookies(cookies: BrowserCookieRecord[], query: string) {
  const term = query.trim().toLowerCase()
  if (!term) return cookies
  return cookies.filter((item) => [item.name, cookieDomain(item.domain)].some((value) => value.includes(term)))
}

export function groupBrowserCookies(cookies: BrowserCookieRecord[]) {
  const grouped = new Map<string, BrowserCookieRecord[]>()
  for (const cookie of cookies) {
    const key = cookieDomain(cookie.domain)
    const current = grouped.get(key)
    if (current) {
      current.push(cookie)
      continue
    }
    grouped.set(key, [cookie])
  }
  return Array.from(grouped.entries())
    .map(([domain, items]) => ({
      domain,
      items: [...items].sort((a, b) => {
        if (a.name !== b.name) return a.name.localeCompare(b.name)
        return a.path.localeCompare(b.path)
      }),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain))
}
