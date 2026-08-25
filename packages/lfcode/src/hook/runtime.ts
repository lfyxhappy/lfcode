import { basename } from "node:path"
import { spawn } from "node:child_process"
import { listHooks, claimHook, recordHookRun } from "./persistence"
import { HookRun, type HookDefinition, type HookDispatchInput, type HookDispatchResult } from "./schema"
import { GlobalBus } from "@/bus/global"
import { Instance } from "@/project/instance"
import { HookEvents } from "./events"
import { Shell } from "@/shell/shell"

const secretKey = /authorization|cookie|token|secret|password|api[_-]?key/i
const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== "object") return typeof value === "string" && value.length > 8_000 ? `${value.slice(0, 8_000)}...[truncated]` : value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? "[redacted]" : redact(item)]))
}

export function matchesHook(hook: HookDefinition, input: HookDispatchInput) {
  if (!hook.events.includes(input.event)) return false
  if (hook.scope === "project" && hook.projectID !== input.projectID) return false
  if (hook.scope === "session" && hook.sessionID !== input.sessionID && !input.parentSessionIDs?.includes(hook.sessionID ?? "")) return false
  const target = input.tool ?? String(input.payload?.path ?? input.event)
  return hook.matcher.split(",").map((item) => item.trim()).filter(Boolean).some((pattern) => glob(pattern, target))
}

function glob(pattern: string, value: string) {
  let cursor = 0
  return pattern.split("").every((character, index, chars) => {
    if (character === "*") { const next = chars.slice(index + 1).join("").replace(/[?*]/g, ""); if (!next) return true; const at = value.indexOf(next, cursor); if (at < 0) return false; cursor = at + next.length; return true }
    if (character === "?") { cursor++; return cursor <= value.length }
    if (value[cursor] !== character) return false
    cursor++; return true
  }) && (pattern.endsWith("*") || cursor === value.length)
}

export async function dispatchHooks(input: HookDispatchInput): Promise<HookDispatchResult> {
  const definitions = listHooks({ projectID: input.projectID, sessionID: input.sessionID }).filter((hook) => matchesHook(hook, input)).toSorted((a, b) => scopeOrder(a) - scopeOrder(b) || a.createdAt - b.createdAt)
  const runs: HookRun[] = []; const additionalContext: string[] = []
  for (const hook of definitions) {
    if (hook.lifetime === "temporary" && !claimHook(hook.id)) continue
    const run = await executeHook(hook, input)
    runs.push(run.run)
    if (hook.lifetime === "temporary" && hook.expiry?.kind === "current_turn") {
      const { setHookEnabled } = await import("./persistence")
      setHookEnabled(hook.id, false)
    }
    if (run.additionalContext) additionalContext.push(run.additionalContext)
    if (run.blocked) return { blocked: true, additionalContext, runs }
  }
  return { blocked: false, additionalContext, runs }
}

function scopeOrder(hook: HookDefinition) { return hook.scope === "global" ? 0 : hook.scope === "project" ? 1 : 2 }

export async function executeHook(hook: HookDefinition, input: HookDispatchInput) {
  const started = Date.now(); const payload = redact({ ...input.payload, tool: input.tool, cwd: input.cwd }) as Record<string, unknown>
  try {
    if (hook.handler.type === "prompt") {
      if (!input.promptEvaluator) return finish(hook, input, started, "failed", "Prompt handler unavailable; failed open", payload, {}, false)
      const { promptEvaluator, ...event } = input
      const result = await withTimeout(promptEvaluator({ prompt: hook.handler.prompt, event: { ...event, payload }, timeoutMs: hook.handler.timeoutMs }), hook.handler.timeoutMs)
      const blocked = result.decision === "block" || (result.decision === "ask" && input.event === "PermissionRequest")
      const status = blocked ? "blocked" : "completed"
      return finish(hook, input, started, status, result.reason ?? result.decision, payload, redact(result) as Record<string, unknown>, blocked, result.additionalContext)
    }
    const command = hook.handler.command
    const shell = hook.handler.shell === "auto" ? (process.platform === "win32" ? "powershell" : "sh") : hook.handler.shell
    const args = shell === "powershell"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", powershellCommand(command)]
      : ["-lc", command]
    const executable = shell === "powershell" ? Shell.resolvePowerShell() : "sh"
    const proc = spawn(executable, args, { cwd: input.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    proc.stdin.write(JSON.stringify(payload))
    proc.stdin.end()
    const done = collectProcess(proc)
    const [stdout, stderr, exitCode] = await withTimeout(done, hook.handler.timeoutMs).catch(async () => { killProcess(proc); throw new Error("Hook command timed out") })
    const summary = (stdout || stderr || `Exit code ${exitCode}`).trim().slice(0, 500)
    const blocked = hook.handler.blockOnNonZero && exitCode !== 0
    return finish(hook, input, started, blocked ? "blocked" : "completed", summary, payload, redact({ stdout, stderr, exitCode }) as Record<string, unknown>, blocked)
  } catch (error) {
    const timeout = error instanceof Error && /timed out/i.test(error.message)
    return finish(hook, input, started, timeout ? "timeout" : "failed", timeout ? "Hook timed out; failed open" : `Hook failed open: ${error instanceof Error ? error.message : String(error)}`, payload, {}, false)
  }
}

function finish(hook: HookDefinition, input: HookDispatchInput, started: number, status: HookRun["status"], summary: string, payload: Record<string, unknown>, output: Record<string, unknown>, blocked: boolean, additionalContext?: string) {
  const run = recordHookRun({ hookID: hook.id, sessionID: input.sessionID, event: input.event, status, durationMs: Date.now() - started, summary, input: payload, output })
  try {
    GlobalBus.emit("event", {
      directory: Instance.directory,
      project: Instance.project.id,
      payload: {
        type: HookEvents.RunCompleted.type,
        properties: {
          sessionID: input.sessionID,
          hookID: hook.id,
          hookName: hook.name,
          event: input.event,
          status,
          durationMs: run.durationMs,
          summary: run.summary,
          timeCreated: run.timeCreated,
        },
      },
    })
  } catch {
    // Tests and non-instance cleanup can execute Hooks without an app event target.
  }
  return { run, blocked, additionalContext }
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number) { return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Hook timed out")), timeoutMs))]) }

function powershellCommand(command: string) {
  // PowerShell can inherit the Windows console code page in packaged Electron.
  // Set both managed and native output encodings before running the user command
  // so Node's UTF-8 stream decoder receives Chinese and other Unicode intact.
  return `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${command}`
}

function collectProcess(proc: ReturnType<typeof spawn>) {
  return new Promise<[string, string, number]>((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    proc.stdout?.setEncoding("utf8")
    proc.stderr?.setEncoding("utf8")
    proc.stdout?.on("data", (chunk) => { stdout += chunk })
    proc.stderr?.on("data", (chunk) => { stderr += chunk })
    proc.once("error", reject)
    // The child close event is the authoritative completion signal. Waiting for
    // individual pipe `end` events can hang on Electron/Windows even after the
    // process has exited, causing false 30-second Hook timeouts.
    proc.once("close", (code) => resolve([stdout, stderr, code ?? 1]))
  })
}

function killProcess(proc: ReturnType<typeof spawn>) {
  if (proc.killed) return
  if (process.platform === "win32" && proc.pid) {
    const killer = spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore", windowsHide: true })
    killer.once("error", () => proc.kill())
    return
  }
  proc.kill("SIGTERM")
}
