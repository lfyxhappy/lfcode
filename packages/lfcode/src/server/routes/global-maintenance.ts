import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Maintenance } from "@/maintenance"
import { MaintenanceScheduler } from "@/maintenance"
import { execute } from "@/maintenance/runner"
import { applyCandidate } from "@/maintenance/candidate-apply"
import * as Session from "@/session/session"
import { SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage"
import { lazy } from "@/util/lazy"
import { errors } from "../error"

const StageStatus = z.enum(["idle", "running", "completed", "failed", "skipped"])
const RunStatus = z.enum(["running", "completed", "failed"])
const CandidateStatus = z.enum(["new", "approved", "rejected", "applied", "stale"])
const CandidateKind = z.enum([
  "skill_update",
  "skill_create",
  "command_update",
  "command_create",
  "agent_update",
  "agent_create",
  "skip",
])

const Run = z
  .object({
    id: z.string(),
    dayKey: z.string(),
    jobKind: z.enum(["full", "dream", "distill"]),
    triggerSource: z.enum(["automatic", "manual", "scheduler"]),
    status: RunStatus,
    dreamStatus: StageStatus,
    distillStatus: StageStatus,
    projectIDs: z.array(z.string()),
    summary: z.string().optional(),
    errorExcerpt: z.string().optional(),
    candidateCount: z.number().int(),
    dreamRecordCount: z.number().int(),
    startedAt: z.number().int(),
    finishedAt: z.number().int().optional(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .meta({ ref: "MaintenanceRun" })

const Candidate = z
  .object({
    id: z.string(),
    runID: z.string(),
    candidateKind: CandidateKind,
    targetKind: z.enum(["skill", "command", "agent", "none"]),
    targetPath: z.string().optional(),
    evidence: z.array(z.string()),
    confidence: z.number().int().min(0).max(100),
    proposedSummary: z.string(),
    proposedPatchPreview: z.string().optional(),
    status: CandidateStatus,
    appliedAt: z.number().int().optional(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .meta({ ref: "MaintenanceCandidate" })

const CandidateEvent = z
  .object({
    id: z.string(),
    candidateID: z.string(),
    action: z.enum(["approved", "rejected", "stale", "applied", "apply_failed"]),
    detail: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.number().int(),
  })
  .meta({ ref: "MaintenanceCandidateEvent" })

const State = z
  .object({
    status: z.enum(["running", "failed", "pending-review", "healthy"]),
    latest: Run.optional(),
    pendingCandidates: z.number().int(),
  })
  .meta({ ref: "MaintenanceState" })

const SchedulerState = z
  .object({
    supported: z.boolean(),
    registered: z.boolean(),
    taskName: z.string(),
    markerPath: z.string(),
    lastRunTime: z.string().optional(),
    lastResult: z.string().optional(),
    error: z.string().optional(),
  })
  .meta({ ref: "MaintenanceSchedulerState" })

export const MaintenanceRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get memory maintenance state",
        operationId: "global.maintenance.get",
        responses: { 200: { description: "Memory maintenance state", content: { "application/json": { schema: resolver(State) } } } },
      }),
      (c) => c.json(Maintenance.status()),
    )
    .get(
      "/runs",
      describeRoute({
        summary: "List memory maintenance runs",
        operationId: "global.maintenance.runs",
        responses: { 200: { description: "Maintenance runs", content: { "application/json": { schema: resolver(Run.array()) } } } },
      }),
      validator("query", z.object({ limit: z.coerce.number().int().min(1).max(100).optional() })),
      (c) => c.json(Maintenance.listRuns(c.req.valid("query").limit)),
    )
    .get(
      "/scheduler",
      describeRoute({
        summary: "Get Windows memory maintenance scheduler state",
        operationId: "global.maintenance.scheduler.get",
        responses: { 200: { description: "Maintenance scheduler state", content: { "application/json": { schema: resolver(SchedulerState) } } } },
      }),
      async (c) => c.json(await MaintenanceScheduler.status()),
    )
    .post(
      "/scheduler",
      describeRoute({
        summary: "Enable or disable the Windows memory maintenance scheduler",
        operationId: "global.maintenance.scheduler.update",
        responses: { 200: { description: "Maintenance scheduler state", content: { "application/json": { schema: resolver(SchedulerState) } } }, ...errors(400) },
      }),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => c.json(await (c.req.valid("json").enabled ? MaintenanceScheduler.enable() : MaintenanceScheduler.disable())),
    )
    .get(
      "/candidates",
      describeRoute({
        summary: "List maintenance review candidates",
        operationId: "global.maintenance.candidates",
        responses: { 200: { description: "Maintenance candidates", content: { "application/json": { schema: resolver(Candidate.array()) } } } },
      }),
      validator("query", z.object({ status: CandidateStatus.optional(), limit: z.coerce.number().int().min(1).max(100).optional() })),
      (c) => {
        const query = c.req.valid("query")
        return c.json(Maintenance.listCandidates({ statuses: query.status ? [query.status] : undefined, limit: query.limit }))
      },
    )
    .post(
      "/candidates/:candidateID/status",
      describeRoute({
        summary: "Approve or reject a maintenance candidate",
        operationId: "global.maintenance.candidate.update",
        responses: { 200: { description: "Candidate status updated", content: { "application/json": { schema: resolver(Candidate) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ candidateID: z.string().min(1) })),
      validator("json", z.object({ status: z.enum(["approved", "rejected", "stale"]) })),
      (c) => {
        return c.json(Maintenance.updateCandidateStatus({ id: c.req.valid("param").candidateID, status: c.req.valid("json").status }))
      },
    )
    .get(
      "/candidates/:candidateID/history",
      describeRoute({
        summary: "List maintenance candidate review and application history",
        operationId: "global.maintenance.candidate.history",
        responses: { 200: { description: "Candidate history", content: { "application/json": { schema: resolver(CandidateEvent.array()) } } } },
      }),
      validator("param", z.object({ candidateID: z.string().min(1) })),
      (c) => c.json(Maintenance.listCandidateHistory(c.req.valid("param").candidateID)),
    )
    .post(
      "/candidates/:candidateID/apply",
      describeRoute({
        summary: "Apply an approved maintenance skill candidate",
        operationId: "global.maintenance.candidate.apply",
        responses: { 200: { description: "Applied maintenance candidate", content: { "application/json": { schema: resolver(Candidate) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ candidateID: z.string().min(1) })),
      async (c) => c.json(await applyCandidate(c.req.valid("param").candidateID)),
    )
    .post(
      "/run",
      describeRoute({
        summary: "Start a manual Dream, Distill, or full maintenance run",
        operationId: "global.maintenance.run",
        responses: { 200: { description: "Maintenance run", content: { "application/json": { schema: resolver(Run) } } }, ...errors(400, 404) },
      }),
      validator("json", z.object({ sessionID: SessionID.zod, jobKind: z.enum(["full", "dream", "distill"]).default("full") })),
      async (c) => {
        const input = c.req.valid("json")
        const row = await AppRuntime.runPromise(Session.Service.use((sessions) => sessions.get(input.sessionID)))
        if (!row) throw new NotFoundError({ message: "Session not found" })
        const run = await Instance.provide({
          directory: row.directory,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
          async fn() {
            const claimed = Maintenance.claim({ jobKind: input.jobKind, triggerSource: "manual", projectIDs: [row.projectID] })
            if (claimed.status !== "claimed") {
              throw new Error(claimed.status === "already-running" ? "Memory maintenance is already running" : "Memory maintenance could not start")
            }
            void AppRuntime.runPromise(execute({ run: claimed.run, sessionID: row.id }))
            return claimed.run
          },
        })
        return c.json(run)
      },
    ),
)
