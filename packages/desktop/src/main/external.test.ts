import { describe, expect, test } from "bun:test"

import { createOpenExternal } from "./external-core"

describe("openExternal", () => {
  test("does not throw on shell failure", async () => {
    const logs: Array<{ message: string; data: { url: string; error: unknown } }> = []
    const openExternal = createOpenExternal({
      openExternal: async () => {
        throw new Error("boom")
      },
      logError: (message, data) => {
        logs.push({ message, data })
      },
    })

    await expect(openExternal("https://example.com")).resolves.toBeUndefined()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.message).toBe("failed to open external link")
    expect(logs[0]?.data.url).toBe("https://example.com")
  })
})
