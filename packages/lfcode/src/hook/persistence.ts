import { and, asc, Database, desc, eq, inArray, lte, or } from "@/storage"
import { ulid } from "ulid"
import { HookDefinition, HookDefinitionInput, HookRun, type HookEvent } from "./schema"
import { HookDefinitionTable, HookRunTable } from "./hook.sql"

type DefinitionRow = typeof HookDefinitionTable.$inferSelect
type RunRow = typeof HookRunTable.$inferSelect

export function toHook(row: DefinitionRow) {
  return HookDefinition.parse({ id: row.id, name: row.name, description: row.description, enabled: row.enabled, scope: row.scope, projectID: row.project_id ?? undefined, sessionID: row.session_id ?? undefined, ownerSessionID: row.owner_session_id ?? undefined, events: row.events, matcher: row.matcher, handler: row.handler, lifetime: row.lifetime, expiry: row.expiry ?? undefined, remainingRuns: row.remaining_runs ?? null, expiredAt: row.expired_at ?? null, source: row.source, createdAt: row.time_created, updatedAt: row.time_updated })
}
function toRun(row: RunRow) { return HookRun.parse({ id: row.id, hookID: row.hook_id, sessionID: row.session_id ?? undefined, event: row.event, status: row.status, durationMs: row.duration_ms, summary: row.summary, input: row.input, output: row.output, timeCreated: row.time_created }) }

export function listHooks(input: { projectID?: string; sessionID?: string; includeExpired?: boolean } = {}) {
  return Database.use((db) => {
    const clauses = [input.includeExpired ? undefined : eq(HookDefinitionTable.enabled, true)].filter(Boolean) as ReturnType<typeof eq>[]
    if (input.projectID || input.sessionID) clauses.push(or(eq(HookDefinitionTable.scope, "global"), ...(input.projectID ? [eq(HookDefinitionTable.project_id, input.projectID)] : []), ...(input.sessionID ? [eq(HookDefinitionTable.session_id, input.sessionID)] : []))!)
    return db.select().from(HookDefinitionTable).where(clauses.length ? and(...clauses) : undefined).orderBy(asc(HookDefinitionTable.time_created)).all().map(toHook)
  })
}
export function getHook(id: string) { const row = Database.use((db) => db.select().from(HookDefinitionTable).where(eq(HookDefinitionTable.id, id)).get()); return row ? toHook(row) : undefined }
export function createHook(input: HookDefinitionInput) {
  const hook = HookDefinitionInput.parse(input); const now = Date.now(); const id = ulid(); const remaining = hook.lifetime === "temporary" ? hook.expiry?.kind === "once" ? 1 : hook.expiry?.kind === "max_runs" ? hook.expiry.maxRuns! : null : null
  Database.use((db) => db.insert(HookDefinitionTable).values({ id, name: hook.name, description: hook.description, enabled: hook.enabled, scope: hook.scope, project_id: hook.projectID ?? null, session_id: hook.sessionID ?? null, owner_session_id: hook.ownerSessionID ?? null, events: hook.events, matcher: hook.matcher, handler: hook.handler, lifetime: hook.lifetime, expiry: hook.expiry ?? null, remaining_runs: remaining, expired_at: null, source: hook.source, time_created: now, time_updated: now }).run())
  return getHook(id)!
}
export function updateHook(id: string, input: Partial<HookDefinitionInput>) { const current = getHook(id); if (!current) return; const next = HookDefinitionInput.parse({ ...current, ...input, handler: input.handler ?? current.handler, events: input.events ?? current.events, expiry: input.expiry ?? current.expiry }); Database.use((db) => db.update(HookDefinitionTable).set({ name: next.name, description: next.description, enabled: next.enabled, scope: next.scope, project_id: next.projectID ?? null, session_id: next.sessionID ?? null, owner_session_id: next.ownerSessionID ?? null, events: next.events, matcher: next.matcher, handler: next.handler, lifetime: next.lifetime, expiry: next.expiry ?? null, source: next.source, time_updated: Date.now() }).where(eq(HookDefinitionTable.id, id)).run()); return getHook(id) }
export function deleteHook(id: string) { const existing = getHook(id); if (!existing) return false; Database.use((db) => db.delete(HookDefinitionTable).where(eq(HookDefinitionTable.id, id)).run()); return true }
export function setHookEnabled(id: string, enabled: boolean) { Database.use((db) => db.update(HookDefinitionTable).set({ enabled, time_updated: Date.now() }).where(eq(HookDefinitionTable.id, id)).run()); return getHook(id) }
export function cleanupSessionHooks(sessionID: string) {
  return Database.transaction((db) => {
    const sessionHooks = db.select({ id: HookDefinitionTable.id }).from(HookDefinitionTable).where(and(eq(HookDefinitionTable.scope, "session"), eq(HookDefinitionTable.session_id, sessionID))).all()
    if (sessionHooks.length) db.delete(HookDefinitionTable).where(inArray(HookDefinitionTable.id, sessionHooks.map((row) => row.id))).run()
    db.update(HookDefinitionTable).set({ enabled: false, expired_at: Date.now(), time_updated: Date.now() }).where(and(eq(HookDefinitionTable.owner_session_id, sessionID), eq(HookDefinitionTable.lifetime, "temporary"))).run()
    return sessionHooks.length
  })
}
export function claimHook(id: string, now = Date.now()) {
  return Database.transaction((db) => {
    const row = db.select().from(HookDefinitionTable).where(eq(HookDefinitionTable.id, id)).get(); const expiry = row?.expiry as { kind?: string; expiresAt?: number } | null | undefined; if (!row || !row.enabled || row.expired_at || (expiry?.kind === "expires_at" && expiry.expiresAt! <= now)) { if (row && !row.expired_at) db.update(HookDefinitionTable).set({ enabled: false, expired_at: now, time_updated: now }).where(eq(HookDefinitionTable.id, id)).run(); return false }
    if (row.remaining_runs === null) return true
    if (row.remaining_runs <= 0) return false
    const remaining = row.remaining_runs - 1
    db.update(HookDefinitionTable).set({ remaining_runs: remaining, enabled: remaining > 0, expired_at: remaining === 0 ? now : null, time_updated: now }).where(and(eq(HookDefinitionTable.id, id), eq(HookDefinitionTable.remaining_runs, row.remaining_runs))).run()
    return true
  })
}
export function recordHookRun(input: Omit<HookRun, "id" | "timeCreated">) { const run = { ...input, id: ulid(), timeCreated: Date.now() }; Database.transaction((db) => { db.insert(HookRunTable).values({ id: run.id, hook_id: run.hookID, session_id: run.sessionID ?? null, event: run.event, status: run.status, duration_ms: run.durationMs, summary: run.summary, input: run.input, output: run.output, time_created: run.timeCreated }).run(); db.delete(HookRunTable).where(lte(HookRunTable.time_created, Date.now() - 30 * 86400000)).run(); const old = db.select({ id: HookRunTable.id }).from(HookRunTable).where(eq(HookRunTable.hook_id, run.hookID)).orderBy(desc(HookRunTable.time_created)).all().slice(2000); if (old.length) db.delete(HookRunTable).where(inArray(HookRunTable.id, old.map((item) => item.id))).run() }); return HookRun.parse(run) }
export function listHookRuns(input: { hookID?: string; sessionID?: string; limit?: number } = {}) { return Database.use((db) => { const where = input.hookID ? eq(HookRunTable.hook_id, input.hookID) : input.sessionID ? eq(HookRunTable.session_id, input.sessionID) : undefined; return db.select().from(HookRunTable).where(where).orderBy(desc(HookRunTable.time_created)).limit(input.limit ?? 100).all().map(toRun) }) }
export function clearHookRuns(hookID?: string) { const count = listHookRuns(hookID ? { hookID, limit: 100_000 } : { limit: 100_000 }).length; Database.use((db) => db.delete(HookRunTable).where(hookID ? eq(HookRunTable.hook_id, hookID) : undefined).run()); return count }
