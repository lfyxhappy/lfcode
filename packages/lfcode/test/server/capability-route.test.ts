import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

describe("capability routes", () => {
  test("persists grants, applies policy, and records redacted audit events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const headers = { "x-lfcode-directory": tmp.path }
        const jsonHeaders = { ...headers, "content-type": "application/json" }
        const catalog = await Server.Default().app.request("/capability", { headers })
        expect(catalog.status).toBe(200)
        expect(await catalog.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "tool:read", kind: "tool" })]))

        const grant = await Server.Default().app.request("/capability/grant", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            id: "grant-route",
            capability: "plugin_manage",
            scope: "global",
            source: "official",
            remainingBudget: 1,
          }),
        })
        expect(grant.status).toBe(200)

        const decision = await Server.Default().app.request("/capability/decision", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            auditID: "audit-route",
            caller: "agent:main",
            capability: "plugin_manage",
            risk: "install",
            source: "official",
            operation: "install",
            previewed: true,
            reversible: true,
            grantID: "grant-route",
            reason: "token=abcdefghijk",
            metadata: { apiKey: "abcdefghijk" },
          }),
        })
        expect(decision.status).toBe(200)
        expect(await decision.json()).toEqual(
          expect.objectContaining({
            decision: "allow",
            audit: expect.objectContaining({ reason: "token=[REDACTED]", metadata: expect.objectContaining({ apiKey: "[REDACTED]" }) }),
          }),
        )

        const audits = await Server.Default().app.request("/capability/audit?capability=plugin_manage", { headers })
        expect(audits.status).toBe(200)
        expect(await audits.json()).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: "audit-route", caller: "agent:main" })]),
        )

        const revoked = await Server.Default().app.request("/capability/grant/grant-route/revoke", { method: "POST", headers })
        expect(revoked.status).toBe(200)
        expect(await revoked.json()).toEqual(expect.objectContaining({ revoked: true }))
      },
    })
  })
})
