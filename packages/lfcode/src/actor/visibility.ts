import { SYSTEM_SPAWNED_AGENT_TYPES } from "@/agent/config"
import { sql, type SQL } from "@/storage"
import type { SQLWrapper } from "drizzle-orm"

/**
 * User-hidden actors retain their generated actor ID on every persisted
 * message. This intentionally does not depend on the live ActorRegistry:
 * copied/forked sessions no longer have the original registry row, but must
 * remain private.
 */
const USER_HIDDEN_SYSTEM_AGENT_TYPES = new Set(["context-reviewer"])

export function isUserHiddenSystemActorID(actorID: string | undefined) {
  if (!actorID) return false
  return Array.from(USER_HIDDEN_SYSTEM_AGENT_TYPES).some(
    (agent) => actorID === agent || actorID.startsWith(`${agent}-`),
  )
}

/**
 * Durable data paths must apply the same boundary as API and UI visibility.
 * The agent ID is retained on copied messages, unlike an ephemeral registry row.
 */
export function userVisibleActorClause(actorID: SQL | SQLWrapper) {
  return sql`(${actorID} <> 'context-reviewer' and ${actorID} not like 'context-reviewer-%')`
}

export function isUserVisibleActor(input: { agent?: string; actorID?: string; visible?: boolean }) {
  if (input.visible === false) return false
  if (input.agent && SYSTEM_SPAWNED_AGENT_TYPES.has(input.agent)) return false
  return !isUserHiddenSystemActorID(input.actorID)
}
