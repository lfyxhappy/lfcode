import { Database, eq, sql } from "@/storage"
import { SessionContextStatusTable } from "./context-status.sql"
import { Snapshot, shouldPersistSnapshot, snapshotMetrics } from "./context-snapshot"

export function saveSnapshot(input: Snapshot) {
  const value = Snapshot.parse(input)
  if (!shouldPersistSnapshot(value)) return
  const previous = Database.use((db) =>
    db
      .select({ measured_at: SessionContextStatusTable.measured_at })
      .from(SessionContextStatusTable)
      .where(eq(SessionContextStatusTable.session_id, value.sessionID))
      .get(),
  )
  // Snapshot writes can finish out of order when a provider stream and the
  // next request overlap. Never let an older measurement roll the panel back.
  if (previous && previous.measured_at > value.measuredAt) return
  const metrics = snapshotMetrics(value.activeContextTokens, value.contextWindowTokens)
  Database.use((db) =>
    db
      .insert(SessionContextStatusTable)
      .values({
        session_id: value.sessionID,
        agent_id: value.agentID,
        active_context_tokens: value.activeContextTokens,
        context_window_tokens: value.contextWindowTokens,
        context_percentage: metrics.contextPercentage,
        remaining_context_tokens: metrics.remainingContextTokens,
        provider_id: value.providerID as typeof SessionContextStatusTable.$inferInsert.provider_id,
        model_id: value.modelID as typeof SessionContextStatusTable.$inferInsert.model_id,
        measured_at: value.measuredAt,
        measurement_source: value.measurementSource,
      } as typeof SessionContextStatusTable.$inferInsert)
      .onConflictDoUpdate({
        target: SessionContextStatusTable.session_id,
        set: {
          agent_id: value.agentID,
          active_context_tokens: value.activeContextTokens,
          context_window_tokens: value.contextWindowTokens,
          context_percentage: metrics.contextPercentage,
          remaining_context_tokens: metrics.remainingContextTokens,
          provider_id: value.providerID as typeof SessionContextStatusTable.$inferInsert.provider_id,
          model_id: value.modelID as typeof SessionContextStatusTable.$inferInsert.model_id,
          measured_at: value.measuredAt,
          measurement_source: value.measurementSource,
        },
        // The pre-read above avoids needless work, while this predicate makes
        // the ordering guarantee atomic when two fibers write concurrently.
        setWhere: sql`${SessionContextStatusTable.measured_at} <= excluded.measured_at`,
      })
      .run(),
  )
}
