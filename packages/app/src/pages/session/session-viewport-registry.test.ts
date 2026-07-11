import { afterEach, describe, expect, test } from "bun:test"
import {
  flushActiveSessionViewport,
  activateSessionViewSurface,
  installSessionViewportNavigationBridge,
  registerSessionViewport,
  registerSessionViewSurface,
  sessionViewSurfaceDiagnostics,
  transitionSessionViewSurface,
} from "./session-viewport-registry"

describe("session viewport registry", () => {
  let unregister: (() => void) | undefined
  let uninstall: (() => void) | undefined

  afterEach(() => {
    uninstall?.()
    uninstall = undefined
    unregister?.()
    unregister = undefined
  })

  test("flushes only the current session viewport", () => {
    const calls: string[] = []
    unregister = registerSessionViewport({
      key: "workspace/session-a",
      flush: () => calls.push("a"),
    })
    flushActiveSessionViewport()
    expect(calls).toEqual(["a"])
  })

  test("does not clear a newer registration", () => {
    const calls: string[] = []
    const removeFirst = registerSessionViewport({
      key: "workspace/session-a",
      flush: () => calls.push("a"),
    })
    unregister = registerSessionViewport({
      key: "workspace/session-b",
      flush: () => calls.push("b"),
    })
    removeFirst()
    flushActiveSessionViewport()
    expect(calls).toEqual(["b"])
  })

  test("flushes before programmatic history navigation", () => {
    const calls: string[] = []
    unregister = registerSessionViewport({
      key: "workspace/session-a",
      flush: () => calls.push("flush"),
    })
    uninstall = installSessionViewportNavigationBridge()

    window.history.pushState({}, "", "/session-a")

    expect(calls).toEqual(["flush"])
  })

  test("captures a visual snapshot before navigation flushes the viewport", () => {
    const calls: string[] = []
    unregister = registerSessionViewport({
      key: "workspace/session-a",
      snapshot: () => calls.push("snapshot"),
      flush: () => calls.push("flush"),
    })
    uninstall = installSessionViewportNavigationBridge()

    window.history.pushState({}, "", "/session-b")

    expect(calls).toEqual(["snapshot", "flush"])
  })

  test("activates a frozen side surface without freezing the visible main surface", () => {
    const calls: string[] = []
    const removeMain = registerSessionViewSurface({
      key: "workspace/main/main",
      sessionID: "main",
      surface: "main",
      phase: "active",
      freeze: () => calls.push("main-freeze"),
    })
    const removeSide = registerSessionViewSurface({
      key: "workspace/side/side-chat",
      sessionID: "side",
      surface: "side-chat",
      phase: "frozen",
      resume: () => calls.push("side-resume"),
    })

    transitionSessionViewSurface("workspace/side/side-chat", "active")

    expect(calls).toEqual(["side-resume"])
    expect(sessionViewSurfaceDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "workspace/main/main", phase: "active" }),
        expect.objectContaining({ key: "workspace/side/side-chat", phase: "active" }),
      ]),
    )

    removeSide()
    removeMain()
  })

  test("does not freeze the active side surface while swapping main timelines", () => {
    const calls: string[] = []
    const removeMain = registerSessionViewSurface({
      key: "workspace/main-a/main",
      sessionID: "main-a",
      surface: "main",
      phase: "active",
      freeze: () => calls.push("main-a-freeze"),
    })
    const removeNextMain = registerSessionViewSurface({
      key: "workspace/main-b/main",
      sessionID: "main-b",
      surface: "main",
      phase: "frozen",
      resume: () => calls.push("main-b-resume"),
    })
    const removeSide = registerSessionViewSurface({
      key: "workspace/side/side-chat",
      sessionID: "side",
      surface: "side-chat",
      phase: "active",
      freeze: () => calls.push("side-freeze"),
    })

    activateSessionViewSurface("workspace/main-b/main")

    expect(calls).toEqual(["main-a-freeze", "main-b-resume"])
    expect(sessionViewSurfaceDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "workspace/main-b/main", phase: "active" }),
        expect.objectContaining({ key: "workspace/side/side-chat", phase: "active" }),
      ]),
    )

    removeSide()
    removeNextMain()
    removeMain()
  })
})
