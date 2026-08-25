import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import z from "zod"
import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@/storage"
import { InstanceState } from "@/effect"
import { Flag } from "@/flag/flag"
import { Pty } from "@/pty"
import type { PtyID } from "@/pty/schema"
import { Session } from "@/session"
import type { SessionID } from "@/session/schema"
import { ClaudeCodeSessionTable } from "./claude-code.sql"

const execFileAsync = promisify(execFile)

export const Capability = z.object({
  available: z.boolean(),
  reason: z.enum(["desktop_only", "remote_instance", "command_not_found"]).optional(),
})
export type Capability = z.output<typeof Capability>

export const PermissionMode = z.enum(["default", "acceptEdits", "plan", "auto", "bypassPermissions"])
export type PermissionMode = z.output<typeof PermissionMode>

export const Binding = z
  .object({
    sessionID: z.string(),
    claudeSessionID: z.string().uuid(),
    directory: z.string(),
    status: z.enum(["ready", "running"]),
    ptyID: z.string().optional(),
    models: z.array(z.object({ id: z.string(), label: z.string() })),
    permissionMode: PermissionMode.optional(),
  })
  .meta({ ref: "ClaudeCodeSession" })
export type Binding = z.output<typeof Binding>

type BindingRow = typeof ClaudeCodeSessionTable.$inferSelect
type State = { active: Map<SessionID, PtyID>; permissionMode: Map<SessionID, PermissionMode> }

export interface Interface {
  readonly capability: () => Effect.Effect<Capability>
  readonly get: (sessionID: SessionID) => Effect.Effect<Binding | undefined>
  readonly create: (session: Session.Info) => Effect.Effect<Binding>
  readonly reset: (sessionID: SessionID) => Effect.Effect<Binding>
  readonly open: (sessionID: SessionID) => Effect.Effect<Binding>
  readonly setPermissionMode: (sessionID: SessionID, mode: PermissionMode) => Effect.Effect<Binding>
  readonly input: (sessionID: SessionID, data: string) => Effect.Effect<void>
  readonly key: (sessionID: SessionID, data: string) => Effect.Effect<void>
  readonly close: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/ClaudeCode") {}

function toBinding(row: BindingRow, ptyID?: PtyID, permissionMode = row.permission_mode): Binding {
  return {
    sessionID: row.session_id,
    claudeSessionID: row.claude_session_id,
    directory: row.directory,
    status: ptyID ? "running" : "ready",
    ptyID,
    models: [],
    permissionMode,
  }
}

async function resolveModels() {
  const path = join(process.env.USERPROFILE ?? process.env.HOME ?? homedir(), ".claude", "settings.json")
  try {
    const settings = JSON.parse(await readFile(path, "utf8")) as { env?: Record<string, unknown> }
    const env = settings.env ?? {}
    const models = ["opus", "fable", "sonnet", "haiku"].flatMap((id) => {
      const name = env[`ANTHROPIC_DEFAULT_${id.toUpperCase()}_MODEL_NAME`]
      const label = typeof name === "string" && name.trim() ? name : id[0].toUpperCase() + id.slice(1)
      return [{ id, label: `${label} · ${id[0].toUpperCase()}${id.slice(1)}` }]
    })
    return models
  } catch {
    return []
  }
}

async function resolvePermissionMode(): Promise<PermissionMode> {
  const path = join(process.env.USERPROFILE ?? process.env.HOME ?? homedir(), ".claude", "settings.json")
  try {
    const settings = JSON.parse(await readFile(path, "utf8")) as {
      defaultMode?: unknown
      permissions?: { defaultMode?: unknown }
    }
    const mode = permissionModeFromSettings(settings.permissions?.defaultMode ?? settings.defaultMode)
    if (mode) return mode
  } catch {}
  // Claude Code 2.1.220 uses auto mode when no explicit default is configured.
  return "auto"
}

export function permissionModeFromSettings(value: unknown): PermissionMode | undefined {
  if (value === "manual" || value === "default") return "default"
  if (value === "acceptEdits" || value === "plan" || value === "auto" || value === "bypassPermissions") return value
}

async function resolveCommand() {
  try {
    await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["claude"], { windowsHide: true })
    return "claude"
  } catch {
    if (process.platform !== "win32") return
    const command = join(process.env.APPDATA ?? "", "npm", "claude.cmd")
    if (existsSync(command)) return command
  }
}

export function launchCommand(claudeSessionID: string, resume: boolean, executable = "claude", permissionMode?: PermissionMode) {
  const args = [
    ...(resume ? ["--resume", claudeSessionID] : ["--session-id", claudeSessionID]),
    ...(permissionMode ? ["--permission-mode", permissionMode === "default" ? "manual" : permissionMode] : []),
  ]
  if (process.platform !== "win32") return { command: executable, args }
  const command = executable === "claude" ? executable : `"${executable}"`
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `${command} ${args.join(" ")}`] }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    const state = yield* InstanceState.make<State>(() => Effect.sync(() => ({ active: new Map(), permissionMode: new Map() })))
    const models = yield* Effect.promise(resolveModels)
    const configuredPermissionMode = yield* Effect.promise(resolvePermissionMode)

    const capability = Effect.fn("ClaudeCode.capability")(function* () {
      if (Flag.LFCODE_CLIENT !== "desktop") return { available: false, reason: "desktop_only" } as const
      if (Flag.LFCODE_WORKSPACE_ID) return { available: false, reason: "remote_instance" } as const
      if (!(yield* Effect.promise(resolveCommand))) return { available: false, reason: "command_not_found" } as const
      return { available: true } as const
    })

    const getRow = (sessionID: SessionID) =>
      Effect.sync(() =>
        Database.use((db) =>
          db.select().from(ClaudeCodeSessionTable).where(eq(ClaudeCodeSessionTable.session_id, sessionID)).get(),
        ),
      )

    const get = Effect.fn("ClaudeCode.get")(function* (sessionID: SessionID) {
      const row = yield* getRow(sessionID)
      if (!row) return
      const current = yield* InstanceState.get(state)
      const ptyID = current.active.get(sessionID)
      const currentMode = current.permissionMode.get(sessionID) ?? row.permission_mode ?? configuredPermissionMode
      if (!ptyID) return { ...toBinding(row, undefined, currentMode), models }
      if (yield* pty.get(ptyID)) return { ...toBinding(row, ptyID, currentMode), models }
      current.active.delete(sessionID)
      return { ...toBinding(row, undefined, currentMode), models }
    })

    const close = Effect.fn("ClaudeCode.close")(function* (sessionID: SessionID) {
      const current = yield* InstanceState.get(state)
      const ptyID = current.active.get(sessionID)
      current.active.delete(sessionID)
      if (ptyID) yield* pty.remove(ptyID)
    })

    const create = Effect.fn("ClaudeCode.create")(function* (session: Session.Info) {
      const existing = yield* get(session.id)
      if (existing) return existing
      const now = Date.now()
      const row: typeof ClaudeCodeSessionTable.$inferInsert = {
        session_id: session.id,
        claude_session_id: randomUUID(),
        directory: session.directory,
        can_resume: false,
        permission_mode: configuredPermissionMode,
        time_created: now,
        time_updated: now,
      }
      yield* Effect.sync(() => Database.use((db) => db.insert(ClaudeCodeSessionTable).values(row).run()))
      return { ...toBinding({ ...row, can_resume: false, permission_mode: configuredPermissionMode }, undefined, configuredPermissionMode), models }
    })

    const reset = Effect.fn("ClaudeCode.reset")(function* (sessionID: SessionID) {
      const row = yield* getRow(sessionID)
      if (!row) throw new Error("Claude Code session binding not found")
      yield* close(sessionID)
      const current = yield* InstanceState.get(state)
      current.permissionMode.delete(sessionID)
      const now = Date.now()
      const claudeSessionID = randomUUID()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(ClaudeCodeSessionTable)
            .set({ claude_session_id: claudeSessionID, can_resume: false, permission_mode: configuredPermissionMode, time_created: now, time_updated: now })
            .where(eq(ClaudeCodeSessionTable.session_id, sessionID))
            .run(),
        ),
      )
      return { ...toBinding({ ...row, claude_session_id: claudeSessionID, can_resume: false, permission_mode: configuredPermissionMode, time_created: now, time_updated: now }, undefined, configuredPermissionMode), models }
    })

    const open = Effect.fn("ClaudeCode.open")(function* (sessionID: SessionID, mode?: PermissionMode) {
      const available = yield* capability()
      if (!available.available) throw new Error(`Claude Code unavailable: ${available.reason}`)
      const row = yield* getRow(sessionID)
      if (!row) throw new Error("Claude Code session binding not found")
      const current = yield* InstanceState.get(state)
      const active = current.active.get(sessionID)
      const currentMode = mode ?? current.permissionMode.get(sessionID) ?? row.permission_mode ?? configuredPermissionMode
      if (active && (yield* pty.get(active))) return { ...toBinding(row, active, currentMode), models }
      current.active.delete(sessionID)

      const executable = yield* Effect.promise(resolveCommand)
      if (!executable) throw new Error("Claude Code unavailable: command_not_found")
      const command = launchCommand(row.claude_session_id, row.can_resume, executable, currentMode)
      const created = yield* pty.create({
        command: command.command,
        args: command.args,
        cwd: row.directory,
        // Preserve Claude Code's native ANSI interface in the embedded terminal.
        env: { TERM: "xterm-256color", COLORTERM: "truecolor", FORCE_COLOR: "3" },
        title: "Claude Code",
      })
      current.active.set(sessionID, created.id)
      if (mode) current.permissionMode.set(sessionID, mode)
      yield* Effect.forkDetach(
        Effect.sleep("2 seconds").pipe(
          Effect.flatMap(() => pty.get(created.id)),
          Effect.flatMap((active) => {
            if (!active) return Effect.void
            return Effect.sync(() =>
              Database.use((db) =>
                db
                  .update(ClaudeCodeSessionTable)
                  .set({ can_resume: true, time_updated: Date.now() })
                  .where(eq(ClaudeCodeSessionTable.session_id, sessionID))
                  .run(),
              ),
            )
          }),
        ),
      )
      return { ...toBinding(row, created.id, currentMode), models }
    })

    const setPermissionMode = Effect.fn("ClaudeCode.setPermissionMode")(function* (sessionID: SessionID, mode: PermissionMode) {
      const row = yield* getRow(sessionID)
      if (!row) throw new Error("Claude Code session binding not found")
      yield* close(sessionID)
      const binding = yield* open(sessionID, mode)
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(ClaudeCodeSessionTable)
            .set({ permission_mode: mode, time_updated: Date.now() })
            .where(eq(ClaudeCodeSessionTable.session_id, sessionID))
            .run(),
        ),
      )
      return binding
    })

    const input = Effect.fn("ClaudeCode.input")(function* (sessionID: SessionID, data: string) {
      const row = yield* getRow(sessionID)
      if (!row) throw new Error("Claude Code session binding not found")
      const current = yield* InstanceState.get(state)
      const ptyID = current.active.get(sessionID)
      if (!ptyID || !(yield* pty.get(ptyID))) {
        current.active.delete(sessionID)
        throw new Error("Claude Code terminal is not connected")
      }
      yield* pty.write(ptyID, withEnter(data))
    })

    const key = Effect.fn("ClaudeCode.key")(function* (sessionID: SessionID, data: string) {
      const row = yield* getRow(sessionID)
      if (!row) throw new Error("Claude Code session binding not found")
      const current = yield* InstanceState.get(state)
      const ptyID = current.active.get(sessionID)
      if (!ptyID || !(yield* pty.get(ptyID))) {
        current.active.delete(sessionID)
        throw new Error("Claude Code terminal is not connected")
      }
      yield* pty.write(ptyID, withKey(data))
    })

    return Service.of({ capability, get, create, reset, open, setPermissionMode, input, key, close })
  }),
)

export function withEnter(data: string) {
  return `${data}\r`
}

export function withKey(data: string) {
  return data
}

export const ClaudeCode = { Capability, PermissionMode, Binding, Service, layer }
