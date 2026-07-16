import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { describe, expect, test } from "bun:test"
import {
  createSessionStorageKey,
  decodeSessionStorageDirectory,
  normalizeSessionDirSlug,
  normalizeSessionStorageKey,
} from "./session-key"

describe("session key helpers", () => {
  test("normalizes windows path slugs to a single canonical directory key", () => {
    const backslash = base64Encode("C:\\算法\\小应用\\闲聊")
    const slash = base64Encode("C:/算法/小应用/闲聊")

    expect(normalizeSessionDirSlug(backslash)).toBe(slash)
    expect(normalizeSessionDirSlug(slash)).toBe(slash)
  })

  test("leaves non-directory strings untouched", () => {
    expect(normalizeSessionDirSlug("dir")).toBe("dir")
    expect(normalizeSessionStorageKey("dir/ses_123")).toBe("dir/ses_123")
  })

  test("builds canonical storage keys for session and workspace state", () => {
    const backslash = base64Encode("C:\\算法\\小应用\\闲聊")
    const slash = base64Encode("C:/算法/小应用/闲聊")

    expect(createSessionStorageKey(backslash, "ses_123")).toBe(`${slash}/ses_123`)
    expect(createSessionStorageKey(backslash)).toBe(slash)
  })

  test("normalizes persisted keys that already include a session id", () => {
    const backslash = base64Encode("C:\\算法\\小应用\\闲聊")
    const slash = base64Encode("C:/算法/小应用/闲聊")

    expect(normalizeSessionStorageKey(`${backslash}/ses_123`)).toBe(`${slash}/ses_123`)
    expect(normalizeSessionStorageKey(`${slash}/ses_123`)).toBe(`${slash}/ses_123`)
  })

  test("decodes persisted directory slugs back to normalized workspace paths", () => {
    const backslash = base64Encode("C:\\算法\\小应用\\闲聊")

    expect(decodeSessionStorageDirectory(backslash)).toBe("C:/算法/小应用/闲聊")
  })
})
