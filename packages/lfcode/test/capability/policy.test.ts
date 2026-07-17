import { describe, expect, test } from "bun:test"
import { evaluateCapabilityPolicy, grantAllows } from "../../src/capability/policy"

describe("capability policy", () => {
  test("allows previewed reversible updates from trusted sources", () => {
    expect(
      evaluateCapabilityPolicy({
        risk: "install",
        source: "official",
        operation: "update",
        previewed: true,
        reversible: true,
      }),
    ).toBe("allow")
  })

  test("requires confirmation for destructive, credential, export, and release operations", () => {
    for (const input of [
      { risk: "credential" as const, operation: "read" as const },
      { risk: "destructive" as const, operation: "delete" as const },
      { risk: "release" as const, operation: "publish" as const },
      { risk: "modify" as const, operation: "export" as const },
    ]) {
      expect(evaluateCapabilityPolicy({ ...input, source: "official", previewed: true, reversible: true })).toBe("confirm")
    }
  })

  test("denies revoked, expired, and exhausted grants", () => {
    for (const grant of [
      { revoked: true },
      { expiresAt: 100 },
      { remainingBudget: 0 },
    ]) {
      expect(
        evaluateCapabilityPolicy({
          risk: "read",
          source: "core",
          operation: "read",
          previewed: false,
          reversible: true,
          grant: { id: "grant", capability: "read", scope: "project", source: "core", ...grant },
          now: 100,
        }),
      ).toBe("deny")
    }
    expect(grantAllows(undefined, 100)).toBe(true)
  })

  test("keeps unpreviewed changes in preview before confirmation", () => {
    expect(
      evaluateCapabilityPolicy({
        risk: "modify",
        source: "local",
        operation: "enable",
        previewed: false,
        reversible: true,
      }),
    ).toBe("preview")
  })
})
