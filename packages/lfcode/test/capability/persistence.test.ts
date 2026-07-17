import { describe, expect, test } from "bun:test"
import { CapabilityPersistence } from "../../src/capability/persistence"
import { decideCapabilityOperation } from "../../src/capability/gate"

describe("CapabilityPersistence", () => {
  test("persists grants and excludes revoked or expired entries from active lists", () => {
    const suffix = `${Date.now()}_grant`
    CapabilityPersistence.saveGrant({
      id: `grant_${suffix}`,
      capability: "plugin_manage",
      scope: "global",
      source: "official",
      remainingBudget: 3,
    })
    CapabilityPersistence.saveGrant({
      id: `expired_${suffix}`,
      capability: "plugin_manage",
      scope: "global",
      source: "official",
      expiresAt: 100,
    })

    expect(CapabilityPersistence.loadGrant(`grant_${suffix}`)).toMatchObject({ remainingBudget: 3 })
    expect(CapabilityPersistence.listGrants({ capability: "plugin_manage", activeOnly: true, now: 100 })).toContainEqual(
      expect.objectContaining({ id: `grant_${suffix}` }),
    )
    expect(CapabilityPersistence.listGrants({ capability: "plugin_manage", activeOnly: true, now: 100 })).not.toContainEqual(
      expect.objectContaining({ id: `expired_${suffix}` }),
    )

    expect(CapabilityPersistence.revokeGrant(`grant_${suffix}`)).toMatchObject({ revoked: true })
    expect(CapabilityPersistence.listGrants({ capability: "plugin_manage", activeOnly: true })).not.toContainEqual(
      expect.objectContaining({ id: `grant_${suffix}` }),
    )
  })

  test("records a sanitized audit trail with lifecycle context", () => {
    const suffix = `${Date.now()}_audit`
    const audit = CapabilityPersistence.recordAudit({
      id: `audit_${suffix}`,
      caller: "agent:main",
      capability: `plugin_manage_${suffix}`,
      operation: "install",
      decision: "allow",
      target: "https://example.test/plugin?token=abcdefghijk",
      projectID: "project-a",
      sessionID: "session-a",
      messageID: "message-a",
      reason: "install with api_key=abcdefghijk",
      metadata: {
        apiKey: "abcdefghijk",
        nested: { authorization: "Bearer abcdefghijk" },
        safe: "preserve",
      },
      rollback: { password: "abcdefghijk", snapshot: "plugin-backup" },
    })

    expect(audit.target).toContain("[REDACTED]")
    expect(audit.reason).toContain("[REDACTED]")
    expect(audit.metadata).toEqual({ apiKey: "[REDACTED]", nested: { authorization: "[REDACTED]" }, safe: "preserve" })
    expect(audit.rollback).toEqual({ password: "[REDACTED]", snapshot: "plugin-backup" })

    const completed = CapabilityPersistence.completeAudit({
      id: audit.id,
      result: "installed token=abcdefghijk",
      rollback: { secret: "abcdefghijk", action: "uninstall" },
    })
    expect(completed?.result).toContain("[REDACTED]")
    expect(completed?.rollback).toEqual({ secret: "[REDACTED]", action: "uninstall" })
    expect(CapabilityPersistence.listAudit({ sessionID: "session-a" })).toContainEqual(
      expect.objectContaining({ id: audit.id, projectID: "project-a", messageID: "message-a" }),
    )
  })

  test("applies the latest matching grant to management decisions without a caller-supplied grant ID", () => {
    const suffix = `${Date.now()}_gate`
    CapabilityPersistence.saveGrant({
      id: `grant_${suffix}`,
      capability: `plugin_manage_${suffix}`,
      scope: "global",
      source: "official",
      revoked: true,
    })

    expect(
      decideCapabilityOperation({
        caller: "test",
        capability: `plugin_manage_${suffix}`,
        risk: "install",
        source: "official",
        operation: "install",
        previewed: true,
        reversible: true,
      }).decision,
    ).toBe("deny")
  })

  test("prefers a matching session or project grant over the global grant", () => {
    const suffix = `${Date.now()}_scoped`
    const capability = `runtime_manage_${suffix}`
    CapabilityPersistence.saveGrant({
      id: `global_${suffix}`,
      capability,
      scope: "global",
      source: "core",
      revoked: true,
    })
    CapabilityPersistence.saveGrant({
      id: `project_${suffix}`,
      capability,
      scope: "project:project-a",
      source: "core",
    })
    CapabilityPersistence.saveGrant({
      id: `session_${suffix}`,
      capability,
      scope: "session:session-a",
      source: "core",
      revoked: true,
    })

    const input = {
      caller: "test",
      capability,
      risk: "install" as const,
      source: "official" as const,
      operation: "install" as const,
      previewed: true,
      reversible: true,
    }
    expect(decideCapabilityOperation({ ...input, projectID: "project-a" }).decision).toBe("allow")
    expect(decideCapabilityOperation({ ...input, projectID: "project-a", sessionID: "session-a" }).decision).toBe("deny")
    expect(decideCapabilityOperation({ ...input, projectID: "project-b" }).decision).toBe("deny")
  })

  test("reserves and refunds a finite background execution budget atomically", () => {
    const suffix = `${Date.now()}_budget`
    const id = `grant_${suffix}`
    CapabilityPersistence.saveGrant({
      id,
      capability: `background_job_${suffix}`,
      scope: "global",
      source: "core",
      remainingBudget: 1,
    })

    expect(CapabilityPersistence.reserveBudget({ capability: `background_job_${suffix}` })).toEqual(
      expect.objectContaining({ status: "reserved", grant: expect.objectContaining({ id, remainingBudget: 0 }) }),
    )
    expect(CapabilityPersistence.reserveBudget({ capability: `background_job_${suffix}` })).toEqual({
      status: "denied",
      reason: "exhausted",
    })
    expect(CapabilityPersistence.refundBudget(id)).toEqual(expect.objectContaining({ remainingBudget: 1 }))
    expect(CapabilityPersistence.reserveBudget({ capability: `background_job_${suffix}` })).toEqual(
      expect.objectContaining({ status: "reserved", grant: expect.objectContaining({ remainingBudget: 0 }) }),
    )
  })
})
