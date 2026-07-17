import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { MessageID, SessionID } from "@/session/schema"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import { cancelBackgroundJob, reconcileBackgroundJob } from "@/background-job/control"
import { BackgroundJobPersistence } from "@/background-job/persistence"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"
import { NotFoundError } from "@/storage"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const BackgroundJobStatus = z.enum(["running", "completed", "failed", "cancelled"])
const BackgroundJobStream = z.enum(["stdout", "stderr", "system"])
const UnknownRecord = z.record(z.string(), z.unknown())

const BackgroundJobSummary = z
  .object({
    id: z.string(),
    sessionID: SessionID.zod,
    kind: z.string(),
    source: z.string(),
    title: z.string(),
    status: BackgroundJobStatus,
    cwd: z.string(),
    payload: UnknownRecord,
    env: z.record(z.string(), z.string()).optional(),
    pid: z.number().int().optional(),
    exitCode: z.number().int().optional(),
    error: z.string().optional(),
    sourceMessageID: MessageID.zod.optional(),
    sourceToolCallID: z.string().optional(),
    recovery: UnknownRecord.optional(),
    metadata: UnknownRecord.optional(),
    lastLogAt: z.number().int().optional(),
    completedAt: z.number().int().optional(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .meta({ ref: "BackgroundJobSummary" })

const BackgroundJobLog = z
  .object({
    id: z.number().int(),
    jobID: z.string(),
    sessionID: SessionID.zod,
    seq: z.number().int(),
    stream: BackgroundJobStream,
    text: z.string(),
    at: z.number().int(),
  })
  .meta({ ref: "BackgroundJobLog" })

const BackgroundJobCancel = z
  .object({
    code: z.enum(["already_terminal", "unmanaged_running", "cancelled", "reconciled_missing_process"]),
    changed: z.boolean(),
    message: z.string(),
    job: BackgroundJobSummary,
  })
  .meta({ ref: "BackgroundJobCancel" })

const BackgroundJobReconcile = z
  .object({
    code: z.enum(["already_terminal", "unmanaged_running", "still_running", "reconciled_missing_process"]),
    changed: z.boolean(),
    message: z.string(),
    job: BackgroundJobSummary,
  })
  .meta({ ref: "BackgroundJobReconcile" })

export const BackgroundJobRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List background jobs",
        description: "List durable background-job ledger entries, optionally filtered by session or status.",
        operationId: "backgroundJob.list",
        responses: {
          200: {
            description: "Background job summaries",
            content: {
              "application/json": {
                schema: resolver(BackgroundJobSummary.array()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          sessionID: SessionID.zod.optional(),
          status: BackgroundJobStatus.optional(),
        }),
      ),
      async (c) =>
        jsonRequest("BackgroundJobRoutes.list", c, function* () {
          const query = c.req.valid("query")
          const gate = contextReadGate(query.sessionID ? `background-jobs:${query.sessionID}` : "background-jobs")
          const jobs = BackgroundJobPersistence.list({
            ...(query.sessionID ? { sessionID: query.sessionID } : {}),
            ...(query.status ? { status: query.status } : {}),
          })
          completeCapabilityOperation(gate.auditID, `completed (${jobs.length} jobs)`, {
            ...(query.sessionID ? { sessions: [query.sessionID] } : {}),
            jobs: jobs.map((job) => job.id),
          })
          return jobs
        }),
    )
    .get(
      "/:jobID",
      describeRoute({
        summary: "Get background job",
        description: "Load one durable background-job ledger entry by ID.",
        operationId: "backgroundJob.get",
        responses: {
          200: {
            description: "Background job summary",
            content: {
              "application/json": {
                schema: resolver(BackgroundJobSummary),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          jobID: z.string().min(1),
        }),
      ),
      async (c) =>
        jsonRequest("BackgroundJobRoutes.get", c, function* () {
          const params = c.req.valid("param")
          const gate = contextReadGate(`background-job:${params.jobID}`)
          const job = BackgroundJobPersistence.load(params.jobID)
          completeCapabilityOperation(gate.auditID, job ? "completed (1 job)" : "completed (0 jobs)", {
            ...(job ? { sessions: [job.sessionID], jobs: [job.id] } : { jobs: [] }),
          })
          if (!job) throw new NotFoundError({ message: `Background job not found: ${params.jobID}` })
          return job
        }),
    )
    .get(
      "/:jobID/log",
      describeRoute({
        summary: "Get background job logs",
        description: "Read ordered durable log chunks for one background job.",
        operationId: "backgroundJob.logs",
        responses: {
          200: {
            description: "Background job logs",
            content: {
              "application/json": {
                schema: resolver(BackgroundJobLog.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          jobID: z.string().min(1),
        }),
      ),
      validator(
        "query",
        z.object({
          afterSeq: z.coerce.number().int().nonnegative().optional(),
        }),
      ),
      async (c) =>
        jsonRequest("BackgroundJobRoutes.logs", c, function* () {
          const params = c.req.valid("param")
          const query = c.req.valid("query")
          const gate = contextReadGate(`background-job:${params.jobID}`)
          const job = BackgroundJobPersistence.load(params.jobID)
          if (!job) {
            completeCapabilityOperation(gate.auditID, "completed (0 jobs)", { jobs: [] })
            throw new NotFoundError({ message: `Background job not found: ${params.jobID}` })
          }
          const logs = BackgroundJobPersistence.listLogs({
            jobID: params.jobID,
            ...(query.afterSeq !== undefined ? { afterSeq: query.afterSeq } : {}),
          })
          completeCapabilityOperation(gate.auditID, `completed (${logs.length} log rows)`, {
            sessions: [job.sessionID],
            jobs: [job.id],
            logCount: logs.length,
          })
          return logs
        }),
    )
    .post(
      "/:jobID/cancel",
      describeRoute({
        summary: "Cancel background job",
        description: "Attempt to cancel one durable background job using its tracked pid on the current host.",
        operationId: "backgroundJob.cancel",
        responses: {
          200: {
            description: "Background job cancel result",
            content: {
              "application/json": {
                schema: resolver(BackgroundJobCancel),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          jobID: z.string().min(1),
        }),
      ),
      async (c) =>
        jsonRequest("BackgroundJobRoutes.cancel", c, function* () {
          const params = c.req.valid("param")
          const job = BackgroundJobPersistence.load(params.jobID)
          if (!job) throw new NotFoundError({ message: `Background job not found: ${params.jobID}` })
          const runtime = shellBackgroundRuntimeRef.current
          const result =
            job.kind === "shell" && runtime
              ? yield* runtime.cancel(params.jobID, "instance-route")
              : cancelBackgroundJob(params.jobID, "instance-route")
          if (!result.ok) throw new NotFoundError({ message: result.message })
          return result
        }),
    )
    .post(
      "/:jobID/reconcile",
      describeRoute({
        summary: "Reconcile background job",
        description: "Re-check one durable running background job against its tracked pid on the current host.",
        operationId: "backgroundJob.reconcile",
        responses: {
          200: {
            description: "Background job reconcile result",
            content: {
              "application/json": {
                schema: resolver(BackgroundJobReconcile),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          jobID: z.string().min(1),
        }),
      ),
      async (c) =>
        jsonRequest("BackgroundJobRoutes.reconcile", c, function* () {
          const params = c.req.valid("param")
          const result = reconcileBackgroundJob(params.jobID, "instance-route")
          if (!result.ok) throw new NotFoundError({ message: result.message })
          return result
        }),
    ),
)

function contextReadGate(target: string) {
  const gate = decideCapabilityOperation({
    caller: "route:background-job",
    capability: "context_read",
    risk: "read",
    source: "core",
    operation: "read",
    previewed: true,
    reversible: true,
    target,
    reason: "Background job route read",
  })
  requireCapabilityDecision(gate.decision)
  return gate
}
