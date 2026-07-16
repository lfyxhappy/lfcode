import { describe, expect, test } from "bun:test"
import {
  browserAutofillOriginMatches,
  matchSavedBrowserLoginsByOrigin,
  normalizeSavedBrowserLoginOrigin,
  upsertSavedBrowserLoginRecords,
} from "./browser-management-core"

describe("browser management core", () => {
  test("normalizes saved login origins", () => {
    expect(normalizeSavedBrowserLoginOrigin("https://example.com/login")).toBe("https://example.com")
    expect(normalizeSavedBrowserLoginOrigin("http://localhost:3000/path")).toBe("http://localhost:3000")
    expect(normalizeSavedBrowserLoginOrigin("file:///tmp/demo.html")).toBeUndefined()
  })

  test("upserts saved logins by origin and username", () => {
    const current = [
      {
        id: "one",
        origin: "https://example.com",
        username: "alice",
        passwordEncrypted: "old",
        createdAt: 1,
        updatedAt: 1,
      },
    ]

    const next = upsertSavedBrowserLoginRecords(
      current,
      {
        origin: "https://example.com/login",
        username: "alice",
      },
      "new",
      20,
    )

    expect(next).toEqual([
      {
        id: "one",
        origin: "https://example.com",
        username: "alice",
        passwordEncrypted: "new",
        createdAt: 1,
        updatedAt: 20,
      },
    ])
  })

  test("matches exact origins only", () => {
    const current = [
      {
        id: "one",
        origin: "https://example.com",
        username: "alice",
        passwordEncrypted: "a",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "two",
        origin: "https://sub.example.com",
        username: "bob",
        passwordEncrypted: "b",
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    expect(matchSavedBrowserLoginsByOrigin(current, "https://example.com")).toEqual([current[0]])
  })

  test("authorizes autofill only for the sender's exact web origin", () => {
    expect(browserAutofillOriginMatches("https://example.com/login", "https://example.com")).toBe(true)
    expect(browserAutofillOriginMatches("https://sub.example.com/login", "https://example.com")).toBe(false)
    expect(browserAutofillOriginMatches("http://example.com/login", "https://example.com")).toBe(false)
    expect(browserAutofillOriginMatches("file:///tmp/login.html", "null")).toBe(false)
    expect(browserAutofillOriginMatches("not a url", "https://example.com")).toBe(false)
  })
})
