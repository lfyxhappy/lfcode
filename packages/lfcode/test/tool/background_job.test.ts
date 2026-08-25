import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Agent } from "../../src/agent/agent"
import { defaultLayer as ShellBackgroundRuntimeLayer, Service as ShellBackgroundRuntime } from "../../src/background-job/runtime"
import { BackgroundJobPersistence } from "../../src/background-job/persistence"
import { CapabilityPersistence } from "../../src/capability/persistence"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@/filesystem"
import { inboxServiceRef } from "../../src/inbox/inbox-ref"
import type { Interface as InboxInterface } from "../../src/inbox/inbox"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID } from "../../src/session/schema"
import { Shell } from "../../src/shell/shell"
import { ShellTool } from "../../src/tool/bash"
import { ShellProcessTool } from "../../src/tool/background_job"
import * as Tool from "../../src/tool/tool"
import { Truncate } from "../../src/tool"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

const quote = (text: string) => `"${text}"`
const squote = (text: string) => `'${text}'`
const shellName = () => Shell.name(Shell.acceptable())
const evalArg = (text: string) => (shellName() === "cmd" ? quote(text) : squote(text))
const testLayer = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
  ShellBackgroundRuntimeLayer,
)
const runtime = ManagedRuntime.make(testLayer)

const runJs = (code: string) => {
  const text = `${quote(process.execPath.replaceAll("\\", "/"))} -e ${evalArg(code)}`
  if (shellName() === "pwsh" || shellName() === "powershell") return `& ${text}`
  return text
}
const emitLine = (text: string) => {
  if (shellName() === "pwsh" || shellName() === "powershell") return `Write-Output ${quote(text)}`
  return `echo ${text}`
}

async function initShellTool(target = runtime) {
  return target.runPromise(ShellTool.pipe(Effect.flatMap((info) => info.init())))
}

async function initBackgroundJobTool(target = runtime) {
  return target.runPromise(ShellProcessTool.pipe(Effect.flatMap((info) => info.init())))
}

async function createSession(title: string) {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title })))
}

function ctx(sessionID: string): Tool.Context {
  return {
    sessionID: sessionID as never,
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

describe("shell process tools", () => {
  test("argv jobs resolve jobRoot files before starting", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await createSession("argv-job-root")
        const started = await runtime.runPromise(
          Effect.gen(function* () {
            const background = yield* ShellBackgroundRuntime
            return yield* background.start({
              sessionID: session.id,
              title: "Run argv fixture",
              cwd: tmp.path,
              env: process.env as Record<string, string>,
              shell: "",
              shellName: "argv",
              argv: [process.execPath, "{jobRoot}/fixture.cjs"],
              files: [{ name: "fixture.cjs", content: 'console.log("argv-job-root")' }],
              source: "test",
            })
          }),
        )

        const background = await runtime.runPromise(
          Effect.gen(function* () {
            return yield* ShellBackgroundRuntime
          }),
        )
        const waited = await runtime.runPromise(background.wait({ jobID: started.id, timeoutMs: 5_000 }))

        expect(waited.timedOut).toBe(false)
        expect(BackgroundJobPersistence.load(started.id)?.status).toBe("completed")
        expect(BackgroundJobPersistence.listLogs({ jobID: started.id }).some((item) => item.text.includes("argv-job-root"))).toBe(true)
      },
    })
  }, 15000)

  test("short shell commands return their output without a follow-up process poll", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await createSession("shell-inline-result")
        const shell = await initShellTool()
        const result = await runtime.runPromise(
          shell.execute(
            {
              command: emitLine("inline-shell-result"),
              description: "Emit one inline shell line",
            },
            ctx(session.id),
          ),
        )
        expect(result.output).toContain("inline-shell-result")
        expect(result.metadata.status).toBe("completed")
        expect(result.metadata.jobID).toBeTruthy()
      },
    })
  }, 15000)

  test("shell background jobs can be awaited through background_job.wait", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await createSession("shell-bg-wait")
        const shell = await initShellTool()
        const backgroundJob = await initBackgroundJobTool()
        const started = await runtime.runPromise(
          shell.execute(
            {
              command: emitLine("hello-from-background"),
              description: "Emit one background line",
              background: true,
            },
            ctx(session.id),
          ),
        )
        const jobID = String((started.metadata as Record<string, unknown>).jobID ?? "")
        expect(jobID).toBeTruthy()

        const details = await runtime.runPromise(
          backgroundJob.execute(
            {
              operation: "get",
              job_id: jobID,
            },
            ctx(session.id),
          ),
        )
        expect(details.metadata.jobFound).toBe(true)
        expect(CapabilityPersistence.listAudit({ capability: "context_read" })).toContainEqual(
          expect.objectContaining({
            reason: "Shell process get",
            rollback: expect.objectContaining({ jobs: [jobID] }),
          }),
        )

        const waited = await runtime.runPromise(
          backgroundJob.execute(
            {
              operation: "wait",
              job_id: jobID,
              timeout_ms: 5_000,
            },
            ctx(session.id),
          ),
        )
        expect(waited.metadata.timedOut).toBe(false)
        expect(waited.metadata.status).toBe("completed")
        expect(waited.output).toContain("stdout tail:")
        expect(waited.output).toContain("hello-from-background")

        const job = BackgroundJobPersistence.load(jobID)
        expect(job?.status).toBe("completed")
        const logs = BackgroundJobPersistence.listLogs({ jobID })
        expect(logs.some((item) => item.text.includes("hello-from-background"))).toBe(true)
      },
    })
  }, 15000)

  test("terminal shell jobs do not send model-waking Inbox notifications", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const previousInbox = inboxServiceRef.current
        let sent = 0
        const inbox: InboxInterface = {
          send: () =>
            Effect.sync(() => {
              sent += 1
              return { inboxID: "terminal-job-notification" }
            }),
          drain: () => Effect.succeed(0),
        }
        inboxServiceRef.current = inbox
        try {
          const session = await createSession("terminal-job-no-inbox")
          const started = await runtime.runPromise(
            Effect.gen(function* () {
              const background = yield* ShellBackgroundRuntime
              return yield* background.start({
                sessionID: session.id,
                title: "Finish without waking the model",
                cwd: tmp.path,
                env: process.env as Record<string, string>,
                shell: "",
                shellName: "argv",
                argv: [process.execPath, "-e", 'console.log("terminal-no-inbox")'],
                source: "test",
              })
            }),
          )
          const background = await runtime.runPromise(Effect.gen(function* () {
            return yield* ShellBackgroundRuntime
          }))
          const waited = await runtime.runPromise(background.wait({ jobID: started.id, timeoutMs: 5_000 }))

          expect(waited.timedOut).toBe(false)
          expect(waited.job?.status).toBe("completed")
          expect(sent).toBe(0)
        } finally {
          inboxServiceRef.current = previousInbox
        }
      },
    })
  }, 15000)

  test("shell_process.wait returns UTF-8 byte-bounded stdout and stderr tails", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await createSession("shell-bg-bounded-wait")
        const stdout = `${"中".repeat(3_000)}STDOUT_TAIL`
        const stderr = `${"错".repeat(2_000)}STDERR_TAIL`
        const started = await runtime.runPromise(
          Effect.gen(function* () {
            const background = yield* ShellBackgroundRuntime
            return yield* background.start({
              sessionID: session.id,
              title: "Emit large UTF-8 output",
              cwd: tmp.path,
              env: process.env as Record<string, string>,
              shell: "",
              shellName: "argv",
              argv: [
                process.execPath,
                "-e",
                `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)})`,
              ],
              source: "test",
            })
          }),
        )
        const backgroundJob = await initBackgroundJobTool()
        const waited = await runtime.runPromise(
          backgroundJob.execute(
            {
              operation: "wait",
              job_id: started.id,
              timeout_ms: 5_000,
            },
            ctx(session.id),
          ),
        )
        const stdoutTail = waited.output.match(/stdout tail:\n([\s\S]*?)\n\[stdout truncated;/)?.[1]
        const stderrTail = waited.output.match(/stderr tail:\n([\s\S]*?)\n\[stderr truncated;/)?.[1]

        expect(waited.metadata).toMatchObject({
          jobID: started.id,
          status: "completed",
          exitCode: 0,
          truncated: true,
          stdoutTruncated: true,
          stderrTruncated: true,
        })
        expect(stdoutTail).toBeDefined()
        expect(stderrTail).toBeDefined()
        expect(Buffer.byteLength(stdoutTail!, "utf8")).toBeLessThanOrEqual(8 * 1024)
        expect(Buffer.byteLength(stderrTail!, "utf8")).toBeLessThanOrEqual(4 * 1024)
        expect(stdoutTail).toEndWith("STDOUT_TAIL")
        expect(stderrTail).toEndWith("STDERR_TAIL")

        const logs = await runtime.runPromise(
          backgroundJob.execute(
            {
              operation: "logs",
              job_id: started.id,
              limit: 10,
            },
            ctx(session.id),
          ),
        )
        expect(logs.output).toContain("STDOUT_TAIL")
        expect(logs.output).toContain("STDERR_TAIL")
      },
    })
  }, 15000)

  test("background_job.cancel terminates a running shell background job", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await createSession("shell-bg-cancel")
        const shell = await initShellTool()
        const backgroundJob = await initBackgroundJobTool()
        const started = await runtime.runPromise(
          shell.execute(
            {
              command: runJs('console.log("started"); setTimeout(() => console.log("late"), 30000)'),
              description: "Run a long background task",
              background: true,
            },
            ctx(session.id),
          ),
        )
        const jobID = String((started.metadata as Record<string, unknown>).jobID ?? "")
        expect(jobID).toBeTruthy()
        await Bun.sleep(300)

        const cancelled = await runtime.runPromise(
          backgroundJob.execute(
            {
              operation: "cancel",
              job_id: jobID,
            },
            ctx(session.id),
          ),
        )
        expect(cancelled.metadata.result).toBe("cancelled")

        const job = BackgroundJobPersistence.load(jobID)
        expect(job?.status).toBe("cancelled")
      },
    })
  })

  test("shell background jobs reattach after runtime restart", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await createSession("shell-bg-reattach")
        const firstRuntime = ManagedRuntime.make(testLayer)
        try {
          const shell = await initShellTool(firstRuntime)
          const started = await firstRuntime.runPromise(
            shell.execute(
              {
                command: runJs('setTimeout(() => console.log("after-restart"), 800)'),
                description: "Survive runtime restart",
                background: true,
              },
              ctx(session.id),
            ),
          )
          const jobID = String((started.metadata as Record<string, unknown>).jobID ?? "")
          expect(jobID).toBeTruthy()
          await firstRuntime.dispose()

          const secondRuntime = ManagedRuntime.make(testLayer)
          try {
            const backgroundJob = await initBackgroundJobTool(secondRuntime)
            const waited = await secondRuntime.runPromise(
              backgroundJob.execute(
                {
                  operation: "wait",
                  job_id: jobID,
                  timeout_ms: 8_000,
                },
                ctx(session.id),
              ),
            )
            expect(waited.metadata.timedOut).toBe(false)
            expect(waited.metadata.status).toBe("completed")
            const logs = BackgroundJobPersistence.listLogs({ jobID })
            expect(logs.some((item) => item.text.includes("after-restart"))).toBe(true)
          } finally {
            await secondRuntime.dispose()
          }
        } finally {
          await firstRuntime.dispose().catch(() => undefined)
        }
      },
    })
  }, 20000)

  test("a finite background_job grant is consumed before a shell background job starts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const budgetRuntime = ManagedRuntime.make(testLayer)
        const grantID = `background-budget-${Date.now()}`
        CapabilityPersistence.saveGrant({
          id: grantID,
          capability: "background_job",
          scope: "global",
          source: "core",
          remainingBudget: 1,
        })
        try {
          const session = await createSession("shell-bg-budget")
          const shell = await initShellTool(budgetRuntime)
          const backgroundJob = await initBackgroundJobTool(budgetRuntime)
          const first = await budgetRuntime.runPromise(
            shell.execute(
              {
                command: emitLine("budgeted-background-job"),
                description: "Use one background budget unit",
                background: true,
              },
              ctx(session.id),
            ),
          )
          const jobID = String((first.metadata as Record<string, unknown>).jobID ?? "")
          expect(BackgroundJobPersistence.load(jobID)?.metadata).toMatchObject({ capabilityGrantID: grantID })
          expect(CapabilityPersistence.loadGrant(grantID)).toMatchObject({ remainingBudget: 0 })

          await expect(
            budgetRuntime.runPromise(
              shell.execute(
                {
                  command: emitLine("must-not-start"),
                  description: "Exhausted background budget",
                  background: true,
                },
                ctx(session.id),
              ),
            ),
          ).rejects.toThrow("Background job budget denied: exhausted")

          await budgetRuntime.runPromise(
            backgroundJob.execute(
              {
                operation: "wait",
                job_id: jobID,
                timeout_ms: 5_000,
              },
              ctx(session.id),
            ),
          )
        } finally {
          CapabilityPersistence.revokeGrant(grantID)
          await budgetRuntime.dispose()
        }
      },
    })
  })
})
