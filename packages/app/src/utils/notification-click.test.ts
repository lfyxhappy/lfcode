import { afterEach, describe, expect, test } from "bun:test"
import { handleNotificationClick, setNavigate } from "./notification-click"

describe("notification click", () => {
  afterEach(() => {
    setNavigate(undefined)
  })

  test("navigates via registered navigate function", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick("/abc/session/123")
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("does not navigate when href is missing", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick(undefined)
    expect(calls).toEqual([])
  })

  test("queues an internal href until navigate is registered", () => {
    const calls: string[] = []
    const open = window.open
    const opened: string[] = []
    Object.defineProperty(window, "open", { configurable: true, value: (url: string) => opened.push(url) })
    handleNotificationClick("/abc/session/123")
    expect(opened).toEqual([])
    setNavigate((href) => calls.push(href))
    expect(calls).toEqual(["/abc/session/123"])
    Object.defineProperty(window, "open", { configurable: true, value: open })
  })

  test("keeps only the latest early internal notification", () => {
    const calls: string[] = []
    handleNotificationClick("/first/session/1")
    handleNotificationClick("/last/session/2")
    setNavigate((href) => calls.push(href))
    expect(calls).toEqual(["/last/session/2"])
  })

  test("opens an external notification target outside the router", () => {
    const open = window.open
    const calls: string[] = []
    const navigated: string[] = []
    setNavigate((href) => navigated.push(href))
    Object.defineProperty(window, "open", { configurable: true, value: (href: string) => calls.push(href) })
    handleNotificationClick("https://example.com")
    expect(calls).toEqual(["https://example.com"])
    expect(navigated).toEqual([])
    Object.defineProperty(window, "open", { configurable: true, value: open })
  })

  test("uses the desktop external opener when it is available", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "api")
    const calls: string[] = []
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { openExternalLink: (href: string) => calls.push(href) },
    })
    handleNotificationClick("https://example.com/docs")
    expect(calls).toEqual(["https://example.com/docs"])
    if (descriptor) Object.defineProperty(window, "api", descriptor)
    else Reflect.deleteProperty(window, "api")
  })

  test("clears an unmounted navigator without discarding a queued route", () => {
    const first: string[] = []
    const dispose = setNavigate((href) => first.push(href))
    dispose()
    handleNotificationClick("/abc/session/123")
    const second: string[] = []
    setNavigate((href) => second.push(href))
    expect(first).toEqual([])
    expect(second).toEqual(["/abc/session/123"])
  })
})
