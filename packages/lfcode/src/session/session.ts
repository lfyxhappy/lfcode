import { Slug } from "@lfcode-ai/shared/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata, type LanguageModelUsage } from "ai"
import { Flag } from "../flag/flag"
import { InstallationVersion } from "../installation/version"

import { Database, NotFoundError, eq, and, gte, isNull, desc, like, inArray, lt, sql } from "../storage"
import { SyncEvent } from "../sync"
import type { SQL } from "../storage"
import { PartTable, SessionTable, MessageTable } from "./session.sql"
import { cleanupSessionHooks } from "@/hook/persistence"
import { dispatchHooks } from "@/hook/runtime"
import { ProjectTable } from "../project/project.sql"
import { Storage } from "@/storage"
import { Log } from "../util"
import { updateSchema } from "../util/update-schema"
import { MessageV2 } from "./message-v2"
import { sessionDirectoryAliases } from "./directory"
import { GlobalBus } from "@/bus/global"
import { Project, Vcs } from "../project"
import { Instance } from "../project/instance"
import { InstanceState } from "@/effect"
import { ProjectID } from "../project/schema"
import { WorkspaceID } from "../control-plane/schema"
import { SessionID, MessageID, PartID } from "./schema"
import { GoalState } from "./goal-state"
import { SessionInteraction } from "./interaction"
import { isRealUserPart } from "./part-helpers"
import { hydrateStoredPart } from "./part-blob"
import { MAX_SESSION_DIFF_STORAGE_BYTES, isStoredDiffTooLarge, storedDiffSize } from "./diff-storage"

import type { Provider } from "@/provider"
import { Permission } from "@/permission"
import { Global } from "@/global"
import { ActorRegistry } from "@/actor/registry"
import { ContextPlan } from "./context-plan"
import { Activity } from "@/activity"
import { Effect, Layer, Option, Context } from "effect"

const log = Log.create({ service: "session" })

const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "
const ORPHAN_ASSISTANT_AGE_MS = 3_600_000

function isRealUserMessage(message: MessageV2.WithParts) {
  if (message.info.role !== "user") return false
  return message.parts.some(isRealUserPart)
}

function createDefaultTitle(isChild = false) {
  return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
}

export function isDefaultTitle(title: string) {
  return new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}

type SessionRow = typeof SessionTable.$inferSelect

export function fromRow(row: SessionRow): Info {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  const share = row.share_url ? { url: row.share_url } : undefined
  const revert = row.revert ?? undefined
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    parentID: row.parent_id ?? undefined,
    contextFrom: row.context_from ?? undefined,
    contextWatermark: row.context_watermark ?? undefined,
    title: row.title,
    version: row.version,
    temporary: row.temporary === 1,
    summary,
    share,
    revert,
    permission: row.permission ?? undefined,
    goal: row.goal ?? undefined,
    interaction: row.interaction ?? undefined,
    extension: row.extension ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      lastUser: row.time_last_user ?? undefined,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

export function toRow(info: Info) {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID,
    parent_id: info.parentID,
    context_from: info.contextFrom,
    context_watermark: info.contextWatermark,
    slug: info.slug,
    directory: info.directory,
    title: info.title,
    version: info.version,
    temporary: info.temporary ? 1 : 0,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs,
    revert: info.revert ?? null,
    permission: info.permission,
    goal: info.goal,
    interaction: info.interaction,
    extension: info.extension,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_last_user: info.time.lastUser,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function getForkedTitle(title: string): string {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) {
    const base = match[1]
    const num = parseInt(match[2], 10)
    return `${base} (fork #${num + 1})`
  }
  return `${title} (fork #1)`
}

export const Info = z
  .object({
    id: SessionID.zod,
    slug: z.string(),
    projectID: ProjectID.zod,
    workspaceID: WorkspaceID.zod.optional(),
    directory: z.string(),
    parentID: SessionID.zod.optional(),
    contextFrom: SessionID.zod.optional(),
    contextWatermark: MessageID.zod.optional(),
    summary: z
      .object({
        additions: z.number(),
        deletions: z.number(),
        files: z.number(),
        diffs: Vcs.FileDiff.array().optional(),
      })
      .optional(),
    share: z
      .object({
        url: z.string(),
      })
      .optional(),
    title: z.string(),
    version: z.string(),
    temporary: z.boolean().default(false),
    time: z.object({
      created: z.number(),
      updated: z.number(),
      lastUser: z.number().optional(),
      compacting: z.number().optional(),
      archived: z.number().optional(),
    }),
    permission: Permission.Ruleset.zod.optional(),
    goal: GoalState.optional(),
    interaction: SessionInteraction.Info.optional(),
    extension: Project.ProjectExtension.zod.optional(),
    revert: z
      .object({
        messageID: MessageID.zod,
        partID: PartID.zod.optional(),
        diff: z.string().optional(),
      })
      .optional(),
  })
  .meta({
    ref: "Session",
  })
export type Info = z.output<typeof Info>

export const ProjectInfo = z
  .object({
    id: ProjectID.zod,
    name: z.string().optional(),
    worktree: z.string(),
  })
  .meta({
    ref: "ProjectSummary",
  })
export type ProjectInfo = z.output<typeof ProjectInfo>

export const GlobalInfo = Info.extend({
  project: ProjectInfo.nullable(),
}).meta({
  ref: "GlobalSession",
})
export type GlobalInfo = z.output<typeof GlobalInfo>

export const CreateInput = z
  .object({
    parentID: SessionID.zod.optional(),
    contextFrom: SessionID.zod.optional(),
    contextWatermark: MessageID.zod.optional(),
    title: z.string().optional(),
    permission: Info.shape.permission,
    workspaceID: WorkspaceID.zod.optional(),
    temporary: z.boolean().optional(),
  })
  .optional()
export type CreateInput = z.output<typeof CreateInput>

export const CreateManagedInput = z.object({
  projectID: ProjectID.zod,
  extension: Project.ProjectExtension.zod,
  title: z.string().optional(),
  permission: Info.shape.permission,
  temporary: z.boolean().optional(),
})
export type CreateManagedInput = z.output<typeof CreateManagedInput>

export const ImportHistoryInput = CreateManagedInput.extend({
  sessionID: SessionID.zod.optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      time: z.number().optional(),
      swipes: z.string().array().optional(),
      swipeID: z.number().int().nonnegative().optional(),
    }),
  ),
})
export type ImportHistoryInput = z.output<typeof ImportHistoryInput>

export const ForkInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  includeMessage: z.boolean().optional(),
})
export const GetInput = SessionID.zod
export const ChildrenInput = SessionID.zod
export const RemoveInput = SessionID.zod
export const SetTitleInput = z.object({ sessionID: SessionID.zod, title: z.string() })
export const SetArchivedInput = z.object({ sessionID: SessionID.zod, time: z.number().nullable().optional() })
export const SetCompactingInput = z.object({ sessionID: SessionID.zod, time: z.number().nullable().optional() })
export const SetPermissionInput = z.object({ sessionID: SessionID.zod, permission: Permission.Ruleset.zod })
export const SetGoalInput = z.object({ sessionID: SessionID.zod, goal: GoalState.nullable() })
export const SetInteractionInput = z.object({
  sessionID: SessionID.zod,
  interaction: SessionInteraction.Info.nullable(),
})
export const SetRevertInput = z.object({
  sessionID: SessionID.zod,
  revert: Info.shape.revert,
  summary: Info.shape.summary,
})
export const MessagesInput = z.object({ sessionID: SessionID.zod, limit: z.number().optional() })

export const Event = {
  Created: SyncEvent.define({
    type: "session.created",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      info: Info,
    }),
  }),
  Updated: SyncEvent.define({
    type: "session.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      info: updateSchema(Info).extend({
        share: updateSchema(Info.shape.share.unwrap()).optional(),
        time: updateSchema(Info.shape.time).optional(),
      }),
    }),
    busSchema: z.object({
      sessionID: SessionID.zod,
      info: Info,
    }),
  }),
  Deleted: SyncEvent.define({
    type: "session.deleted",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      info: Info,
    }),
  }),
  Diff: BusEvent.define(
    "session.diff",
    z.object({
      sessionID: SessionID.zod,
      diff: Vcs.FileDiff.array(),
    }),
  ),
  Error: BusEvent.define(
    "session.error",
    z.object({
      sessionID: SessionID.zod.optional(),
      // Internal system actors may fail after their hidden messages have been
      // persisted. Event consumers must not turn that failure into a visible
      // toast, LAN event, or plugin notification.
      visible: z.boolean().optional(),
      // z.lazy defers access to break circular dep: session → message-v2 → provider → plugin → session
      error: z.lazy(() => MessageV2.Assistant.shape.error),
    }),
  ),
  RetryAttempt: BusEvent.define(
    "session.retry.attempt",
    z.object({
      sessionID: SessionID.zod,
      messageID: z.string(),
      attempt: z.number().int().min(1),
      maxAttempts: z.number().int().min(1),
      reason: z.string(),
      nextDelayMs: z.number().int().nonnegative(),
    }),
  ),
}

export function plan(input: { slug: string; time: { created: number } }) {
  const base = Instance.project.vcs
    ? path.join(Instance.worktree, ".lfcode", "plans")
    : path.join(Global.Path.data, "plans")
  return path.join(base, [input.time.created, input.slug].join("-") + ".md")
}

export const getUsage = (input: { model: Provider.Model; usage: LanguageModelUsage; metadata?: ProviderMetadata }) => {
  const safe = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return value
  }
  const inputTokens = safe(input.usage.inputTokens ?? 0)
  const outputTokens = safe(input.usage.outputTokens ?? 0)
  const reasoningTokens = safe(input.usage.outputTokenDetails?.reasoningTokens ?? input.usage.reasoningTokens ?? 0)

  const cacheReadInputTokens = safe(
    input.usage.inputTokenDetails?.cacheReadTokens ?? input.usage.cachedInputTokens ?? 0,
  )
  const cacheWriteInputTokens = safe(
    Number(
      input.usage.inputTokenDetails?.cacheWriteTokens ??
        input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        // google-vertex-anthropic returns metadata under "vertex" key
        // (AnthropicMessagesLanguageModel custom provider key from 'vertex.anthropic.messages')
        input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
        0,
    ),
  )

  // AI SDK v6 normalized inputTokens to include cached tokens across all providers
  // (including Anthropic/Bedrock which previously excluded them). Always subtract cache
  // tokens to get the non-cached input count for separate cost calculation.
  const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

  const total = input.usage.totalTokens

  const tokens = {
    total,
    input: adjustedInputTokens,
    output: safe(outputTokens - reasoningTokens),
    reasoning: reasoningTokens,
    cache: {
      write: cacheWriteInputTokens,
      read: cacheReadInputTokens,
    },
  }

  const costInfo =
    input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
      ? input.model.cost.experimentalOver200K
      : input.model.cost
  return {
    cost: safe(
      new Decimal(0)
        .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
        .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
        // TODO: update models.dev to have better pricing model, for now:
        // charge reasoning tokens at the same rate as output tokens
        .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
        .toNumber(),
    ),
    tokens,
  }
}

export class BusyError extends Error {
  constructor(public readonly sessionID: string) {
    super(`Session ${sessionID} is busy`)
  }
}

export interface Interface {
  readonly create: (input?: {
    parentID?: SessionID
    contextFrom?: SessionID
    contextWatermark?: MessageID
    title?: string
    permission?: Permission.Ruleset
    workspaceID?: WorkspaceID
    temporary?: boolean
  }) => Effect.Effect<Info>
  readonly createManaged: (input: CreateManagedInput) => Effect.Effect<Info>
  readonly fork: (input: { sessionID: SessionID; messageID?: MessageID; includeMessage?: boolean }) => Effect.Effect<Info>
  readonly touch: (sessionID: SessionID) => Effect.Effect<void>
  readonly setLastUserActivity: (input: { sessionID: SessionID; at: number }) => Effect.Effect<void>
  readonly get: (id: SessionID) => Effect.Effect<Info>
  readonly setTitle: (input: { sessionID: SessionID; title: string }) => Effect.Effect<void>
  readonly setArchived: (input: { sessionID: SessionID; time?: number | null }) => Effect.Effect<void>
  readonly setCompacting: (input: { sessionID: SessionID; time?: number | null }) => Effect.Effect<void>
  readonly setPermission: (input: { sessionID: SessionID; permission: Permission.Ruleset }) => Effect.Effect<void>
  readonly setGoal: (input: { sessionID: SessionID; goal?: z.infer<typeof GoalState> }) => Effect.Effect<void>
  readonly setInteraction: (input: {
    sessionID: SessionID
    interaction?: z.infer<typeof SessionInteraction.Info>
  }) => Effect.Effect<void>
  readonly setRevert: (input: {
    sessionID: SessionID
    revert: Info["revert"]
    summary: Info["summary"]
  }) => Effect.Effect<void>
  readonly clearRevert: (sessionID: SessionID) => Effect.Effect<void>
  readonly setSummary: (input: { sessionID: SessionID; summary: Info["summary"] }) => Effect.Effect<void>
  readonly diff: (sessionID: SessionID) => Effect.Effect<Vcs.FileDiff[]>
  readonly messages: (input: {
    sessionID: SessionID
    limit?: number
    /**
     * Slice selector.
     * `undefined` (default) returns the main-agent slice only.
     * `"main"` is equivalent to `undefined`.
     * `"*"` returns every message in the session, regardless of slice
     * (export / stats / share / cross-slice diagnostic paths only —
     * almost no production caller wants this).
     * Any other string returns the slice owned by that subagent actor
     * (`agent_id = <id>`).
     */
    agentID?: string
  }) => Effect.Effect<MessageV2.WithParts[]>
  readonly children: (parentID: SessionID) => Effect.Effect<Info[]>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void>
  readonly cleanupTemporary: () => Effect.Effect<number>
  readonly updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
  readonly removeMessage: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<MessageID>
  readonly removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }) => Effect.Effect<PartID>
  readonly getPart: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
  }) => Effect.Effect<MessageV2.Part | undefined>
  readonly updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  readonly updatePartDelta: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
    field: string
    delta: string
  }) => Effect.Effect<void>
  /** Finds the first message matching the predicate, searching newest-first.
   *
   * Slice contract: `options.agentID` defaults to `"main"` (mirrors `messages()`).
   * Pass `"*"` for cross-slice lookup. */
  readonly findMessage: (
    sessionID: SessionID,
    predicate: (msg: MessageV2.WithParts) => boolean,
    options?: { agentID?: string },
  ) => Effect.Effect<Option.Option<MessageV2.WithParts>>
  readonly lastMainMessageID: (sessionID: SessionID) => Effect.Effect<MessageID | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Session") {}

type Patch = z.infer<typeof Event.Updated.schema>["info"]

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

export const layer: Layer.Layer<Service, never, Bus.Service | Storage.Service | ActorRegistry.Service | Activity.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const storage = yield* Storage.Service
    const actorReg = yield* ActorRegistry.Service
    const activity = yield* Activity.Service

    const createNext = Effect.fn("Session.createNext")(function* (input: {
      id?: SessionID
      projectID: ProjectID
      extension?: Project.ProjectExtension
      title?: string
      parentID?: SessionID
      contextFrom?: SessionID
      contextWatermark?: MessageID
      workspaceID?: WorkspaceID
      directory: string
      permission?: Permission.Ruleset
      temporary?: boolean
    }) {
      const result: Info = {
        id: SessionID.descending(input.id),
        slug: Slug.create(),
        version: InstallationVersion,
        projectID: input.projectID,
        directory: input.directory,
        workspaceID: input.workspaceID,
        parentID: input.parentID,
        contextFrom: input.contextFrom,
        contextWatermark: input.contextWatermark,
        title: input.title ?? createDefaultTitle(!!input.parentID),
        permission: input.permission,
        temporary: input.temporary ?? false,
        extension: input.extension,
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      log.info("created", result)

      yield* Effect.sync(() => SyncEvent.run(Event.Created, { sessionID: result.id, info: result }))

      yield* actorReg
        .register({
          sessionID: result.id,
          actorID: "main",
          mode: "main",
          parentActorID: undefined,
          agent: "main",
          description: "main agent",
          contextMode: "full",
          contextWatermark: undefined,
          background: false,
          lifecycle: "persistent",
          tools: "INHERIT",
        })
        .pipe(Effect.ignore)
      yield* activity.create({
        sessionID: result.id,
        kind: "main",
        status: "queued",
        currentStep: "created",
        sourceType: "session",
        sourceID: result.id,
        metadata: { title: result.title },
      }).pipe(Effect.ignore)

      if (!Flag.LFCODE_EXPERIMENTAL_WORKSPACES) {
        // This only exist for backwards compatibility. We should not be
        // manually publishing this event; it is a sync event now
        yield* bus.publish(Event.Updated, {
          sessionID: result.id,
          info: result,
        })
      }

      return result
    })

    const emitProjectUpdated = Effect.fn("Session.emitProjectUpdated")(function* (projectID: ProjectID) {
      const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get())
      if (!row) return
      const project = Project.fromRow(row)
      yield* Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          project: project.id,
          payload: { type: Project.Event.Updated.type, properties: project },
        }),
      )
    })

    const refreshProjectLastUserActivity = Effect.fn("Session.refreshProjectLastUserActivity")(function* (
      projectID: ProjectID,
    ) {
      const latest = yield* db((d) =>
        d
          .select({ latest: sql<number>`max(${SessionTable.time_last_user})` })
          .from(SessionTable)
          .where(eq(SessionTable.project_id, projectID))
          .get(),
      )
      yield* db((d) =>
        d
          .update(ProjectTable)
          .set({ time_last_user: latest?.latest ?? null })
          .where(eq(ProjectTable.id, projectID))
          .run(),
      )
      yield* emitProjectUpdated(projectID)
    })

    const replaceLastUserActivity = Effect.fn("Session.replaceLastUserActivity")(function* (input: {
      sessionID: SessionID
      at: number | null
    }) {
      const session = yield* get(input.sessionID)
      const next = input.at ?? undefined
      if (session.time.lastUser === next) return
      yield* patch(input.sessionID, { time: { lastUser: input.at } })
      yield* refreshProjectLastUserActivity(session.projectID)
    })

    const get = Effect.fn("Session.get")(function* (id: SessionID) {
      const row = yield* db((d) => d.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
      if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
      return fromRow(row)
    })

    const children = Effect.fn("Session.children")(function* (parentID: SessionID) {
      const rows = yield* db((d) =>
        d
          .select()
          .from(SessionTable)
          .where(and(eq(SessionTable.parent_id, parentID)))
          .all(),
      )
      return rows.map(fromRow)
    })

    const remove: Interface["remove"] = Effect.fnUntraced(function* (sessionID: SessionID) {
      try {
        const session = yield* get(sessionID)
        const kids = yield* children(sessionID)
        for (const child of kids) {
          yield* remove(child.id)
        }

        // `remove` needs to work in all cases, such as a broken
        // sessions that run cleanup. In certain cases these will
        // run without any instance state, so we need to turn off
        // publishing of events in that case
        const hasInstance = yield* InstanceState.directory.pipe(
          Effect.as(true),
          Effect.catchCause(() => Effect.succeed(false)),
        )

        yield* Effect.promise(() =>
          dispatchHooks({
            event: "SessionEnd",
            sessionID,
            projectID: String(session.projectID),
            cwd: session.directory,
            payload: { reason: "removed" },
          }),
        ).pipe(Effect.ignore)

        yield* Effect.sync(() => {
          cleanupSessionHooks(sessionID)
          SyncEvent.run(Event.Deleted, { sessionID, info: session }, { publish: hasInstance })
          SyncEvent.remove(sessionID)
        })
        yield* refreshProjectLastUserActivity(session.projectID)
      } catch (e) {
        log.error(e)
      }
    })

    const cleanupTemporary: Interface["cleanupTemporary"] = Effect.fn("Session.cleanupTemporary")(function* () {
      const rows = yield* db((d) =>
        d
          .select({ id: SessionTable.id, parent_id: SessionTable.parent_id })
          .from(SessionTable)
          .where(eq(SessionTable.temporary, 1))
          .all(),
      )
      if (rows.length === 0) return 0

      const temporaryIDs = new Set(rows.map((row) => row.id))
      const roots = rows.filter((row) => !row.parent_id || !temporaryIDs.has(row.parent_id))
      for (const root of roots) {
        yield* remove(root.id)
      }

      const remaining = yield* db((d) =>
        d.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.temporary, 1)).all(),
      )
      return rows.length - remaining.length
    })

    const updateMessage = <T extends MessageV2.Info>(msg: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        ContextPlan.forSession(msg.sessionID).upsertMessage(msg)
        const visible = MessageV2.isUserVisible(msg)
        yield* Effect.sync(() =>
          SyncEvent.run(MessageV2.Event.Updated, { sessionID: msg.sessionID, info: msg }, { publish: visible, persist: visible }),
        )
        return msg
      }).pipe(Effect.withSpan("Session.updateMessage"))

    const updatePart = <T extends MessageV2.Part>(part: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        ContextPlan.forSession(part.sessionID).upsertPart(part)
        const visible = MessageV2.isUserVisibleMessage({ sessionID: part.sessionID, messageID: part.messageID })
        yield* Effect.sync(() =>
          SyncEvent.run(MessageV2.Event.PartUpdated, {
            sessionID: part.sessionID,
            part: structuredClone(part),
            time: Date.now(),
          }, { publish: visible, persist: visible }),
        )
        return part
      }).pipe(Effect.withSpan("Session.updatePart"))

    const getPart: Interface["getPart"] = Effect.fn("Session.getPart")(function* (input) {
      const row = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(
            and(
              eq(PartTable.session_id, input.sessionID),
              eq(PartTable.message_id, input.messageID),
              eq(PartTable.id, input.partID),
            ),
          )
          .get(),
      )
      if (!row) return
      return hydrateStoredPart({
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
      } as MessageV2.Part)
    })

    const create = Effect.fn("Session.create")(function* (input?: {
      parentID?: SessionID
      contextFrom?: SessionID
      contextWatermark?: MessageID
      title?: string
      permission?: Permission.Ruleset
      workspaceID?: WorkspaceID
      temporary?: boolean
    }) {
      const ctx = yield* InstanceState.context
      if (ctx.project.extension?.pluginID === "lfcode-tavern" && ctx.project.extension.type === "tavern") {
        throw new Error("Tavern projects require Session.createManaged with the lfcode-tavern/tavern extension")
      }
      const directory = yield* InstanceState.directory
      const workspace = yield* InstanceState.workspaceID
      const parent = input?.parentID ? yield* get(input.parentID) : undefined
      return yield* createNext({
        projectID: ctx.project.id,
        parentID: input?.parentID,
        contextFrom: input?.contextFrom,
        contextWatermark: input?.contextWatermark,
        directory,
        title: input?.title,
        permission: input?.permission,
        workspaceID: workspace,
        temporary: parent?.temporary === true ? true : input?.temporary,
      })
    })

    const createManaged = Effect.fn("Session.createManaged")(function* (input: CreateManagedInput) {
      const project = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, input.projectID)).get())
      if (!project) throw new NotFoundError({ message: `Project not found: ${input.projectID}` })
      if (
        project.extension?.pluginID !== input.extension.pluginID ||
        project.extension.type !== input.extension.type
      ) {
        throw new Error(`Project ${input.projectID} is not owned by ${input.extension.pluginID}/${input.extension.type}`)
      }
      return yield* createNext({
        projectID: project.id,
        directory: project.worktree,
        extension: input.extension,
        title: input.title,
        // Tavern conversations are narrative-only. This is enforced at the
        // durable Session boundary so direct HTTP callers cannot regain tools.
        permission:
          input.extension.pluginID === "lfcode-tavern" && input.extension.type === "tavern"
            ? [{ permission: "*", pattern: "*", action: "deny" }]
            : input.permission,
        temporary: input.temporary,
      })
    })

    const fork = Effect.fn("Session.fork")(function* (input: {
      sessionID: SessionID
      messageID?: MessageID
      includeMessage?: boolean
    }) {
      const original = yield* get(input.sessionID)
      const title = getForkedTitle(original.title)
      const session = yield* createNext({
        projectID: original.projectID,
        directory: original.directory,
        workspaceID: original.workspaceID,
        parentID: original.id,
        title,
        temporary: original.temporary,
        extension: original.extension,
        permission: original.permission,
      })
      const msgs = (yield* messages({ sessionID: input.sessionID, agentID: "*" })).filter((message) =>
        MessageV2.isUserVisible(message.info),
      )
      const idMap = new Map<string, MessageID>()

      for (const msg of msgs) {
        if (
          input.messageID &&
          (msg.info.id > input.messageID || (!input.includeMessage && msg.info.id === input.messageID))
        ) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = yield* updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          yield* updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    })

    const patch = (sessionID: SessionID, info: Patch) =>
      Effect.sync(() => SyncEvent.run(Event.Updated, { sessionID, info }))

    const touch = Effect.fn("Session.touch")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() } })
    })

    const setLastUserActivity = Effect.fn("Session.setLastUserActivity")(function* (input: {
      sessionID: SessionID
      at: number
    }) {
      const session = yield* get(input.sessionID)
      const next = session.time.lastUser && session.time.lastUser > input.at ? session.time.lastUser : input.at
      if (session.time.lastUser !== next) {
        yield* patch(input.sessionID, { time: { lastUser: next } })
      }
      yield* db((d) =>
        d
          .update(ProjectTable)
          .set({
            time_last_user: sql`max(coalesce(${ProjectTable.time_last_user}, 0), ${next})`,
          })
          .where(eq(ProjectTable.id, session.projectID))
          .run(),
      )
      yield* emitProjectUpdated(session.projectID)
    })

    const setTitle = Effect.fn("Session.setTitle")(function* (input: { sessionID: SessionID; title: string }) {
      yield* patch(input.sessionID, { title: input.title })
    })

    const setArchived = Effect.fn("Session.setArchived")(function* (input: {
      sessionID: SessionID
      time?: number | null
    }) {
      yield* patch(input.sessionID, { time: { archived: input.time ?? null } })
    })

    const setCompacting = Effect.fn("Session.setCompacting")(function* (input: {
      sessionID: SessionID
      time?: number | null
    }) {
      yield* patch(input.sessionID, { time: { compacting: input.time ?? null } })
    })

    const setPermission = Effect.fn("Session.setPermission")(function* (input: {
      sessionID: SessionID
      permission: Permission.Ruleset
    }) {
      yield* patch(input.sessionID, { permission: input.permission, time: { updated: Date.now() } })
    })

    const setGoal = Effect.fn("Session.setGoal")(function* (input: {
      sessionID: SessionID
      goal?: z.infer<typeof GoalState>
    }) {
      yield* patch(input.sessionID, { goal: input.goal ?? null, time: { updated: Date.now() } })
    })

    const setInteraction = Effect.fn("Session.setInteraction")(function* (input: {
      sessionID: SessionID
      interaction?: z.infer<typeof SessionInteraction.Info>
    }) {
      yield* patch(input.sessionID, { interaction: input.interaction ?? null })
    })

    const setRevert = Effect.fn("Session.setRevert")(function* (input: {
      sessionID: SessionID
      revert: Info["revert"]
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { summary: input.summary, time: { updated: Date.now() }, revert: input.revert })
    })

    const clearRevert = Effect.fn("Session.clearRevert")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() }, revert: null })
    })

    const setSummary = Effect.fn("Session.setSummary")(function* (input: {
      sessionID: SessionID
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { time: { updated: Date.now() }, summary: input.summary })
    })

    const diff = Effect.fn("Session.diff")(function* (sessionID: SessionID) {
      if (isStoredDiffTooLarge(sessionID)) {
        log.warn("skipping oversized stored session diff", {
          sessionID,
          bytes: storedDiffSize(sessionID),
          limit: MAX_SESSION_DIFF_STORAGE_BYTES,
        })
        return [] as Vcs.FileDiff[]
      }
      return yield* storage
        .read<Vcs.FileDiff[]>(["session_diff", sessionID])
        .pipe(Effect.orElseSucceed((): Vcs.FileDiff[] => []))
    })

    const messages = Effect.fn("Session.messages")(function* (input: {
      sessionID: SessionID
      limit?: number
      agentID?: string
    }) {
      if (input.limit) {
        return MessageV2.page({
          sessionID: input.sessionID,
          limit: input.limit,
          agentID: input.agentID,
        }).items
      }
      return Array.from(MessageV2.stream(input.sessionID, { agentID: input.agentID })).reverse()
    })

    const removeMessage = Effect.fn("Session.removeMessage")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      const session = yield* get(input.sessionID)
      const all = yield* messages({ sessionID: input.sessionID, agentID: "*" })
      const removed = all.find((message) => message.info.id === input.messageID)
      const visible = removed ? MessageV2.isUserVisible(removed.info) : false
      const shouldRefresh =
        !!removed && isRealUserMessage(removed) && removed.info.time.created === session.time.lastUser
      ContextPlan.forSession(input.sessionID).removeMessage(input.messageID)

      yield* Effect.sync(() =>
        SyncEvent.run(MessageV2.Event.Removed, {
          sessionID: input.sessionID,
          messageID: input.messageID,
        }, { publish: visible, persist: visible }),
      )
      if (shouldRefresh) {
        const next = all.filter((message) => message.info.id !== input.messageID).findLast(isRealUserMessage)
        yield* replaceLastUserActivity({ sessionID: input.sessionID, at: next?.info.time.created ?? null })
      }
      return input.messageID
    })

    const removePart = Effect.fn("Session.removePart")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
    }) {
      const visible = MessageV2.isUserVisibleMessage({ sessionID: input.sessionID, messageID: input.messageID })
      ContextPlan.forSession(input.sessionID).removePart(input.messageID, input.partID)
      yield* Effect.sync(() =>
        SyncEvent.run(MessageV2.Event.PartRemoved, {
          sessionID: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
        }, { publish: visible, persist: visible }),
      )
      return input.partID
    })

    const updatePartDelta = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }) {
      ContextPlan.forSession(input.sessionID).applyPartDelta(input.messageID, input.partID, input.field, input.delta)
      if (MessageV2.isUserVisibleMessage({ sessionID: input.sessionID, messageID: input.messageID })) {
        yield* bus.publish(MessageV2.Event.PartDelta, input)
      }
    })

    /** Finds the first message matching the predicate, searching newest-first.
     *
     * Slice contract: `options.agentID` defaults to `"main"` (mirrors `messages()`).
     * Pass `"*"` for cross-slice lookup. */
    const findMessage = Effect.fn("Session.findMessage")(function* (
      sessionID: SessionID,
      predicate: (msg: MessageV2.WithParts) => boolean,
      options?: { agentID?: string },
    ) {
      for (const item of MessageV2.stream(sessionID, { agentID: options?.agentID })) {
        if (predicate(item)) return Option.some(item)
      }
      return Option.none<MessageV2.WithParts>()
    })

    const lastMainMessageID = Effect.fn("Session.lastMainMessageID")(function* (sessionID: SessionID) {
      const row = yield* db((d) =>
        d
          .select({ id: MessageTable.id })
          .from(MessageTable)
          .where(and(eq(MessageTable.session_id, sessionID), eq(MessageTable.agent_id, "main")))
          .orderBy(desc(MessageTable.id))
          .limit(1)
          .get(),
      )
      return row?.id
    })

    return Service.of({
      create,
      createManaged,
      fork,
      touch,
      setLastUserActivity,
      get,
      setTitle,
      setArchived,
      setCompacting,
      setPermission,
      setGoal,
      setInteraction,
      setRevert,
      clearRevert,
      setSummary,
      diff,
      messages,
      children,
      remove,
      cleanupTemporary,
      updateMessage,
      removeMessage,
      removePart,
      updatePart,
      getPart,
      updatePartDelta,
      findMessage,
      lastMainMessageID,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(ActorRegistry.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(Storage.defaultLayer),
  Layer.provide(Activity.defaultLayer),
)

const sessionActivityTime = sql<number>`coalesce(${SessionTable.time_last_user}, ${SessionTable.time_created})`

export function* list(input?: {
  directory?: string
  workspaceID?: WorkspaceID
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}) {
  const project = Instance.project
  const directoryAliases = input?.directory ? sessionDirectoryAliases(input.directory) : []
  const conditions: SQL[] =
    !Flag.LFCODE_EXPERIMENTAL_WORKSPACES && directoryAliases.length > 0
      ? [inArray(SessionTable.directory, directoryAliases)]
      : [eq(SessionTable.project_id, project.id)]

  if (input?.workspaceID) {
    conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
  }
  if (input?.roots) {
    conditions.push(isNull(SessionTable.parent_id))
    conditions.push(isNull(SessionTable.context_from))
  }
  if (input?.start) {
    conditions.push(gte(sessionActivityTime, input.start))
  }
  if (input?.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }

  const limit = input?.limit ?? 100

  const rows = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(sessionActivityTime), desc(SessionTable.id))
      .limit(limit)
      .all(),
  )
  for (const row of rows) {
    yield fromRow(row)
  }
}

export function* listGlobal(input?: {
  directory?: string
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}) {
  const conditions: SQL[] = []

  if (input?.directory) {
    conditions.push(inArray(SessionTable.directory, sessionDirectoryAliases(input.directory)))
  }
  if (input?.roots) {
    conditions.push(isNull(SessionTable.parent_id))
    conditions.push(isNull(SessionTable.context_from))
  }
  if (input?.start) {
    conditions.push(gte(sessionActivityTime, input.start))
  }
  if (input?.cursor) {
    conditions.push(lt(sessionActivityTime, input.cursor))
  }
  if (input?.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }
  if (!input?.archived) {
    conditions.push(isNull(SessionTable.time_archived))
  }

  const limit = input?.limit ?? 100

  const rows = Database.use((db) => {
    const query =
      conditions.length > 0
        ? db
            .select()
            .from(SessionTable)
            .where(and(...conditions))
        : db.select().from(SessionTable)
    return query.orderBy(desc(sessionActivityTime), desc(SessionTable.id)).limit(limit).all()
  })

  const ids = [...new Set(rows.map((row) => row.project_id))]
  const projects = new Map<string, ProjectInfo>()

  if (ids.length > 0) {
    const items = Database.use((db) =>
      db
        .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(inArray(ProjectTable.id, ids))
        .all(),
    )
    for (const item of items) {
      projects.set(item.id, {
        id: item.id,
        name: item.name ?? undefined,
        worktree: item.worktree,
      })
    }
  }

  for (const row of rows) {
    const project = projects.get(row.project_id) ?? null
    yield { ...fromRow(row), project }
  }
}

export function clearOrphanAssistants(input?: {
  sessionID?: SessionID
  directory?: string
  limit?: number
  minAgeMs?: number
  message?: string
}) {
  const now = Date.now()
  const minAgeMs = input?.minAgeMs ?? ORPHAN_ASSISTANT_AGE_MS
  const sessions = input?.sessionID
    ? [getStandalone(input.sessionID)]
    : Array.from(list({ directory: input?.directory, limit: input?.limit }))

  for (const session of sessions) {
    const rows = Database.use((db) =>
      db.select().from(MessageTable).where(eq(MessageTable.session_id, session.id)).all(),
    )
    for (const row of rows) {
      const info = MessageV2.Info.parse({
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        agentID: row.agent_id,
      })
      if (info.role !== "assistant") continue
      if (info.time.completed) continue
      const created = info.time.created ?? 0
      if (now - created < minAgeMs) continue

      Database.use((db) =>
        db
          .update(SessionTable)
          .set({
            recoverable: 1,
            recoverable_reason: input?.message ?? "The previous response was interrupted and can be resumed.",
          })
          .where(eq(SessionTable.id, info.sessionID))
          .run(),
      )
      log.info("orphan-assistant-preserved", { sessionID: info.sessionID, messageID: info.id })
    }
  }
}

function getStandalone(id: SessionID) {
  const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
  if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
  return fromRow(row)
}
