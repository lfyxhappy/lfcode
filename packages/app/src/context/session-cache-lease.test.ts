import { afterEach, describe, expect, test } from "bun:test"
import {
  acquireSessionCacheLease,
  filterUnleasedSessionCaches,
  hasSessionCacheLease,
} from "./session-cache-lease"

describe("session cache lease", () => {
  let release: (() => void) | undefined

  afterEach(() => release?.())

  test("protects an active session cache until its surface lease is released", () => {
    release = acquireSessionCacheLease({ sessionID: "ses_hot", owner: "dir/ses_hot/main" })
    expect(hasSessionCacheLease("ses_hot")).toBe(true)
    expect(filterUnleasedSessionCaches(["ses_cold", "ses_hot"])).toEqual(["ses_cold"])
    release()
    release = undefined
    expect(filterUnleasedSessionCaches(["ses_cold", "ses_hot"])).toEqual(["ses_cold", "ses_hot"])
  })
})
