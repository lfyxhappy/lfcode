import z from "zod"
import { Effect, Layer, Context } from "effect"
import { Bus } from "@/bus"
import { Storage } from "@/storage"
import { Log } from "@/util"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID } from "./schema"
import { collectMessageFileDiffs, compactFileDiffsForSummary } from "./file-diff"
import type { Vcs } from "../project"
import {
  MAX_SESSION_DIFF_EVENT_BYTES,
  MAX_SESSION_DIFF_EVENT_FILES,
  MAX_SESSION_DIFF_STORAGE_BYTES,
  compactDiffsForStorage,
  estimateDiffBytes,
  isStoredDiffTooLarge,
  shouldPublishDiffEvent,
  storedDiffSize,
} from "./diff-storage"

const log = Log.create({ service: "session-summary" })

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: {
    sessionID: SessionID
    messageID?: MessageID
    turns?: number
  }) => Effect.Effect<Vcs.FileDiff[]>
  readonly computeDiff: (input: { messages: MessageV2.WithParts[] }) => Effect.Effect<Vcs.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/SessionSummary") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: MessageV2.WithParts[] }) {
      return collectMessageFileDiffs(input.messages)
    })

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      const all = yield* sessions.messages({ sessionID: input.sessionID, agentID: "main" })
      if (!all.length) return

      const diffs = yield* computeDiff({ messages: all })
      const storedDiffs = compactDiffsForStorage(diffs)
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      yield* storage.write(["session_diff", input.sessionID], storedDiffs).pipe(Effect.ignore)
      if (shouldPublishDiffEvent(storedDiffs)) {
        yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: storedDiffs })
      } else {
        log.warn("skipping oversized session diff event", {
          sessionID: input.sessionID,
          files: storedDiffs.length,
          bytes: estimateDiffBytes(storedDiffs),
          fileLimit: MAX_SESSION_DIFF_EVENT_FILES,
          byteLimit: MAX_SESSION_DIFF_EVENT_BYTES,
        })
      }

      const messages = all.filter(
        (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
      )
      const target = messages.find((m) => m.info.id === input.messageID)
      if (!target || target.info.role !== "user") return
      const msgDiffs = yield* computeDiff({ messages })
      target.info.summary = { ...target.info.summary, diffs: compactFileDiffsForSummary(msgDiffs) }
      yield* sessions.updateMessage(target.info)
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: {
      sessionID: SessionID
      messageID?: MessageID
      turns?: number
    }) {
      if (input.messageID || input.turns) {
        return yield* computeDiff({
          messages: MessageV2.turnWindow({
            sessionID: input.sessionID,
            messageID: input.messageID,
            turns: input.turns,
            agentID: "main",
          }),
        })
      }

      if (isStoredDiffTooLarge(input.sessionID)) {
        log.warn("skipping oversized stored session diff", {
          sessionID: input.sessionID,
          bytes: storedDiffSize(input.sessionID),
          limit: MAX_SESSION_DIFF_STORAGE_BYTES,
        })
        return [] as Vcs.FileDiff[]
      }
      return yield* storage
        .read<Vcs.FileDiff[]>(["session_diff", input.sessionID])
        .pipe(Effect.catch(() => Effect.succeed([] as Vcs.FileDiff[])))
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

export const DiffInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod.optional(),
  turns: z.coerce.number().int().positive().optional(),
})

export * as SessionSummary from "./summary"
