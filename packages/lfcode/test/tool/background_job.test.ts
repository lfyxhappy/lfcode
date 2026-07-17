import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Agent } from "../../src/agent/agent"
import { defaultLayer as ShellBackgroundRuntimeLayer } from "../../src/background-job/runtime"
import { BackgroundJobPersistence } from "../../src/background-job/persistence"
import { CapabilityPersistence } from "../../src/capability/persistence"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@/filesystem"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID } from "../../src/session/schema"
import { Shell } from "../../src/shell/shell"
import { ShellTool } from "../../src/tool/bash"
import { BackgroundJobTool } from "../../src/tool/background_job"
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
  return target.runPromise(BackgroundJobTool.pipe(Effect.flatMap((info) => info.init())))
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

describe("background job tools", () => {
  test("background_job.start reuses shell pwsh validation on Windows", async () => {
    if (process.platform !== "win32") return
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await createSession("bg-start-guard")
        const backgroundJob = await initBackgroundJobTool()
        await expect(
          runtime.runPromise(
            backgroundJob.execute(
              {
                operation: "start",
                command: "export DEMO=value",
                description: "Set env var in background",
              },
              ctx(session.id),
            ),
          ),
        ).rejects.toThrow("`$env:DEMO = value`")
      },
    })
  })

  test(
    "shell background jobs can be awaited through background_job.wait",
    async () => {
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
          expect.objectContaining({ reason: "Background job get", rollback: expect.objectContaining({ jobs: [jobID] }) }),
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

        const job = BackgroundJobPersistence.load(jobID)
        expect(job?.status).toBe("completed")
        const logs = BackgroundJobPersistence.listLogs({ jobID })
        expect(logs.some((item) => item.text.includes("hello-from-background"))).toBe(true)
      },
    })
    },
    15000,
  )

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

  test(
    "shell background jobs reattach after runtime restart",
    async () => {
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
    },
    20000,
  )

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
