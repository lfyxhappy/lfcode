import z from "zod"
import * as nodeFs from "fs/promises"
import * as nodePath from "path"
import { randomUUID } from "crypto"
import { and, Database, desc, eq, inArray, sql } from "../storage"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { sessionDirectoryAliases } from "../session/directory"
import { Flag } from "@/flag/flag"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { resolveGitCommand } from "@/git/runtime"
import { which } from "../util/which"
import { ProjectID } from "./schema"
import { resolveMainGitDir, resolveProjectId } from "./project-id"
import { Effect, Layer, Path, Scope, Context, Stream, Types, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@/filesystem"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

async function setupProjectIdEnvironment(workingDir: string): Promise<void> {
  const mainGit = resolveMainGitDir(workingDir)
  if (!mainGit) return

  const localFile = nodePath.join(workingDir, ".lfcode-project-id")
  const idFile = nodePath.join(mainGit, "lfcode-project-id")
  const exists = (file: string) => nodeFs.access(file).then(() => true).catch(() => false)

  if (await exists(localFile)) {
    if (!(await exists(idFile))) {
      const id = await nodeFs.readFile(localFile, "utf8")
      await nodeFs.writeFile(idFile, id)
    }
    await nodeFs.unlink(localFile).catch(() => {})
  }

  // Belt-and-suspenders: ensure .git/info/exclude lists .lfcode-project-id
  const excludeFile = nodePath.join(mainGit, "info", "exclude")
  await nodeFs.mkdir(nodePath.dirname(excludeFile), { recursive: true })
  const existing = await nodeFs.readFile(excludeFile, "utf8").catch(() => "")
  if (!existing.includes(".lfcode-project-id")) {
    await nodeFs.appendFile(excludeFile, "\n.lfcode-project-id\n")
  }
}

const ProjectVcs = Schema.Literal("git")

const ProjectIcon = Schema.Struct({
  url: Schema.optional(Schema.String),
  override: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
})

const ProjectCommands = Schema.Struct({
  start: Schema.optional(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
})

const ProjectTime = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  lastUser: Schema.optional(Schema.Number),
  initialized: Schema.optional(Schema.Number),
})

export const ProjectExtension = Schema.Struct({
  pluginID: Schema.String,
  type: Schema.String,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type ProjectExtension = Types.DeepMutable<Schema.Schema.Type<typeof ProjectExtension>>

export const Info = Schema.Struct({
  id: ProjectID,
  worktree: Schema.String,
  vcs: Schema.optional(ProjectVcs),
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  commands: Schema.optional(ProjectCommands),
  extension: Schema.optional(ProjectExtension),
  time: ProjectTime,
  sandboxes: Schema.Array(Schema.String),
})
  .annotate({ identifier: "Project" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Event = {
  Updated: BusEvent.define("project.updated", Info.zod),
}

type Row = typeof ProjectTable.$inferSelect

export function fromRow(row: Row): Info {
  const icon =
    row.icon_url || row.icon_color ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined } : undefined
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(ProjectVcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    extension: row.extension ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      lastUser: row.time_last_user ?? undefined,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
  }
}

export const UpdateInput = z.object({
  projectID: ProjectID.zod,
  name: z.string().optional(),
  icon: zod(ProjectIcon).optional(),
  commands: zod(ProjectCommands).optional(),
})
export type UpdateInput = z.infer<typeof UpdateInput>

export const CreateManagedInput = z.object({
  extension: ProjectExtension.zod,
  worktree: z.string().min(1),
  name: z.string().optional(),
  icon: zod(ProjectIcon).optional(),
  commands: zod(ProjectCommands).optional(),
})
export type CreateManagedInput = z.infer<typeof CreateManagedInput>

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
  readonly discover: (input: Info) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ProjectID) => Effect.Effect<Info | undefined>
  readonly update: (input: UpdateInput) => Effect.Effect<Info>
  readonly createManagedProject: (input: CreateManagedInput) => Effect.Effect<Info>
  readonly getManagedProject: (extension: ProjectExtension) => Effect.Effect<Info | undefined>
  readonly removeManagedProject: (extension: ProjectExtension) => Effect.Effect<boolean>
  readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info>
  readonly setInitialized: (id: ProjectID) => Effect.Effect<void>
  readonly sandboxes: (id: ProjectID) => Effect.Effect<string[]>
  readonly addSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
  readonly removeSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Project") {}

type GitResult = { code: number; text: string; stderr: string }

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const pathSvc = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const gitCommand = resolveGitCommand()

    const git = Effect.fnUntraced(
      function* (args: string[], opts?: { cwd?: string }) {
        const handle = yield* spawner.spawn(
          ChildProcess.make(gitCommand, args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        const [text, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return { code, text, stderr } satisfies GitResult
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
    )

    const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
      Effect.sync(() => Database.use(fn))

    const emitUpdated = (data: Info) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          project: data.id,
          payload: { type: Event.Updated.type, properties: data },
        }),
      )

    const fakeVcs = Schema.decodeUnknownSync(Schema.optional(ProjectVcs))(Flag.LFCODE_FAKE_VCS)

    const managedProject = Effect.fn("Project.managedProject")(function* (extension: ProjectExtension) {
      const rows = yield* db((d) => d.select().from(ProjectTable).all())
      const row = rows.find(
        (item) => item.extension?.pluginID === extension.pluginID && item.extension.type === extension.type,
      )
      return row ? fromRow(row) : undefined
    })

    const resolveGitPath = (cwd: string, name: string) => {
      if (!name) return cwd
      name = name.replace(/[\r\n]+$/, "")
      if (!name) return cwd
      name = AppFileSystem.windowsPath(name)
      if (pathSvc.isAbsolute(name)) return pathSvc.normalize(name)
      return pathSvc.resolve(cwd, name)
    }

    const scope = yield* Scope.Scope

    const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
      // Phase 1: discover git info
      type DiscoveryResult = { id: ProjectID; worktree: string; sandbox: string; vcs: Info["vcs"] }

      const data: DiscoveryResult = yield* Effect.gen(function* () {
        const target = pathSvc.resolve(directory)
        const managed = (yield* db((d) => d.select().from(ProjectTable).all()))
          .filter((row) => row.extension)
          .map(fromRow)
          .map((project) => ({ project, worktree: pathSvc.resolve(project.worktree) }))
          .filter(({ worktree }) => target === worktree || target.startsWith(`${worktree}${pathSvc.sep}`))
          .sort((a, b) => b.worktree.length - a.worktree.length)[0]?.project
        if (managed) {
          return {
            id: managed.id,
            worktree: managed.worktree,
            sandbox: target,
            vcs: undefined,
          }
        }

        if (Flag.LFCODE_DISABLE_GIT) {
          return {
            id: ProjectID.global,
            worktree: directory,
            sandbox: directory,
            vcs: fakeVcs,
          }
        }

        const dotgitMatches = yield* fs.up({ targets: [".git"], start: directory }).pipe(Effect.orDie)
        const dotgit = dotgitMatches[0]

        if (!dotgit) {
          return {
            id: ProjectID.global,
            worktree: "/",
            sandbox: "/",
            vcs: fakeVcs,
          }
        }

        let sandbox = pathSvc.dirname(dotgit)
        const gitBinary = yield* Effect.sync(() => which("git"))
        let id: ProjectID | undefined

        if (!gitBinary) {
          return {
            id: id ?? ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }

        const commonDir = yield* git(["rev-parse", "--git-common-dir"], { cwd: sandbox })
        if (commonDir.code !== 0) {
          return {
            id: id ?? ProjectID.global,
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }
        const worktree = (() => {
          const common = resolveGitPath(sandbox, commonDir.text.trim())
          return common === sandbox ? sandbox : pathSvc.dirname(common)
        })()

        if (id == null) {
          yield* Effect.promise(() => setupProjectIdEnvironment(sandbox))
          id = resolveProjectId(sandbox)
        }

        const topLevel = yield* git(["rev-parse", "--show-toplevel"], { cwd: sandbox })
        if (topLevel.code !== 0) {
          return {
            id,
            worktree: sandbox,
            sandbox,
            vcs: fakeVcs,
          }
        }
        sandbox = resolveGitPath(sandbox, topLevel.text.trim())

        return { id, sandbox, worktree, vcs: "git" as const }
      })

      // Phase 2: upsert
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
      const existing = row
        ? fromRow(row)
        : {
            id: data.id,
            worktree: data.worktree,
            vcs: data.vcs,
            sandboxes: [] as string[],
            time: { created: Date.now(), updated: Date.now() },
          }

      if (Flag.LFCODE_EXPERIMENTAL_ICON_DISCOVERY) yield* discover(existing).pipe(Effect.ignore, Effect.forkIn(scope))

      const result: Info = {
        ...existing,
        worktree: data.worktree,
        vcs: data.vcs,
        time: { ...existing.time, updated: Date.now() },
      }
      if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
        result.sandboxes.push(data.sandbox)
      result.sandboxes = yield* Effect.forEach(
        result.sandboxes,
        (s) =>
          fs.exists(s).pipe(
            Effect.orDie,
            Effect.map((exists) => (exists ? s : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))

      yield* db((d) =>
        d
          .insert(ProjectTable)
          .values({
            id: result.id,
            worktree: result.worktree,
            vcs: result.vcs ?? null,
            name: result.name,
            icon_url: result.icon?.url,
            icon_color: result.icon?.color,
            time_created: result.time.created,
            time_updated: result.time.updated,
            time_last_user: result.time.lastUser,
            time_initialized: result.time.initialized,
            sandboxes: result.sandboxes,
            commands: result.commands,
            extension: result.extension,
          })
          .onConflictDoUpdate({
            target: ProjectTable.id,
            set: {
              worktree: result.worktree,
              vcs: result.vcs ?? null,
              name: result.name,
              icon_url: result.icon?.url,
              icon_color: result.icon?.color,
              time_updated: result.time.updated,
              time_last_user: result.time.lastUser,
              time_initialized: result.time.initialized,
              sandboxes: result.sandboxes,
              commands: result.commands,
              extension: result.extension,
            },
          })
          .run(),
      )

      if (data.id !== ProjectID.global) {
        yield* db((d) =>
          d
            .update(SessionTable)
            .set({ project_id: data.id })
            .where(
              and(
                eq(SessionTable.project_id, ProjectID.global),
                inArray(SessionTable.directory, sessionDirectoryAliases(data.worktree)),
              ),
            )
            .run(),
        )
      }

      yield* emitUpdated(result)
      return { project: result, sandbox: data.sandbox }
    })

    const discover = Effect.fn("Project.discover")(function* (input: Info) {
      if (input.vcs !== "git") return
      if (input.icon?.override) return
      if (input.icon?.url) return

      const matches = yield* fs
        .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
          cwd: input.worktree,
          absolute: true,
          include: "file",
        })
        .pipe(Effect.orDie)
      const shortest = matches.sort((a, b) => a.length - b.length)[0]
      if (!shortest) return

      const buffer = yield* fs.readFile(shortest).pipe(Effect.orDie)
      const base64 = Buffer.from(buffer).toString("base64")
      const mime = AppFileSystem.mimeType(shortest)
      const url = `data:${mime};base64,${base64}`
      yield* update({ projectID: input.id, icon: { url } })
    })

    const list = Effect.fn("Project.list")(function* () {
      return yield* db((d) =>
        d
          .select()
          .from(ProjectTable)
          .orderBy(desc(sql<number>`coalesce(${ProjectTable.time_last_user}, ${ProjectTable.time_created})`), desc(ProjectTable.id))
          .all()
          .map(fromRow),
      )
    })

    const get = Effect.fn("Project.get")(function* (id: ProjectID) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      return row ? fromRow(row) : undefined
    })

    const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
      const result = yield* db((d) =>
        d
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, input.projectID))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      yield* emitUpdated(data)
      return data
    })

    const createManagedProject = Effect.fn("Project.createManagedProject")(function* (input: CreateManagedInput) {
      const existing = yield* managedProject(input.extension)
      if (existing) return existing

      const worktree = pathSvc.resolve(input.worktree)
      yield* fs.makeDirectory(worktree, { recursive: true }).pipe(Effect.orDie)
      const result: Info = {
        id: ProjectID.make(randomUUID()),
        worktree,
        name: input.name,
        icon: input.icon,
        commands: input.commands,
        extension: input.extension,
        sandboxes: [],
        time: { created: Date.now(), updated: Date.now() },
      }
      yield* db((d) =>
        d
          .insert(ProjectTable)
          .values({
            id: result.id,
            worktree: result.worktree,
            vcs: null,
            name: result.name,
            icon_url: result.icon?.url,
            icon_color: result.icon?.color,
            time_created: result.time.created,
            time_updated: result.time.updated,
            sandboxes: result.sandboxes,
            commands: result.commands,
            extension: result.extension,
          })
          .run(),
      )
      yield* emitUpdated(result)
      return result
    })

    const getManagedProject = Effect.fn("Project.getManagedProject")(function* (extension: ProjectExtension) {
      return yield* managedProject(extension)
    })

    const removeManagedProject = Effect.fn("Project.removeManagedProject")(function* (extension: ProjectExtension) {
      const project = yield* managedProject(extension)
      if (!project) return false
      yield* db((d) => d.delete(ProjectTable).where(eq(ProjectTable.id, project.id)).run())
      return true
    })

    const initGit = Effect.fn("Project.initGit")(function* (input: { directory: string; project: Info }) {
      if (input.project.vcs === "git") return input.project
      if (!(yield* Effect.sync(() => which(gitCommand)))) throw new Error("Git is not installed")
      const result = yield* git(["init", "--quiet"], { cwd: input.directory })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.text.trim() || "Failed to initialize git repository")
      }
      const { project } = yield* fromDirectory(input.directory)
      return project
    })

    const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectID) {
      yield* db((d) =>
        d.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
      )
    })

    const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectID) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      if (!row) return []
      const data = fromRow(row)
      return yield* Effect.forEach(
        data.sandboxes,
        (dir) =>
          fs.isDir(dir).pipe(
            Effect.orDie,
            Effect.map((ok) => (ok ? dir : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))
    })

    const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectID, directory: string) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      if (!row) throw new Error(`Project not found: ${id}`)
      const sboxes = [...row.sandboxes]
      if (!sboxes.includes(directory)) sboxes.push(directory)
      const result = yield* db((d) =>
        d
          .update(ProjectTable)
          .set({ sandboxes: sboxes, time_updated: Date.now() })
          .where(eq(ProjectTable.id, id))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectID, directory: string) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
      if (!row) throw new Error(`Project not found: ${id}`)
      const sboxes = row.sandboxes.filter((s) => s !== directory)
      const result = yield* db((d) =>
        d
          .update(ProjectTable)
          .set({ sandboxes: sboxes, time_updated: Date.now() })
          .where(eq(ProjectTable.id, id))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    return Service.of({
      fromDirectory,
      discover,
      list,
      get,
      update,
      createManagedProject,
      getManagedProject,
      removeManagedProject,
      initGit,
      setInitialized,
      sandboxes,
      addSandbox,
      removeSandbox,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
)

export function list() {
  return Database.use((db) =>
    db
      .select()
      .from(ProjectTable)
      .all()
      .map((row) => fromRow(row)),
  )
}

export function get(id: ProjectID): Info | undefined {
  const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
  if (!row) return undefined
  return fromRow(row)
}

export function setInitialized(id: ProjectID) {
  Database.use((db) =>
    db.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
  )
}

export async function ensureManagedProject(input: CreateManagedInput): Promise<Info> {
  const existing = Database.use((db) =>
    db
      .select()
      .from(ProjectTable)
      .all()
      .find((item) => item.extension?.pluginID === input.extension.pluginID && item.extension.type === input.extension.type),
  )
  if (existing) return fromRow(existing)

  const worktree = nodePath.resolve(input.worktree)
  await nodeFs.mkdir(worktree, { recursive: true })
  const result: Info = {
    id: ProjectID.make(randomUUID()),
    worktree,
    name: input.name,
    icon: input.icon,
    commands: input.commands,
    extension: input.extension,
    sandboxes: [],
    time: { created: Date.now(), updated: Date.now() },
  }
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: result.id,
        worktree: result.worktree,
        vcs: null,
        name: result.name,
        icon_url: result.icon?.url,
        icon_color: result.icon?.color,
        time_created: result.time.created,
        time_updated: result.time.updated,
        sandboxes: result.sandboxes,
        commands: result.commands,
        extension: result.extension,
      })
      .run(),
  )
  GlobalBus.emit("event", {
    directory: "global",
    project: result.id,
    payload: { type: Event.Updated.type, properties: result },
  })
  return result
}

export async function removeManagedProject(extension: ProjectExtension): Promise<boolean> {
  const project = Database.use((db) =>
    db
      .select()
      .from(ProjectTable)
      .all()
      .find((item) => item.extension?.pluginID === extension.pluginID && item.extension.type === extension.type),
  )
  if (!project) return false
  Database.use((db) => db.delete(ProjectTable).where(eq(ProjectTable.id, project.id)).run())
  return true
}

