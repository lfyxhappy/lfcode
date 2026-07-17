import z from "zod"
import { Effect } from "effect"
import { BackgroundJobPersistence, type BackgroundJobSummary } from "@/background-job/persistence"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import { History } from "@/history"
import { Memory } from "@/memory"
import { SessionID } from "@/session/schema"
import { TaskRegistry } from "@/task/registry"
import { redactSensitiveText, redactSensitiveValue } from "@/util/redact"
import * as Tool from "./tool"

const Parameters = z.object({
  action: z.enum(["search", "session", "jobs", "job_logs"]),
  query: z.string().min(1).optional(),
  scope: z.enum(["project", "global"]).optional(),
  session_id: z.string().min(1).optional(),
  job_id: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  reason: z.string().min(1).describe("Reason for reading cross-project context; recorded in the audit trail."),
})

export const ContextBrokerTool = Tool.define(
  "context_broker",
  Effect.gen(function* () {
    const history = yield* History.Service
    const memory = yield* Memory.Service
    const tasks = yield* TaskRegistry.Service
    return {
      description:
        "Read a unified view of global or project history, Memory, session tasks, durable background jobs, and sanitized job logs. Every read is audited with its reason.",
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          validate(params)
          const gate = decideCapabilityOperation({
            caller: "tool:context_broker",
            capability: "context_read",
            risk: "read",
            source: "core",
            operation: "read",
            previewed: true,
            reversible: true,
            target: params.job_id ?? params.session_id ?? params.scope ?? "global-context",
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            reason: params.reason,
          })
          requireCapabilityDecision(gate.decision)

          if (params.action === "search") {
            const [historyHits, memoryHits] = yield* Effect.all([
              history.search({ query: params.query!, scope: params.scope, limit: params.limit }),
              memory.search({ query: params.query!, scope: params.scope === "project" ? "projects" : "global", limit: params.limit }),
            ])
            completeCapabilityOperation(gate.auditID, `completed (${historyHits.length} history, ${memoryHits.results.length} memory matches)`, {
              projects: [...new Set(historyHits.map((item) => item.project_id))],
              sessions: [...new Set(historyHits.map((item) => item.session_id))],
              paths: memoryHits.results.map((item) => item.path),
            })
            return result(params.reason, { history: historyHits, memory: memoryHits })
          }

          if (params.action === "session") {
            const sessionID = SessionID.make(params.session_id!)
            const [snapshot, sessionTasks] = yield* Effect.all([
              history.session({ session_id: params.session_id!, limit: params.limit, agent_scope: "all", include_boundaries: true }),
              tasks.list({ session_id: sessionID, include_terminal: true, include_archived: true }),
            ])
            const jobs = BackgroundJobPersistence.list({ sessionID })
            completeCapabilityOperation(gate.auditID, `completed (${snapshot.messages.length} messages, ${sessionTasks.length} tasks, ${jobs.length} jobs)`, {
              ...(snapshot.project_id ? { projects: [snapshot.project_id] } : {}),
              sessions: [snapshot.session_id],
              messages: snapshot.messages.map((item) => item.message_id),
              tasks: sessionTasks.map((item) => item.id),
              jobs: jobs.map((item) => item.id),
            })
            return result(params.reason, { session: snapshot, tasks: sessionTasks, jobs: jobs.map(sanitizeJob) })
          }

          if (params.action === "jobs") {
            const jobs = BackgroundJobPersistence.list(params.session_id ? { sessionID: SessionID.make(params.session_id) } : undefined).slice(0, params.limit ?? 50)
            completeCapabilityOperation(gate.auditID, `completed (${jobs.length} jobs)`, {
              sessions: [...new Set(jobs.map((item) => item.sessionID))],
              jobs: jobs.map((item) => item.id),
            })
            return result(params.reason, { jobs: jobs.map(sanitizeJob) })
          }

          const job = BackgroundJobPersistence.load(params.job_id!)
          const logs = BackgroundJobPersistence.listLogs({ jobID: params.job_id! }).slice(-(params.limit ?? 50)).map((item) => ({
            ...item,
            text: redactSensitiveText(item.text),
          }))
          completeCapabilityOperation(gate.auditID, `completed (${logs.length} log rows)`, {
            ...(job ? { sessions: [job.sessionID] } : {}),
            jobs: [params.job_id!],
          })
          return result(params.reason, { job: job ? sanitizeJob(job) : undefined, logs })
        }).pipe(Effect.orDie),
    }
  }),
)

function validate(params: z.infer<typeof Parameters>) {
  if (params.action === "search" && !params.query) throw new Error("context_broker search requires query")
  if (params.action === "session" && !params.session_id) throw new Error("context_broker session requires session_id")
  if (params.action === "job_logs" && !params.job_id) throw new Error("context_broker job_logs requires job_id")
}

function result(title: string, value: unknown) {
  return { title, output: JSON.stringify(value, null, 2), metadata: {} }
}

function sanitizeJob(job: BackgroundJobSummary) {
  const { env: _, payload, error, recovery, metadata, ...summary } = job
  return {
    ...summary,
    payload: redactSensitiveValue(payload),
    ...(error ? { error: redactSensitiveText(error) } : {}),
    ...(recovery ? { recovery: redactSensitiveValue(recovery) } : {}),
    ...(metadata ? { metadata: redactSensitiveValue(metadata) } : {}),
  }
}
