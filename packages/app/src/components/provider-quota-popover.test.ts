import { describe, expect, test } from "bun:test"
import { quotaAuthProviderID, supportedQuotaProviderIDs } from "./provider-quota-capability"

describe("provider quota capability registry", () => {
  test("only exposes connected providers with registered quota support", () => {
    expect(supportedQuotaProviderIDs([{ id: "openai" }, { id: "opencode-go" }, { id: "minimax" }, { id: "minimax-cn-coding-plan" }, { id: "a6api" }])).toEqual(["opencode-go", "minimax", "minimax-cn-coding-plan"])
  })

  test("reuses the canonical auth entry for provider aliases", () => {
    expect(quotaAuthProviderID("minimax-cn-coding-plan")).toBe("minimax")
    expect(quotaAuthProviderID("opencode-go")).toBe("opencode-go")
  })
})
