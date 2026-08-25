import z from "zod"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"
import { cancelBackgroundJob, reconcileBackgroundJob, reconcileRunningBackgroundJobs } from "@/background-job/control"
import { BackgroundJobPersistence } from "@/background-job/persistence"
import { shellBackgroundRuntimeRef } from "@/background-job/runtime-ref"
import { AppFileSystem } from "@/filesystem"
import { Plugin } from "@/plugin"
import * as Tool from "./tool"
import DESCRIPTION from "./background_job.txt"

const Parameters = z.object({
  operation: z
    .enum(["wait", "list", "get", "logs", "cancel", "reconcile"])
    .describe("Which tracked shell-process action to run."),
  session_id: z.string().optional().describe("Session id to inspect. This tool only allows the current session."),
  status: z
    .enum(["running", "completed", "failed", "cancelled"])
    .optional()
    .describe("Optional status filter for operation=list."),
  job_id: z
    .string()
    .optional()
    .describe("Shell process id for operation=wait, operation=get, operation=logs, operation=cancel, or operation=reconcile."),
  after_seq: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("For operation=logs, only return log rows after this sequence number."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Maximum number of rows to return. Defaults to 20 for logs and 10 for lists."),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("For operation=wait, optional maximum time to wait before returning."),
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
  exitCode?: number
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
}

const WAIT_STDOUT_LIMIT = 8 * 1024
const WAIT_STDERR_LIMIT = 4 * 1024

const definition = {
  description: DESCRIPTION,
  parameters: Parameters,
  formatValidationError: formatShellProcessValidationError,
  execute: (input: z.infer<typeof Parameters>, ctx: Tool.Context) =>
    Effect.gen(function* () {
      if (input.session_id && input.session_id !== ctx.sessionID) {
        return {
          title: "Shell processes: wrong session",
          output: "This tool can only inspect or control shell processes for the current session.",
          metadata: { count: 0, truncated: false },
        }
      }

      if (input.operation === "list") {
        const sessionID = (input.session_id ?? ctx.sessionID) as typeof ctx.sessionID
        const gate = contextReadGate(ctx, "list", `shell-processes:${sessionID}`)
        const jobs = BackgroundJobPersistence.list({
          sessionID,
          ...(input.status ? { status: input.status } : {}),
        })
        const limit = input.limit ?? 10
        const items = jobs.slice(0, limit)
        completeCapabilityOperation(gate.auditID, `completed (${items.length} jobs)`, {
          sessions: [sessionID],
          jobs: items.map((job) => job.id),
        })
        if (items.length === 0) {
          return {
            title: "Shell processes: 0 processes",
            output: `No tracked shell processes found for session ${sessionID}.`,
            metadata: { count: 0, sessionID, truncated: false },
          }
        }

        const lines = [
          `Shell processes for session ${sessionID}:`,
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
          jobs.length > items.length
            ? `(Showing ${items.length} of ${jobs.length} jobs. Use a narrower filter or larger limit to continue.)`
            : "",
        ].filter(Boolean)

        return {
          title: `Shell processes: ${items.length}${jobs.length > items.length ? `/${jobs.length}` : ""}`,
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
        const results = reconcileRunningBackgroundJobs(`tool:${ctx.callID ?? "shell_process"}`)
        const changed = results.filter((item) => item.ok && item.changed)
        const unmanaged = results.filter((item) => item.ok && item.code === "unmanaged_running")
        const running = results.filter((item) => item.ok && item.code === "still_running")
        return {
          title: `Shell-process reconcile: ${results.length} checked`,
          output: [
            `Checked ${results.length} running shell processes.`,
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
          title: "Shell processes: missing job_id",
          output: `operation=${input.operation} requires a \`job_id\` argument.`,
          metadata: { count: 0, truncated: false },
        }
      }

      const job = BackgroundJobPersistence.load(input.job_id)
      if (!job) {
        return {
          title: "Shell processes: process not found",
          output: `No tracked shell process with id ${input.job_id}.`,
          metadata: { count: 0, jobFound: false, truncated: false },
        }
      }
      if (job.sessionID !== ctx.sessionID) {
        return {
          title: "Shell processes: wrong session",
          output: "This tool can only inspect or control shell processes for the current session.",
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
        const logs = result.timedOut ? [] : BackgroundJobPersistence.listLogs({ jobID: latest.id })
        const stdout = summarizeLogTail(logs, "stdout", WAIT_STDOUT_LIMIT)
        const stderr = summarizeLogTail(logs, "stderr", WAIT_STDERR_LIMIT)
        return {
          title: `Shell process wait: ${latest.status}`,
          output: result.timedOut
            ? `Shell process ${latest.id} is still ${latest.status} after waiting ${input.timeout_ms} ms; it was not terminated.`
            : [
                `Shell process ${latest.id} finished with status ${latest.status}.`,
                `Exit code: ${latest.exitCode ?? "unavailable"}.`,
                ...(latest.error ? [`Error: ${latest.error}`] : []),
                "",
                "stdout tail:",
                stdout.text || "(empty)",
                ...(stdout.truncated ? ["[stdout truncated; use shell_process logs for full output]"] : []),
                "",
                "stderr tail:",
                stderr.text || "(empty)",
                ...(stderr.truncated ? ["[stderr truncated; use shell_process logs for full output]"] : []),
              ].join("\n"),
          metadata: {
            count: 1,
            jobFound: true,
            jobID: latest.id,
            truncated: stdout.truncated || stderr.truncated,
            timedOut: result.timedOut,
            status: latest.status,
            ...(latest.exitCode !== undefined ? { exitCode: latest.exitCode } : {}),
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
          },
        }
      }

      if (input.operation === "get") {
        const gate = contextReadGate(ctx, "get", `background-job:${job.id}`)
        completeCapabilityOperation(gate.auditID, "completed (1 job)", {
          sessions: [job.sessionID],
          jobs: [job.id],
        })
        return {
          title: `Shell process ${job.id}`,
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
            ? yield* runtime.cancel(input.job_id, `tool:${ctx.callID ?? "shell_process"}`)
            : cancelBackgroundJob(input.job_id, `tool:${ctx.callID ?? "shell_process"}`)
        if (!result.ok) {
          return {
            title: "Shell processes: process not found",
            output: result.message,
            metadata: { count: 0, jobFound: false, truncated: false },
          }
        }

        return {
          title: `Shell process cancel: ${result.code}`,
          output: [
            result.message,
            "",
            `<id>${result.job.id}</id>`,
            `<status>${result.job.status}</status>`,
            ...(result.job.pid !== undefined ? [`<pid>${result.job.pid}</pid>`] : []),
            ...(result.job.completedAt
              ? [`<completed_at>${new Date(result.job.completedAt).toISOString()}</completed_at>`]
              : []),
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
        const result = reconcileBackgroundJob(input.job_id, `tool:${ctx.callID ?? "shell_process"}`)
        if (!result.ok) {
          return {
            title: "Shell processes: process not found",
            output: result.message,
            metadata: { count: 0, jobFound: false, truncated: false },
          }
        }

        return {
          title: `Shell process reconcile: ${result.code}`,
          output: [
            result.message,
            "",
            `<id>${result.job.id}</id>`,
            `<status>${result.job.status}</status>`,
            ...(result.job.pid !== undefined ? [`<pid>${result.job.pid}</pid>`] : []),
            ...(result.job.completedAt
              ? [`<completed_at>${new Date(result.job.completedAt).toISOString()}</completed_at>`]
              : []),
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

      const gate = contextReadGate(ctx, "logs", `shell-process:${job.id}`)
      const limit = input.limit ?? 20
      const logs = BackgroundJobPersistence.listLogs({
        jobID: input.job_id,
        ...(input.after_seq !== undefined ? { afterSeq: input.after_seq } : {}),
      })
      const items = logs.slice(0, limit)
      completeCapabilityOperation(gate.auditID, `completed (${items.length} log rows)`, {
        sessions: [job.sessionID],
        jobs: [job.id],
        logCount: items.length,
      })
      if (items.length === 0) {
        return {
          title: `Shell process logs ${job.id}: 0 rows`,
          output: `No durable logs found for shell process ${job.id}.`,
          metadata: { count: 0, jobFound: true, truncated: false },
        }
      }

      return {
        title: `Shell process logs ${job.id}: ${items.length}${logs.length > items.length ? `/${logs.length}` : ""}`,
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

function summarizeLogTail(
  logs: ReturnType<typeof BackgroundJobPersistence.listLogs>,
  stream: "stdout" | "stderr",
  limit: number,
) {
  const text = logs
    .filter((entry) => entry.stream === stream)
    .map((entry) => entry.text)
    .join("\n")
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length <= limit) return { text, truncated: false }
  const tail = bytes.subarray(bytes.length - limit)
  const boundary = tail.findIndex((byte) => (byte & 0b1100_0000) !== 0b1000_0000)
  return {
    text: tail.subarray(boundary === -1 ? tail.length : boundary).toString("utf8"),
    truncated: true,
  }
}

function formatShellProcessValidationError(error: z.ZodError) {
  const fields = [...new Set(error.issues.map((item) => item.path.join(".")).filter(Boolean))]
  return `[tool_error] ${JSON.stringify({
    type: "tool_error",
    tool: "shell_process",
    category: "schema",
    fields,
    message:
      "Use a top-level string operation. Start commands through shell; use this tool only to inspect an existing shell process.",
    example: {
      operation: "get",
      job_id: "job_...",
    },
  })}`
}

export const ShellProcessTool = Tool.define(
  "shell_process",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const plugin = yield* Plugin.Service
    const wrapped: Tool.DefWithoutID<typeof Parameters, BackgroundJobMetadata> = {
      ...definition,
      execute: (input: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        definition
          .execute(input, ctx)
          .pipe(
            Effect.provideService(ChildProcessSpawner, spawner),
            Effect.provideService(AppFileSystem.Service, fs),
            Effect.provideService(Plugin.Service, plugin),
          ),
    }
    return wrapped
  }),
)

function contextReadGate(ctx: Tool.Context, operation: "list" | "get" | "logs", target: string) {
  const gate = decideCapabilityOperation({
    caller: "tool:shell_process",
    capability: "context_read",
    risk: "read",
    source: "core",
    operation: "read",
    previewed: true,
    reversible: true,
    target,
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    reason: `Shell process ${operation}`,
  })
  requireCapabilityDecision(gate.decision)
  return gate
}
