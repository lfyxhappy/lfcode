import { afterEach, describe, expect, test } from "bun:test"
import type { VirtualizerHandle } from "virtua/solid"
import { hasSessionCacheLease } from "@/context/session-cache-lease"
import {
  clearSessionVirtualCaches,
  readSessionVirtualCache,
  rememberSessionVirtualCache,
  sessionVirtualCacheDiagnostics,
} from "./session-virtual-cache"

describe("session virtual cache", () => {
  afterEach(clearSessionVirtualCaches)

  test("reuses a cache only for the identical virtual turn window", () => {
    const cache = { sizes: [120, 80] } as unknown as VirtualizerHandle["cache"]
    rememberSessionVirtualCache({
      key: "dir/session/main",
      sessionID: "session",
      turnIDs: ["turn-1", "turn-2"],
      revision: "1",
      cache,
    })

    expect(readSessionVirtualCache({ key: "dir/session/main", turnIDs: ["turn-1", "turn-2"], revision: "1" })).toBe(
      cache,
    )
    expect(
      readSessionVirtualCache({ key: "dir/session/main", turnIDs: ["turn-0", "turn-1", "turn-2"], revision: "1" }),
    ).toBeUndefined()
    expect(
      readSessionVirtualCache({ key: "dir/session/main", turnIDs: ["turn-1", "turn-2"], revision: "2" }),
    ).toBeUndefined()
  })

  test("keeps only the eight most recently stored caches", () => {
    for (let index = 0; index < 9; index++) {
      rememberSessionVirtualCache({
        key: `dir/session-${index}/main`,
        sessionID: `session-${index}`,
        turnIDs: [`turn-${index}`],
        revision: "1",
        cache: { sizes: [index] } as unknown as VirtualizerHandle["cache"],
      })
    }

    expect(sessionVirtualCacheDiagnostics().entries).toHaveLength(8)
    expect(readSessionVirtualCache({ key: "dir/session-0/main", turnIDs: ["turn-0"], revision: "1" })).toBeUndefined()
  })

  test("keeps the message cache leased until its virtual measurements are cooled", () => {
    rememberSessionVirtualCache({
      key: "dir/session/main",
      sessionID: "session",
      turnIDs: ["turn-1"],
      revision: "1",
      cache: { sizes: [120] } as unknown as VirtualizerHandle["cache"],
    })

    expect(hasSessionCacheLease("session")).toBe(true)
    clearSessionVirtualCaches()
    expect(hasSessionCacheLease("session")).toBe(false)
  })
})
