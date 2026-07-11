import { afterEach, describe, expect, test } from "bun:test"
import {
  clearSessionTimelineVisualSnapshots,
  readSessionTimelineVisualSnapshot,
  rememberSessionTimelineVisualSnapshot,
  sessionTimelineVisualSnapshotDiagnostics,
} from "./session-timeline-visual-cache"

describe("session timeline visual cache", () => {
  afterEach(clearSessionTimelineVisualSnapshots)

  test("restores an inert visual handoff only for an identical surface revision", () => {
    const root = document.createElement("div")
    root.innerHTML = '<div id="message-a">A</div>'
    root.scrollTop = 42
    rememberSessionTimelineVisualSnapshot({
      key: "dir/session/main",
      sessionID: "session",
      revision: "1",
      turnIDs: ["turn-a"],
      root,
    })

    const snapshot = readSessionTimelineVisualSnapshot({ key: "dir/session/main", revision: "1" })
    expect(snapshot?.root.getAttribute("inert")).toBe("")
    expect(snapshot?.root.querySelector("#message-a")).toBeNull()
    expect(snapshot?.root.textContent).toBe("A")
    expect(readSessionTimelineVisualSnapshot({ key: "dir/session/main", revision: "2" })).toBeUndefined()
    expect(readSessionTimelineVisualSnapshot({ key: "dir/session/main", revision: "1" })).toBeDefined()
    expect(sessionTimelineVisualSnapshotDiagnostics()).toMatchObject({ hits: 2, misses: 1 })
  })

  test("keeps no more than eight visual handoffs", () => {
    const root = document.createElement("div")
    for (let index = 0; index < 9; index++) {
      rememberSessionTimelineVisualSnapshot({
        key: `dir/session-${index}/main`,
        sessionID: `session-${index}`,
        revision: "1",
        turnIDs: [`turn-${index}`],
        root,
      })
    }

    expect(sessionTimelineVisualSnapshotDiagnostics().entries).toHaveLength(8)
    expect(readSessionTimelineVisualSnapshot({ key: "dir/session-0/main", revision: "1" })).toBeUndefined()
  })
})
