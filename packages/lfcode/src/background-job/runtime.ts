import { BackgroundJobPersistence, type BackgroundJobSummary } from "./persistence"
import { CapabilityPersistence } from "@/capability/persistence"
import { shellBackgroundRuntimeRef } from "./runtime-ref"
import { inboxServiceRef } from "@/inbox/inbox-ref"
import { Global } from "@/global"
import { Log } from "@/util"
import { Filesystem } from "@/util"
import { which } from "@/util/which"
import { redactSensitiveText } from "@/util/redact"
import type { MessageID, SessionID } from "@/session/schema"
import { Identifier } from "@/id/id"
import { Context, Deferred, Effect, Layer, Option } from "effect"
import { existsSync } from "node:fs"
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { BackgroundJobCancelResult } from "./control"

const log = Log.create({ service: "background-job.runtime" })
const POLL_MS = 800
const BUNDLED_NODE_ENV = "LFCODE_BUNDLED_NODE"

type ShellBackgroundRecovery = {
  version: 1
  shell: string
  shellName: string
  workdir: string
  rootDir: string
  payloadPath: string
  wrapperPath: string
  stdoutPath: string
  stderrPath: string
  manifestPath: string
  pidPath: string
  host: string
  offset: {
    stdout: number
    stderr: number
  }
  nextSeq: number
  childPid?: number
}

type BackgroundJobFile = {
  name: string
  content: string
}

type StartInput = {
  sessionID: SessionID
  title: string
  command?: string
  argv?: string[]
  cwd: string
  env: Record<string, string>
  shell: string
  shellName: string
  source: string
  files?: BackgroundJobFile[]
  remindAfterMs?: number
  sourceMessageID?: MessageID
  sourceToolCallID?: string
  metadata?: Record<string, unknown>
}

type WaitInput = {
  jobID: string
  timeoutMs?: number
}

type WaitResult = {
  timedOut: boolean
  job?: BackgroundJobSummary
}

type LiveJob = {
  jobID: string
  sessionID: SessionID
  deferred: Deferred.Deferred<BackgroundJobSummary>
  timer: ReturnType<typeof setInterval>
  reminderTimer?: ReturnType<typeof setTimeout>
  settling: boolean
}

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<BackgroundJobSummary>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly cancel: (jobID: string, source?: string) => Effect.Effect<BackgroundJobCancelResult>
  readonly reattachRunningJobs: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/ShellBackgroundRuntime") {}

function backgroundRoot(jobID: string) {
  return path.join(Global.Path.state, "background-jobs", jobID)
}

function bundledNodeRuntime() {
  const configured = process.env[BUNDLED_NODE_ENV]
  if (!configured) return
  const resolved = Filesystem.windowsPath(configured)
  if (Filesystem.stat(resolved)?.isFile()) return resolved
}

function systemNodeRuntime() {
  const candidates = process.platform === "win32" ? ["node.exe", "node"] : ["node"]
  for (const candidate of candidates) {
    const resolved = which(candidate)
    if (resolved) return resolved
  }
}

function wrapperRuntime() {
  const bundled = bundledNodeRuntime()
  if (bundled) return bundled
  if (process.versions.bun) return systemNodeRuntime() ?? process.execPath
  const exec = Filesystem.windowsPath(process.execPath)
  if (Filesystem.stat(exec)?.isFile()) return exec
  return systemNodeRuntime() ?? process.execPath
}

function wrapperSource() {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const { spawn } = require("node:child_process");',
    "",
    "function errorText(error) {",
    '  if (error instanceof Error) return error.message;',
    "  return String(error);",
    "}",
    "",
    "function writeJson(file, data) {",
    "  fs.mkdirSync(path.dirname(file), { recursive: true });",
    '  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");',
    "}",
    "",
    "function killTree(pid) {",
    "  if (!pid) return Promise.resolve();",
    '  if (process.platform === "win32") {',
    "    return new Promise((resolve) => {",
    '      const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {',
    '        stdio: "ignore",',
    "        windowsHide: true,",
    "      });",
    '      killer.once("exit", () => resolve());',
    '      killer.once("error", () => resolve());',
    "    });",
    "  }",
    "  return new Promise((resolve) => {",
    "    try {",
    '      process.kill(-pid, "SIGTERM");',
    "    } catch {",
    "      try {",
    '        process.kill(pid, "SIGTERM");',
    "      } catch {}",
    "    }",
    "    setTimeout(() => resolve(), 200);",
    "  });",
    "}",
    "",
    'const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'const outFd = fs.openSync(payload.stdoutPath, "a");',
    'const errFd = fs.openSync(payload.stderrPath, "a");',
    "let settled = false;",
    "let child;",
    "",
    "function finalize(result) {",
    "  if (settled) return;",
    "  settled = true;",
    "  writeJson(payload.manifestPath, {",
    "    ...result,",
    "    completedAt: result.completedAt ?? Date.now(),",
    "  });",
    "  try {",
    "    fs.closeSync(outFd);",
    "  } catch {}",
    "  try {",
    "    fs.closeSync(errFd);",
    "  } catch {}",
    '  process.exit(typeof result.exitCode === "number" ? result.exitCode : 0);',
    "}",
    "",
    "function launch() {",
    '  const lower = String(payload.shellName || "").toLowerCase();',
    '  if (Array.isArray(payload.argv) && payload.argv.length > 0) {',
    '    const argv = payload.argv.map((item) => String(item).replaceAll("{jobRoot}", path.dirname(payload.payloadPath)));',
    '    return spawn(argv[0], argv.slice(1), {',
    "      cwd: payload.cwd,",
    "      env: payload.env,",
    '      stdio: ["ignore", outFd, errFd],',
    '      detached: process.platform !== "win32",',
    "      windowsHide: true,",
    "    });",
    "  }",
    '  if (process.platform === "win32" && (lower === "pwsh" || lower === "powershell")) {',
    '    const command = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; & { " + payload.command + " }";',
    '    return spawn(payload.shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {',
    "      cwd: payload.cwd,",
    "      env: payload.env,",
    '      stdio: ["ignore", outFd, errFd],',
    "      windowsHide: true,",
    "    });",
    "  }",
    "  return spawn(payload.command, [], {",
    "    shell: payload.shell,",
    "    cwd: payload.cwd,",
    "    env: payload.env,",
    '    stdio: ["ignore", outFd, errFd],',
    '    detached: process.platform !== "win32",',
    "    windowsHide: true,",
    "  });",
    "}",
    "",
    "try {",
    "  child = launch();",
    "} catch (error) {",
    "  finalize({",
    '    status: "failed",',
    "    exitCode: 1,",
    "    error: errorText(error),",
    "  });",
    "}",
    "",
    "writeJson(payload.pidPath, { pid: child.pid, at: Date.now() });",
    "",
    'child.once("error", (error) =>',
    "  finalize({",
    '    status: "failed",',
    "    exitCode: 1,",
    "    error: errorText(error),",
    "  }),",
    ");",
    "",
    'child.once("exit", (code, signal) => {',
    '  const exitCode = typeof code === "number" ? code : undefined;',
    "  if (signal) {",
    "    finalize({",
    '      status: "cancelled",',
    "      exitCode,",
    '      error: "Process exited after signal " + signal + ".",',
    "    });",
    "    return;",
    "  }",
    "  if ((exitCode ?? 0) !== 0) {",
    "    finalize({",
    '      status: "failed",',
    "      exitCode,",
    '      error: "Command exited with code " + (exitCode ?? 1) + ".",',
    "    });",
    "    return;",
    "  }",
    "  finalize({",
    '    status: "completed",',
    "    exitCode: exitCode ?? 0,",
    "  });",
    "});",
    "",
    'for (const signal of ["SIGINT", "SIGTERM"]) {',
    "  process.on(signal, () => {",
    "    void killTree(child?.pid).then(() =>",
    "      finalize({",
    '        status: "cancelled",',
    "        exitCode: 1,",
    '        error: "Wrapper received " + signal + ".",',
    "      }),",
    "    );",
    "  });",
    "}",
    "",
  ].join("\n")
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "EPERM") return true
    return false
  }
}

async function killProcessTree(pid: number) {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
    })
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    process.kill(pid, "SIGTERM")
  }
}

function parseRecovery(job: BackgroundJobSummary) {
  if (!job.recovery) return
  const recovery = job.recovery as Partial<ShellBackgroundRecovery>
  if (
    recovery.version !== 1 ||
    typeof recovery.rootDir !== "string" ||
    typeof recovery.payloadPath !== "string" ||
    typeof recovery.wrapperPath !== "string" ||
    typeof recovery.stdoutPath !== "string" ||
    typeof recovery.stderrPath !== "string" ||
    typeof recovery.manifestPath !== "string" ||
    typeof recovery.pidPath !== "string" ||
    typeof recovery.workdir !== "string" ||
    typeof recovery.shell !== "string" ||
    typeof recovery.shellName !== "string"
  ) {
    return
  }
  return {
    version: 1 as const,
    shell: recovery.shell,
    shellName: recovery.shellName,
    workdir: recovery.workdir,
    rootDir: recovery.rootDir,
    payloadPath: recovery.payloadPath,
    wrapperPath: recovery.wrapperPath,
    stdoutPath: recovery.stdoutPath,
    stderrPath: recovery.stderrPath,
    manifestPath: recovery.manifestPath,
    pidPath: recovery.pidPath,
    host: typeof recovery.host === "string" ? recovery.host : os.hostname(),
    offset: {
      stdout: typeof recovery.offset?.stdout === "number" ? recovery.offset.stdout : 0,
      stderr: typeof recovery.offset?.stderr === "number" ? recovery.offset.stderr : 0,
    },
    nextSeq: typeof recovery.nextSeq === "number" ? recovery.nextSeq : (BackgroundJobPersistence.listLogs({ jobID: job.id }).at(-1)?.seq ?? 0) + 1,
    ...(typeof recovery.childPid === "number" ? { childPid: recovery.childPid } : {}),
  }
}

async function readPidFile(file: string) {
  if (!existsSync(file)) return
  const parsed = JSON.parse(await readFile(file, "utf8")) as { pid?: unknown }
  if (typeof parsed.pid !== "number") return
  return parsed.pid
}

async function readManifest(file: string) {
  if (!existsSync(file)) return
  const parsed = JSON.parse(await readFile(file, "utf8")) as {
    status?: unknown
    exitCode?: unknown
    error?: unknown
    completedAt?: unknown
  }
  if (
    parsed.status !== "completed" &&
    parsed.status !== "failed" &&
    parsed.status !== "cancelled"
  ) {
    return
  }
  return {
    status: parsed.status,
    ...(typeof parsed.exitCode === "number" ? { exitCode: parsed.exitCode } : {}),
    ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
    ...(typeof parsed.completedAt === "number" ? { completedAt: parsed.completedAt } : {}),
  } as const
}

async function readDelta(file: string, offset: number) {
  if (!existsSync(file)) return { text: "", offset }
  const info = await stat(file)
  if (info.size <= offset) return { text: "", offset }
  const handle = await open(file, "r")
  try {
    const size = Number(info.size - offset)
    const buffer = Buffer.alloc(size)
    await handle.read(buffer, 0, size, offset)
    return {
      text: redactSensitiveText(buffer.toString("utf8")),
      offset: Number(info.size),
    }
  } finally {
    await handle.close()
  }
}

function nextLogSeq(jobID: string) {
  return (BackgroundJobPersistence.listLogs({ jobID }).at(-1)?.seq ?? 0) + 1
}

export const layer: Layer.Layer<Service, never, never> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const live = new Map<string, LiveJob>()

    const persistRecovery = async (jobID: string, recovery: ShellBackgroundRecovery, pid?: number | null) => {
      BackgroundJobPersistence.updateRecovery({
        id: jobID,
        recovery,
        ...(pid !== undefined ? { pid } : {}),
      })
    }

    const settleLive = async (jobID: string, terminal: BackgroundJobSummary) => {
      const current = live.get(jobID)
      if (!current) return
      clearInterval(current.timer)
      if (current.reminderTimer) clearTimeout(current.reminderTimer)
      live.delete(jobID)
      await Effect.runPromise(Deferred.succeed(current.deferred, terminal).pipe(Effect.ignore))
    }

    const scheduleReminder = (job: BackgroundJobSummary, remindAfterMs?: number) => {
      if (!remindAfterMs || remindAfterMs <= 0) return undefined
      return setTimeout(() => {
        const latest = BackgroundJobPersistence.load(job.id)
        if (!latest || latest.status !== "running") return
        const inbox = inboxServiceRef.current
        if (!inbox) return
        void Effect.runPromise(
          inbox.send({
            receiverSessionID: latest.sessionID,
            receiverActorID: "main",
            senderSessionID: latest.sessionID,
            senderActorID: "shell_process",
            type: "actor_notification",
            content: `Shell process reminder: job_id ${latest.id} is still running after ${remindAfterMs}ms. It was not terminated. Use shell_process only when inspection is needed; cancel only when the user explicitly asks to stop it.`,
          }).pipe(Effect.ignore),
        )
      }, remindAfterMs)
    }

    const recordTerminal = async (
      job: BackgroundJobSummary,
      input: {
        status: "completed" | "failed" | "cancelled"
        exitCode?: number
        error?: string
        completedAt?: number
      },
    ) => {
      const next =
        BackgroundJobPersistence.recordTerminal({
          id: job.id,
          status: input.status,
          ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
          ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
          pid: null,
        }) ?? job
      await settleLive(job.id, next)
      const inbox = inboxServiceRef.current
      if (inbox?.sendCompletion) {
        void Effect.runPromise(
          inbox
            .sendCompletion({
              receiverSessionID: next.sessionID,
              receiverActorID: "main",
              senderSessionID: next.sessionID,
              senderActorID: "shell_process",
              notification: {
                source: "shell-job",
                id: next.id,
                status: input.status,
                summary:
                  next.status === "completed"
                    ? `${next.title} completed${next.exitCode === undefined ? "" : ` (exit ${next.exitCode})`}`
                    : next.error ?? `${next.title} ${next.status}`,
                finishedAt: next.completedAt ?? Date.now(),
                collectAction: `Use background_job get ${next.id} or logs ${next.id} when the output is needed.`,
                dedupeKey: `shell-job:${next.id}:${next.status}:${next.completedAt ?? "pending"}`,
              },
            })
            .pipe(Effect.ignore),
        )
      }
      return next
    }

    const syncRecoveryPids = async (job: BackgroundJobSummary, recovery: ShellBackgroundRecovery) => {
      const childPid = await readPidFile(recovery.pidPath)
      if (childPid === undefined || recovery.childPid === childPid) return recovery
      const next = { ...recovery, childPid }
      await persistRecovery(job.id, next, job.pid)
      return next
    }

    const ingestLogDelta = async (
      job: BackgroundJobSummary,
      recovery: ShellBackgroundRecovery,
      stream: "stdout" | "stderr",
    ) => {
      const file = stream === "stdout" ? recovery.stdoutPath : recovery.stderrPath
      const current = recovery.offset[stream]
      const delta = await readDelta(file, current)
      if (!delta.text) return recovery
      BackgroundJobPersistence.appendLog({
        jobID: job.id,
        sessionID: job.sessionID as never,
        seq: recovery.nextSeq,
        stream,
        text: delta.text,
      })
      const next = {
        ...recovery,
        offset: {
          ...recovery.offset,
          [stream]: delta.offset,
        },
        nextSeq: recovery.nextSeq + 1,
      }
      await persistRecovery(job.id, next, job.pid)
      return next
    }

    const pollJob = async (jobID: string) => {
      const current = live.get(jobID)
      if (!current || current.settling) return
      current.settling = true
      try {
        const job = BackgroundJobPersistence.load(jobID)
        if (!job) {
          clearInterval(current.timer)
          live.delete(jobID)
          return
        }
        if (job.status !== "running") {
          await settleLive(job.id, job)
          return
        }
        let recovery = parseRecovery(job)
        if (!recovery) return
        recovery = await syncRecoveryPids(job, recovery)
        recovery = await ingestLogDelta(job, recovery, "stdout")
        recovery = await ingestLogDelta(job, recovery, "stderr")
        const manifest = await readManifest(recovery.manifestPath)
        if (!manifest) return
        await recordTerminal(job, manifest)
      } catch (error) {
        log.warn("background job poll failed", { jobID, error: error instanceof Error ? error.message : String(error) })
      } finally {
        const next = live.get(jobID)
        if (next) next.settling = false
      }
    }

    const attach = async (job: BackgroundJobSummary, remindAfterMs?: number) => {
      const existing = live.get(job.id)
      if (existing) return existing
      const deferred = await Effect.runPromise(Deferred.make<BackgroundJobSummary>())
      const timer = setInterval(() => {
        void pollJob(job.id)
      }, POLL_MS)
      const item = {
        jobID: job.id,
        sessionID: job.sessionID,
        deferred,
        timer,
        settling: false,
        reminderTimer: scheduleReminder(job, remindAfterMs),
      }
      live.set(job.id, item)
      void pollJob(job.id)
      return item
    }

    const reattachOne = async (job: BackgroundJobSummary) => {
      if (job.kind !== "shell" || job.status !== "running") return
      const recovery = parseRecovery(job)
      if (!recovery) {
        BackgroundJobPersistence.appendLog({
          jobID: job.id,
          sessionID: job.sessionID,
          seq: nextLogSeq(job.id),
          stream: "system",
          text: "Shell background runtime could not recover this job because recovery metadata was missing.",
        })
        BackgroundJobPersistence.recordTerminal({
          id: job.id,
          status: "failed",
          completedAt: Date.now(),
          pid: null,
          error: "Shell background runtime recovery metadata was missing.",
        })
        return
      }
      const manifest = await readManifest(recovery.manifestPath)
      if (manifest) {
        await attach(job)
        return
      }
      if (job.pid !== undefined && processExists(job.pid)) {
        await attach(job)
        return
      }
      BackgroundJobPersistence.appendLog({
        jobID: job.id,
        sessionID: job.sessionID,
        seq: nextLogSeq(job.id),
        stream: "system",
        text: `Startup reconcile could not find live wrapper pid ${job.pid ?? "unknown"} for shell background job.`,
      })
      BackgroundJobPersistence.recordTerminal({
        id: job.id,
        status: "failed",
        completedAt: Date.now(),
        pid: null,
        error: "Tracked shell background wrapper was missing during startup recovery.",
      })
    }

    const start = Effect.fn("ShellBackgroundRuntime.start")(function* (input: StartInput) {
      const jobID = Identifier.ascending("job")
      const rootDir = backgroundRoot(jobID)
      yield* Effect.promise(() => mkdir(rootDir, { recursive: true }))
      const payloadPath = path.join(rootDir, "payload.json")
      const wrapperPath = path.join(rootDir, "wrapper.cjs")
      const stdoutPath = path.join(rootDir, "stdout.log")
      const stderrPath = path.join(rootDir, "stderr.log")
      const manifestPath = path.join(rootDir, "manifest.json")
      const pidPath = path.join(rootDir, "child-pid.json")
      yield* Effect.promise(() =>
        Promise.all(
          (input.files ?? []).map((file) => {
            const target = path.join(rootDir, file.name)
            if (!path.resolve(target).startsWith(path.resolve(rootDir) + path.sep)) {
              throw new Error(`Background job file escapes its job directory: ${file.name}`)
            }
            return mkdir(path.dirname(target), { recursive: true }).then(() => writeFile(target, file.content, "utf8"))
          }),
        ),
      )
      const recovery: ShellBackgroundRecovery = {
        version: 1,
        shell: input.shell,
        shellName: input.shellName,
        workdir: input.cwd,
        rootDir,
        payloadPath,
        wrapperPath,
        stdoutPath,
        stderrPath,
        manifestPath,
        pidPath,
        host: os.hostname(),
        offset: { stdout: 0, stderr: 0 },
        nextSeq: 1,
      }

      yield* Effect.promise(() =>
        Promise.all([
          writeFile(wrapperPath, wrapperSource(), "utf8"),
          writeFile(
            payloadPath,
            JSON.stringify(
              {
                shell: input.shell,
                shellName: input.shellName,
                command: input.command,
                argv: input.argv,
                payloadPath,
                cwd: input.cwd,
                env: input.env,
                stdoutPath,
                stderrPath,
                manifestPath,
                pidPath,
              },
              null,
              2,
            ),
            "utf8",
          ),
        ]),
      )

      const budget = CapabilityPersistence.reserveBudget({ capability: "background_job" })
      const audit = CapabilityPersistence.recordAudit({
        id: `capability_${Identifier.ascending("event")}`,
        caller: `background:${input.source}`,
        capability: "background_job",
        operation: "execute",
        decision: budget.status === "denied" ? "deny" : "allow",
        target: input.title,
        sessionID: input.sessionID,
        metadata: {
          budget: budget.status,
          ...(budget.status === "reserved" ? { grantID: budget.grant.id, remainingBudget: budget.grant.remainingBudget } : {}),
          ...(budget.status === "denied" ? { reason: budget.reason } : {}),
        },
        result: "pending",
      })
      if (budget.status === "denied") {
        CapabilityPersistence.completeAudit({ id: audit.id, result: `background budget denied: ${budget.reason}` })
        return yield* Effect.die(new Error(`Background job budget denied: ${budget.reason}`))
      }

      const job = BackgroundJobPersistence.recordStart({
        id: jobID,
        sessionID: input.sessionID,
        kind: "shell",
        source: input.source,
        title: input.title,
        cwd: input.cwd,
        payload: {
          ...(input.command ? { command: input.command } : {}),
          ...(input.argv ? { argv: input.argv } : {}),
          shell: input.shell,
          shellName: input.shellName,
        },
        env: input.env,
        ...(input.sourceMessageID ? { sourceMessageID: input.sourceMessageID } : {}),
          ...(input.sourceToolCallID ? { sourceToolCallID: input.sourceToolCallID } : {}),
        recovery,
        metadata: {
          ...input.metadata,
          ...(budget.status === "reserved" ? { capabilityGrantID: budget.grant.id } : {}),
        },
      })

      const wrapper = yield* Effect.try({
        try: () =>
          spawn(wrapperRuntime(), [wrapperPath, payloadPath], {
            cwd: input.cwd,
            detached: true,
            stdio: "ignore",
            // Desktop's bundled Node runtime is Electron itself. Without this
            // flag Windows launches another GUI process instead of the wrapper,
            // leaving jobs forever at "running" without logs or a manifest.
            env: process.platform === "win32" ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env,
            windowsHide: true,
          }),
        catch: (error) => error,
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            BackgroundJobPersistence.recordTerminal({
              id: job.id,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
              pid: null,
            })
            if (budget.status === "reserved") CapabilityPersistence.refundBudget(budget.grant.id)
            CapabilityPersistence.completeAudit({ id: audit.id, result: "background start failed; budget refunded" })
          }),
        ),
        Effect.orDie,
      )
      wrapper.unref()

      const next =
        BackgroundJobPersistence.updateRecovery({
          id: jobID,
          recovery,
          pid: wrapper.pid,
      }) ?? job
      yield* Effect.promise(() => attach(next, input.remindAfterMs))
      CapabilityPersistence.completeAudit({ id: audit.id, result: "background job started" })
      return next
    })

    const wait = Effect.fn("ShellBackgroundRuntime.wait")(function* (input: WaitInput) {
      const job = BackgroundJobPersistence.load(input.jobID)
      if (!job) return { timedOut: false }
      if (job.status !== "running") return { timedOut: false, job }
      yield* Effect.promise(() => attach(job))
      const active = live.get(job.id)
      if (!active) return { timedOut: false, job: BackgroundJobPersistence.load(job.id) ?? job }
      const awaited = input.timeoutMs
        ? yield* Deferred.await(active.deferred).pipe(Effect.timeoutOption(input.timeoutMs))
        : Option.some(yield* Deferred.await(active.deferred))
      if (Option.isNone(awaited)) {
        return {
          timedOut: true,
          job: BackgroundJobPersistence.load(job.id) ?? job,
        }
      }
      return {
        timedOut: false,
        job: awaited.value,
      }
    })

    const cancel = Effect.fn("ShellBackgroundRuntime.cancel")(function* (jobID: string, source = "manual") {
      const job = BackgroundJobPersistence.load(jobID)
      if (!job) {
        return {
          ok: false as const,
          code: "not_found" as const,
          message: `Background job not found: ${jobID}`,
        }
      }
      if (job.kind !== "shell") {
        return {
          ok: true as const,
          code: "unmanaged_running" as const,
          changed: false,
          message: `Background job ${job.id} is not managed by the shell background runtime.`,
          job,
        }
      }
      if (job.status !== "running") {
        return {
          ok: true as const,
          code: "already_terminal" as const,
          changed: false,
          message: `Background job ${job.id} is already ${job.status}.`,
          job,
        }
      }
      const recovery = parseRecovery(job)
      const childPid = recovery?.childPid ?? (recovery ? yield* Effect.promise(() => readPidFile(recovery.pidPath)) : undefined)
      const targetPid = childPid ?? job.pid
      if (targetPid === undefined) {
        return {
          ok: true as const,
          code: "unmanaged_running" as const,
          changed: false,
          message: `Background job ${job.id} is still marked running but has no tracked pid, so it cannot be cancelled from this host yet.`,
          job,
        }
      }

      yield* Effect.promise(() => killProcessTree(targetPid))
      BackgroundJobPersistence.appendLog({
        jobID: job.id,
        sessionID: job.sessionID,
        seq: nextLogSeq(job.id),
        stream: "system",
        text: `Cancellation requested via ${source}; terminated shell background process tree rooted at pid ${targetPid}.`,
      })
      const terminal = yield* Effect.promise(() =>
        recordTerminal(job, {
          status: "cancelled",
          completedAt: Date.now(),
        }),
      )
      if (recovery) {
        yield* Effect.promise(() => rm(recovery.pidPath, { force: true }).catch(() => {}))
      }
      return {
        ok: true as const,
        code: "cancelled" as const,
        changed: true,
        message: `Cancelled background job ${job.id}.`,
        job: terminal,
      }
    })

    const reattachRunningJobs = Effect.fn("ShellBackgroundRuntime.reattachRunningJobs")(function* () {
      const jobs = BackgroundJobPersistence.list({ status: "running" }).filter((job) => job.kind === "shell")
      yield* Effect.promise(() => Promise.all(jobs.map((job) => reattachOne(job))))
    })

    const impl = Service.of({
      start,
      wait,
      cancel,
      reattachRunningJobs,
    })
    shellBackgroundRuntimeRef.current = impl
    yield* reattachRunningJobs()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const item of live.values()) clearInterval(item.timer)
        live.clear()
        if (shellBackgroundRuntimeRef.current === impl) shellBackgroundRuntimeRef.current = undefined
      }),
    )
    return impl
  }),
)

export const defaultLayer = layer
export const ShellBackgroundRuntime = {
  Service,
  layer,
  defaultLayer,
}
