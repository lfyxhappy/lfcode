import z from "zod"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { cancelBackgroundJob, reconcileBackgroundJob, reconcileRunningBackgroundJobs } from "@/background-job/control"
import { BackgroundJobPersistence } from "@/background-job/persistence"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"
import { AppFileSystem } from "@/filesystem"
import { Plugin } from "@/plugin"
import * as Tool from "./tool"
import DESCRIPTION from "./background_job.txt"
import { prepareShellExecution } from "./bash"

const Parameters = z.object({
  operation: z
    .enum(["start", "wait", "list", "get", "logs", "cancel", "reconcile"])
    .describe("Which background-job lifecycle or maintenance action to run."),
  session_id: z.string().optional().describe("Session id to inspect. This tool only allows the current session."),
  status: z.enum(["running", "completed", "failed", "cancelled"]).optional().describe("Optional status filter for operation=list."),
  job_id: z.string().optional().describe("Background job id for operation=get, operation=logs, operation=cancel, or operation=reconcile."),
  after_seq: z.number().int().nonnegative().optional().describe("For operation=logs, only return log rows after this sequence number."),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum number of rows to return. Defaults to 20 for logs and 10 for lists."),
  command: z.string().optional().describe("For operation=start, the shell command to run in the background."),
  description: z.string().optional().describe("For operation=start, a short description of the background shell job."),
  workdir: z.string().optional().describe("For operation=start, optional working directory. Defaults to the current session directory."),
  timeout_ms: z.number().int().positive().optional().describe("For operation=wait, optional maximum time to wait before returning."),
})

type BackgroundJobMetadata = {
  count: number
  truncated: boolean
  total?: number
  jobID?: string
  jobFound?: boolean
  sessionID?: string
  changed?: number | boolean
  stillRunning?: number
  unmanagedRunning?: number
  timedOut?: boolean
  status?: string
  result?: string
  nextAfterSeq?: number
}

const definition = {
  description: DESCRIPTION,
  parameters: Parameters,
  execute: (input: z.infer<typeof Parameters>, ctx: Tool.Context) =>
    Effect.gen(function* () {
      if (input.session_id && input.session_id !== ctx.sessionID) {
        return {
          title: "Background jobs: wrong session",
          output: "This tool can only inspect or control background jobs for the current session.",
          metadata: { count: 0, truncated: false },
        }
      }

      if (input.operation === "start") {
        if (!input.command || !input.description) {
          return {
            title: "Background jobs: missing command",
            output: "`operation=start` requires both `command` and `description`.",
            metadata: { count: 0, truncated: false },
          }
        }
        const runtime = shellBackgroundRuntimeRef.current
        if (!runtime) {
          throw new Error("Shell background runtime is not available in this process.")
        }
        const prepared = yield* prepareShellExecution(
          {
            command: input.command,
            workdir: input.workdir,
            background: true,
          },
          ctx,
        )
        const job = yield* runtime.start({
          sessionID: ctx.sessionID,
          title: input.description,
          command: input.command,
          cwd: prepared.cwd,
          env: prepared.env as Record<string, string>,
          shell: prepared.shell,
          shellName: prepared.shellName,
          source: "background_job",
          ...(ctx.messageID ? { sourceMessageID: ctx.messageID } : {}),
          ...(ctx.callID ? { sourceToolCallID: ctx.callID } : {}),
        })
        return {
          title: `Background job started: ${job.id}`,
          output: [
            `Started durable background shell job.`,
            `<job_id>${job.id}</job_id>`,
            `<status>${job.status}</status>`,
            `<cwd>${job.cwd}</cwd>`,
            `<title>${job.title}</title>`,
          ].join("\n"),
          metadata: {
            count: 1,
            jobID: job.id,
            jobFound: true,
            truncated: false,
          },
        }
      }

      if (input.operation === "list") {
        const sessionID = (input.session_id ?? ctx.sessionID) as typeof ctx.sessionID
        const jobs = BackgroundJobPersistence.list({
          sessionID,
          ...(input.status ? { status: input.status } : {}),
        })
        const limit = input.limit ?? 10
        const items = jobs.slice(0, limit)
        if (items.length === 0) {
          return {
            title: "Background jobs: 0 jobs",
            output: `No durable background jobs found for session ${sessionID}.`,
            metadata: { count: 0, sessionID, truncated: false },
          }
        }

        const lines = [
          `Background jobs for session ${sessionID}:`,
          "",
          ...items.flatMap((job) => [
            `### ${job.id}`,
            `- title: ${job.title}`,
            `- status: ${job.status}`,
            `- kind/source: ${job.kind} / ${job.source}`,
            `- cwd: ${job.cwd}`,
            `- created: ${new Date(job.createdAt).toISOString()}`,
            ...(job.completedAt ? [`- completed: ${new Date(job.completedAt).toISOString()}`] : []),
            ...(job.pid !== undefined ? [`- pid: ${job.pid}`] : []),
            ...(job.exitCode !== undefined ? [`- exitCode: ${job.exitCode}`] : []),
            ...(job.error ? [`- error: ${job.error}`] : []),
            "",
          ]),
          jobs.length > items.length ? `(Showing ${items.length} of ${jobs.length} jobs. Use a narrower filter or larger limit to continue.)` : "",
        ].filter(Boolean)

        return {
          title: `Background jobs: ${items.length}${jobs.length > items.length ? `/${jobs.length}` : ""}`,
          output: lines.join("\n"),
          metadata: {
            count: items.length,
            total: jobs.length,
            sessionID,
            truncated: jobs.length > items.length,
          },
        }
      }

      if (input.operation === "reconcile" && !input.job_id) {
        const results = reconcileRunningBackgroundJobs(`tool:${ctx.callID ?? "background_job"}`)
        const changed = results.filter((item) => item.ok && item.changed)
        const unmanaged = results.filter((item) => item.ok && item.code === "unmanaged_running")
        const running = results.filter((item) => item.ok && item.code === "still_running")
        return {
          title: `Background job reconcile: ${results.length} checked`,
          output: [
            `Checked ${results.length} running durable background jobs.`,
            `- reconciled missing process: ${changed.length}`,
            `- still running: ${running.length}`,
            `- unmanaged running: ${unmanaged.length}`,
            "",
            ...changed.flatMap((item) => ("job" in item ? [`### ${item.job.id}`, item.message, ""] : [])),
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            count: results.length,
            changed: changed.length,
            stillRunning: running.length,
            unmanagedRunning: unmanaged.length,
            truncated: false,
          },
        }
      }

      if (!input.job_id) {
        return {
          title: "Background jobs: missing job_id",
          output: `operation=${input.operation} requires a \`job_id\` argument.`,
          metadata: { count: 0, truncated: false },
        }
      }

      const job = BackgroundJobPersistence.load(input.job_id)
      if (!job) {
        return {
          title: "Background jobs: job not found",
          output: `No durable background job with id ${input.job_id}.`,
          metadata: { count: 0, jobFound: false, truncated: false },
        }
      }
      if (job.sessionID !== ctx.sessionID) {
        return {
          title: "Background jobs: wrong session",
          output: "This tool can only inspect or control background jobs for the current session.",
          metadata: { count: 0, jobFound: false, truncated: false },
        }
      }

      if (input.operation === "wait") {
        const runtime = shellBackgroundRuntimeRef.current
        if (!runtime) {
          throw new Error("Shell background runtime is not available in this process.")
        }
        const result = yield* runtime.wait({
          jobID: job.id,
          ...(input.timeout_ms !== undefined ? { timeoutMs: input.timeout_ms } : {}),
        })
        const latest = result.job ?? BackgroundJobPersistence.load(job.id) ?? job
        return {
          title: `Background job wait: ${latest.status}`,
          output: result.timedOut
            ? `Background job ${latest.id} is still ${latest.status} after waiting ${input.timeout_ms} ms.`
            : `Background job ${latest.id} finished with status ${latest.status}.`,
          metadata: {
            count: 1,
            jobFound: true,
            truncated: false,
            timedOut: result.timedOut,
            status: latest.status,
          },
        }
      }

      if (input.operation === "get") {
        return {
          title: `Background job ${job.id}`,
          output: [
            `<id>${job.id}</id>`,
            `<session_id>${job.sessionID}</session_id>`,
            `<title>${job.title}</title>`,
            `<status>${job.status}</status>`,
            `<kind>${job.kind}</kind>`,
            `<source>${job.source}</source>`,
            `<cwd>${job.cwd}</cwd>`,
            `<created_at>${new Date(job.createdAt).toISOString()}</created_at>`,
            ...(job.completedAt ? [`<completed_at>${new Date(job.completedAt).toISOString()}</completed_at>`] : []),
            ...(job.pid !== undefined ? [`<pid>${job.pid}</pid>`] : []),
            ...(job.exitCode !== undefined ? [`<exit_code>${job.exitCode}</exit_code>`] : []),
            ...(job.error ? [`<error>${job.error}</error>`] : []),
            ...(job.sourceMessageID ? [`<source_message_id>${job.sourceMessageID}</source_message_id>`] : []),
            ...(job.sourceToolCallID ? [`<source_tool_call_id>${job.sourceToolCallID}</source_tool_call_id>`] : []),
            `<payload>${JSON.stringify(job.payload, null, 2)}</payload>`,
            ...(job.recovery ? [`<recovery>${JSON.stringify(job.recovery, null, 2)}</recovery>`] : []),
            ...(job.metadata ? [`<metadata>${JSON.stringify(job.metadata, null, 2)}</metadata>`] : []),
          ].join("\n"),
          metadata: { count: 1, jobFound: true, truncated: false },
        }
      }

      if (input.operation === "cancel") {
        const runtime = shellBackgroundRuntimeRef.current
        const result =
          job.kind === "shell" && runtime
            ? yield* runtime.cancel(input.job_id, `tool:${ctx.callID ?? "background_job"}`)
            : cancelBackgroundJob(input.job_id, `tool:${ctx.callID ?? "background_job"}`)
        if (!result.ok) {
          return {
            title: "Background jobs: job not found",
            output: result.message,
            metadata: { count: 0, jobFound: false, truncated: false },
          }
        }

        return {
          title: `Background job cancel: ${result.code}`,
          output: [
            result.message,
            "",
            `<id>${result.job.id}</id>`,
            `<status>${result.job.status}</status>`,
            ...(result.job.pid !== undefined ? [`<pid>${result.job.pid}</pid>`] : []),
            ...(result.job.completedAt ? [`<completed_at>${new Date(result.job.completedAt).toISOString()}</completed_at>`] : []),
            ...(result.job.error ? [`<error>${result.job.error}</error>`] : []),
          ].join("\n"),
          metadata: {
            count: 1,
            jobFound: true,
            truncated: false,
            changed: result.changed,
            result: result.code,
          },
        }
      }

      if (input.operation === "reconcile") {
        const result = reconcileBackgroundJob(input.job_id, `tool:${ctx.callID ?? "background_job"}`)
        if (!result.ok) {
          return {
            title: "Background jobs: job not found",
            output: result.message,
            metadata: { count: 0, jobFound: false, truncated: false },
          }
        }

        return {
          title: `Background job reconcile: ${result.code}`,
          output: [
            result.message,
            "",
            `<id>${result.job.id}</id>`,
            `<status>${result.job.status}</status>`,
            ...(result.job.pid !== undefined ? [`<pid>${result.job.pid}</pid>`] : []),
            ...(result.job.completedAt ? [`<completed_at>${new Date(result.job.completedAt).toISOString()}</completed_at>`] : []),
            ...(result.job.error ? [`<error>${result.job.error}</error>`] : []),
          ].join("\n"),
          metadata: {
            count: 1,
            jobFound: true,
            truncated: false,
            changed: result.changed,
            result: result.code,
          },
        }
      }

      const limit = input.limit ?? 20
      const logs = BackgroundJobPersistence.listLogs({
        jobID: input.job_id,
        ...(input.after_seq !== undefined ? { afterSeq: input.after_seq } : {}),
      })
      const items = logs.slice(0, limit)
      if (items.length === 0) {
        return {
          title: `Background job logs ${job.id}: 0 rows`,
          output: `No durable logs found for background job ${job.id}.`,
          metadata: { count: 0, jobFound: true, truncated: false },
        }
      }

      return {
        title: `Background job logs ${job.id}: ${items.length}${logs.length > items.length ? `/${logs.length}` : ""}`,
        output: [
          `Logs for ${job.id} (${job.title}):`,
          "",
          ...items.flatMap((entry) => [
            `### seq ${entry.seq} · ${entry.stream} · ${new Date(entry.at).toISOString()}`,
            entry.text,
            "",
          ]),
          logs.length > items.length
            ? `(Showing ${items.length} of ${logs.length} rows. Continue with after_seq=${items[items.length - 1]!.seq}.)`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          count: items.length,
          total: logs.length,
          jobFound: true,
          truncated: logs.length > items.length,
          nextAfterSeq: logs.length > items.length ? items[items.length - 1]!.seq : undefined,
        },
      }
    }),
}

export const BackgroundJobTool = Tool.define(
  "background_job",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const plugin = yield* Plugin.Service
    const wrapped: Tool.DefWithoutID<typeof Parameters, BackgroundJobMetadata> = {
      ...definition,
      execute: (input: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        definition.execute(input, ctx).pipe(
          Effect.provideService(ChildProcessSpawner, spawner),
          Effect.provideService(AppFileSystem.Service, fs),
          Effect.provideService(Plugin.Service, plugin),
        ),
    }
    return wrapped
  }),
)
