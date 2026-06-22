import { describe, expect, test } from "bun:test"
import { filterBrowserCookies, groupBrowserCookies, normalizeBrowserLoginOrigin, upsertBrowserBookmark } from "./browser-settings"

describe("browser settings helpers", () => {
  test("upserts bookmarks with normalized urls and updated sort order", () => {
    const bookmarks = upsertBrowserBookmark([], {
      id: "one",
      title: "Example",
      url: "example.com",
      now: 10,
    })
    expect(bookmarks).toEqual([
      {
        id: "one",
        title: "Example",
        url: "https://example.com",
        createdAt: 10,
        updatedAt: 10,
      },
    ])

    const updated = upsertBrowserBookmark(bookmarks ?? [], {
      id: "one",
      title: "",
      url: "https://example.com/path",
      now: 20,
    })
    expect(updated?.[0]).toEqual({
      id: "one",
      title: "https://example.com/path",
      url: "https://example.com/path",
      createdAt: 10,
      updatedAt: 20,
    })
  })

  test("filters and groups cookies by normalized domain", () => {
    const cookies = [
      { name: "session", domain: ".example.com", path: "/", secure: true, httpOnly: true, sameSite: "lax", session: false, expirationDate: 100 },
      { name: "prefs", domain: "app.example.com", path: "/", secure: false, httpOnly: false, sameSite: "lax", session: true, expirationDate: null },
    ]
    expect(filterBrowserCookies(cookies, "sess")).toEqual([cookies[0]])
    expect(groupBrowserCookies(cookies)).toEqual([
      { domain: "app.example.com", items: [cookies[1]] },
      { domain: "example.com", items: [cookies[0]] },
    ])
  })

  test("normalizes saved login origins to exact http/https origins", () => {
    expect(normalizeBrowserLoginOrigin("https://example.com/login?q=1")).toBe("https://example.com")
    expect(normalizeBrowserLoginOrigin("http://localhost:3000/path")).toBe("http://localhost:3000")
    expect(normalizeBrowserLoginOrigin("file:///tmp/demo.html")).toBeUndefined()
  })
})
