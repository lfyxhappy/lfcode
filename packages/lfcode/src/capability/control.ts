import { randomUUID } from "crypto"
import { cancelBackgroundJob } from "@/background-job/control"
import { BackgroundJobPersistence } from "@/background-job/persistence"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { SessionRunState } from "@/session/run-state"
import { SessionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage"
import { CapabilityPersistence } from "./persistence"
import type { CapabilityGrant } from "./policy"

export type CapabilityStopInput =
  | { scope: "global"; caller: string; reason?: string }
  | { scope: "project"; projectID: string; caller: string; reason?: string }
  | { scope: "session"; sessionID: string; caller: string; reason?: string }

export type CapabilityStopResult = {
  scope: CapabilityStopInput["scope"]
  sessions: { id: string; projectID: string; status: "requested" | "skipped" | "failed"; error?: string }[]
  jobs: { id: string; status: "cancelled" | "unchanged" | "failed"; error?: string }[]
}

export async function stopCapabilityWork(input: CapabilityStopInput): Promise<CapabilityStopResult> {
  const sessions = matchingSessions(input)
  const audit = CapabilityPersistence.recordAudit({
    id: `capability_${randomUUID()}`,
    caller: input.caller,
    capability: "agent_os",
    operation: "stop",
    decision: "allow",
    target: input.scope,
    ...("projectID" in input ? { projectID: input.projectID } : {}),
    ...("sessionID" in input ? { sessionID: input.sessionID } : {}),
    reason: input.reason,
    metadata: { requestedSessions: sessions.length },
    result: "pending",
  })
  const sessionIDs = new Set(sessions.map((item) => item.id))
  const [sessionResults, jobResults] = await Promise.all([
    Promise.all(sessions.map((session) => cancelLoadedSession(session))),
    Promise.all(
      BackgroundJobPersistence.list({ status: "running" })
        .filter((job) => sessionIDs.has(job.sessionID))
        .map((job) => cancelTrackedJob(job.id)),
    ),
  ])
  const result = { scope: input.scope, sessions: sessionResults, jobs: jobResults }
  CapabilityPersistence.completeAudit({
    id: audit.id,
    result: `stop requested for ${sessionResults.filter((item) => item.status === "requested").length} sessions and ${jobResults.filter((item) => item.status === "cancelled").length} jobs`,
  })
  return result
}

export function disableCapability(input: { capability: string; caller: string; scope?: string; reason?: string }): CapabilityGrant {
  const grant = CapabilityPersistence.saveGrant({
    id: `capability_disable_${randomUUID()}`,
    capability: input.capability,
    scope: input.scope ?? "global",
    source: "core",
    revoked: true,
  })
  CapabilityPersistence.recordAudit({
    id: `capability_${randomUUID()}`,
    caller: input.caller,
    capability: input.capability,
    operation: "disable",
    decision: "allow",
    target: grant.scope,
    reason: input.reason,
    metadata: { grantID: grant.id, disabled: true },
    result: "capability disabled",
  })
  return grant
}

function matchingSessions(input: CapabilityStopInput) {
  return Database.use((db) => {
    if (input.scope === "global") {
      return db.select({ id: SessionTable.id, projectID: SessionTable.project_id, directory: SessionTable.directory }).from(SessionTable).all()
    }
    if (input.scope === "project") {
      return db
        .select({ id: SessionTable.id, projectID: SessionTable.project_id, directory: SessionTable.directory })
        .from(SessionTable)
        .where(eq(SessionTable.project_id, input.projectID as never))
        .all()
    }
    return db
      .select({ id: SessionTable.id, projectID: SessionTable.project_id, directory: SessionTable.directory })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID as never))
      .all()
  })
}

async function cancelLoadedSession(session: { id: string; projectID: string; directory: string }) {
  if (!Instance.has(session.directory)) return { id: session.id, projectID: session.projectID, status: "skipped" as const }
  try {
    await Instance.provide({
      directory: session.directory,
      fn: () => AppRuntime.runPromise(SessionRunState.Service.use((service) => service.cancel(session.id as never))),
    })
    return { id: session.id, projectID: session.projectID, status: "requested" as const }
  } catch (error) {
    return {
      id: session.id,
      projectID: session.projectID,
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function cancelTrackedJob(jobID: string) {
  try {
    const result = cancelBackgroundJob(jobID, "capability-stop")
    if (!result.ok) return { id: jobID, status: "failed" as const, error: result.message }
    return { id: jobID, status: result.changed ? ("cancelled" as const) : ("unchanged" as const) }
  } catch (error) {
    return { id: jobID, status: "failed" as const, error: error instanceof Error ? error.message : String(error) }
  }
}
