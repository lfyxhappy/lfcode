import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "./server"
import { normalizeServerUrl } from "./server"

describe("normalizeServerUrl", () => {
  test("trims protocol and trailing slash", () => {
    expect(normalizeServerUrl(" https://example.com/ ")).toBe("https://example.com")
  })
})

