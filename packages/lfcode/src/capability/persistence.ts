import { and, desc, eq, gt } from "../storage"
import { Database } from "../storage"
import { redactSensitiveText, redactSensitiveValue } from "../util/redact"
import { CapabilityAuditTable, CapabilityGrantTable } from "./capability.sql"
import type { CapabilityDecision, CapabilityGrant, CapabilityOperation, CapabilitySource } from "./policy"

export type CapabilityAuditEvent = {
  id: string
  caller: string
  capability: string
  operation: CapabilityOperation
  decision: CapabilityDecision
  target?: string
  projectID?: string
  sessionID?: string
  messageID?: string
  reason?: string
  metadata?: Record<string, unknown>
  result?: string
  rollback?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

function sanitize(value: unknown): unknown {
  return redactSensitiveValue(value)
}

function redactAuditText(value: string) {
  return redactSensitiveText(value)
    .replace(
      /([?&][^=\s&]*(?:authorization|token|api[_-]?key|apikey|key|secret|password|credential)[^=\s&]*=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(api[_-]?key|access[_-]?token|authorization|token|password|secret|cookie|credential)\b(\s*(?:=|:)\s*)([^\s,;"']+)/gi,
      "$1$2[REDACTED]",
    )
}

function toGrant(row: typeof CapabilityGrantTable.$inferSelect): CapabilityGrant {
  return {
    id: row.id,
    capability: row.capability,
    scope: row.scope,
    source: row.source as CapabilitySource,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.remaining_budget === null ? {} : { remainingBudget: row.remaining_budget }),
    ...(row.revoked ? { revoked: true } : {}),
  }
}

function toAudit(row: typeof CapabilityAuditTable.$inferSelect): CapabilityAuditEvent {
  return {
    id: row.id,
    caller: row.caller,
    capability: row.capability,
    operation: row.operation as CapabilityOperation,
    decision: row.decision as CapabilityDecision,
    ...(row.target ? { target: row.target } : {}),
    ...(row.project_id ? { projectID: row.project_id } : {}),
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    ...(row.message_id ? { messageID: row.message_id } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
    ...(row.result ? { result: row.result } : {}),
    ...(row.rollback ? { rollback: row.rollback } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

const saveGrant = (grant: CapabilityGrant) =>
  Database.transaction((db) => {
    db.insert(CapabilityGrantTable)
      .values({
        id: grant.id,
        capability: grant.capability,
        scope: grant.scope,
        source: grant.source,
        expires_at: grant.expiresAt ?? null,
        remaining_budget: grant.remainingBudget ?? null,
        revoked: grant.revoked ?? false,
      })
      .onConflictDoUpdate({
        target: CapabilityGrantTable.id,
        set: {
          capability: grant.capability,
          scope: grant.scope,
          source: grant.source,
          expires_at: grant.expiresAt ?? null,
          remaining_budget: grant.remainingBudget ?? null,
          revoked: grant.revoked ?? false,
        },
      })
      .run()
    const row = db.select().from(CapabilityGrantTable).where(eq(CapabilityGrantTable.id, grant.id)).get()
    if (!row) throw new Error(`Capability grant ${grant.id} missing after save`)
    return toGrant(row)
  })

const loadGrant = (id: string) =>
  Database.use((db) => {
    const row = db.select().from(CapabilityGrantTable).where(eq(CapabilityGrantTable.id, id)).get()
    return row ? toGrant(row) : undefined
  })

const listGrants = (input?: { capability?: string; activeOnly?: boolean; now?: number }) =>
  Database.use((db) => {
    const now = input?.now ?? Date.now()
    const clauses = [
      ...(input?.capability ? [eq(CapabilityGrantTable.capability, input.capability)] : []),
      ...(input?.activeOnly ? [eq(CapabilityGrantTable.revoked, false)] : []),
    ]
    const rows =
      clauses.length === 0
        ? db.select().from(CapabilityGrantTable).orderBy(desc(CapabilityGrantTable.time_created)).all()
        : db.select().from(CapabilityGrantTable).where(and(...clauses)).orderBy(desc(CapabilityGrantTable.time_created)).all()
    return rows.filter((row) => !input?.activeOnly || row.expires_at === null || row.expires_at > now).map(toGrant)
  })

const revokeGrant = (id: string) =>
  Database.transaction((db) => {
    db.update(CapabilityGrantTable).set({ revoked: true }).where(eq(CapabilityGrantTable.id, id)).run()
    const row = db.select().from(CapabilityGrantTable).where(eq(CapabilityGrantTable.id, id)).get()
    return row ? toGrant(row) : undefined
  })

export type CapabilityBudgetReservation =
  | { status: "unrestricted" }
  | { status: "reserved"; grant: CapabilityGrant }
  | { status: "denied"; reason: "revoked" | "expired" | "exhausted" }

const reserveBudget = (input: { capability: string; now?: number }): CapabilityBudgetReservation =>
  Database.transaction((db) => {
    const row = db
      .select()
      .from(CapabilityGrantTable)
      .where(eq(CapabilityGrantTable.capability, input.capability))
      .orderBy(desc(CapabilityGrantTable.time_created))
      .get()
    if (!row) return { status: "unrestricted" }
    if (row.revoked) return { status: "denied", reason: "revoked" }
    if (row.expires_at !== null && row.expires_at <= (input.now ?? Date.now())) return { status: "denied", reason: "expired" }
    if (row.remaining_budget === null) return { status: "reserved", grant: toGrant(row) }
    if (row.remaining_budget <= 0) return { status: "denied", reason: "exhausted" }

    db.update(CapabilityGrantTable)
      .set({ remaining_budget: row.remaining_budget - 1 })
      .where(and(eq(CapabilityGrantTable.id, row.id), gt(CapabilityGrantTable.remaining_budget, 0)))
      .run()
    const next = db.select().from(CapabilityGrantTable).where(eq(CapabilityGrantTable.id, row.id)).get()
    if (!next || next.remaining_budget === null || next.remaining_budget !== row.remaining_budget - 1) {
      return { status: "denied", reason: "exhausted" }
    }
    return { status: "reserved", grant: toGrant(next) }
  })

const refundBudget = (id: string) =>
  Database.transaction((db) => {
    const row = db.select().from(CapabilityGrantTable).where(eq(CapabilityGrantTable.id, id)).get()
    if (!row || row.remaining_budget === null) return row ? toGrant(row) : undefined
    db.update(CapabilityGrantTable)
      .set({ remaining_budget: row.remaining_budget + 1 })
      .where(eq(CapabilityGrantTable.id, id))
      .run()
    const next = db.select().from(CapabilityGrantTable).where(eq(CapabilityGrantTable.id, id)).get()
    return next ? toGrant(next) : undefined
  })

const recordAudit = (input: Omit<CapabilityAuditEvent, "createdAt" | "updatedAt">) =>
  Database.transaction((db) => {
    db.insert(CapabilityAuditTable)
      .values({
        id: input.id,
        caller: input.caller,
        capability: input.capability,
        operation: input.operation,
        decision: input.decision,
        target: input.target ? redactAuditText(input.target) : null,
        project_id: input.projectID ?? null,
        session_id: input.sessionID ?? null,
        message_id: input.messageID ?? null,
        reason: input.reason ? redactAuditText(input.reason) : null,
        metadata: input.metadata ? (sanitize(input.metadata) as Record<string, unknown>) : null,
        result: input.result ? redactAuditText(input.result) : null,
        rollback: input.rollback ? (sanitize(input.rollback) as Record<string, unknown>) : null,
      })
      .run()
    const row = db.select().from(CapabilityAuditTable).where(eq(CapabilityAuditTable.id, input.id)).get()
    if (!row) throw new Error(`Capability audit ${input.id} missing after record`)
    return toAudit(row)
  })

const completeAudit = (input: { id: string; result: string; rollback?: Record<string, unknown> }) =>
  Database.transaction((db) => {
    db.update(CapabilityAuditTable)
      .set({
        result: redactAuditText(input.result),
        ...(input.rollback ? { rollback: sanitize(input.rollback) as Record<string, unknown> } : {}),
      })
      .where(eq(CapabilityAuditTable.id, input.id))
      .run()
    const row = db.select().from(CapabilityAuditTable).where(eq(CapabilityAuditTable.id, input.id)).get()
    return row ? toAudit(row) : undefined
  })

const listAudit = (input?: { capability?: string; sessionID?: string; projectID?: string; limit?: number }) =>
  Database.use((db) => {
    const clauses = [
      ...(input?.capability ? [eq(CapabilityAuditTable.capability, input.capability)] : []),
      ...(input?.sessionID ? [eq(CapabilityAuditTable.session_id, input.sessionID)] : []),
      ...(input?.projectID ? [eq(CapabilityAuditTable.project_id, input.projectID)] : []),
    ]
    const query = db.select().from(CapabilityAuditTable)
    const rows =
      clauses.length === 0
        ? query.orderBy(desc(CapabilityAuditTable.time_created)).all()
        : query.where(and(...clauses)).orderBy(desc(CapabilityAuditTable.time_created)).all()
    return rows.slice(0, input?.limit ?? 100).map(toAudit)
  })

export const CapabilityPersistence = {
  saveGrant,
  loadGrant,
  listGrants,
  revokeGrant,
  reserveBudget,
  refundBudget,
  recordAudit,
  completeAudit,
  listAudit,
}
