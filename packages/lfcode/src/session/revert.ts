import path from "node:path"
import { applyPatch, parsePatch, reversePatch } from "diff"
import z from "zod"
import { Effect, Layer, Context, Stream } from "effect"
import { Bus } from "../bus"
import { Git } from "@/git"
import { Storage } from "@/storage"
import { Log } from "../util"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionRunState } from "./run-state"
import { SessionSummary } from "./summary"
import { collectMessagePatchTexts } from "./file-diff"
import {
  MAX_SESSION_DIFF_EVENT_BYTES,
  MAX_SESSION_DIFF_EVENT_FILES,
  compactDiffsForStorage,
  estimateDiffBytes,
  shouldPublishDiffEvent,
} from "./diff-storage"

const log = Log.create({ service: "session.revert" })

export const RevertInput = z.object({
  sessionID: SessionID.zod,
  messageID: MessageID.zod,
  partID: PartID.zod.optional(),
})
export type RevertInput = z.infer<typeof RevertInput>

export interface Interface {
  readonly revert: (input: RevertInput) => Effect.Effect<Session.Info>
  readonly unrevert: (input: { sessionID: SessionID }) => Effect.Effect<Session.Info>
  readonly cleanup: (session: Session.Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/SessionRevert") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const git = yield* Git.Service
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service
    const summary = yield* SessionSummary.Service
    const state = yield* SessionRunState.Service

    const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
      yield* state.assertNotBusy(input.sessionID)
      const all = yield* sessions.messages({ sessionID: input.sessionID, agentID: "*" })
      let lastUser: MessageV2.User | undefined
      const session = yield* sessions.get(input.sessionID)

      let rev: Session.Info["revert"]
      for (const msg of all) {
        if (msg.info.role === "user") lastUser = msg.info
        const remaining = []
        for (const part of msg.parts) {
          if (rev) continue

          if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
            const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
            rev = {
              messageID: !partID && lastUser ? lastUser.id : msg.info.id,
              partID,
            }
          }
          remaining.push(part)
        }
      }

      if (!rev) return session

      if (session.revert?.messageID !== rev.messageID || session.revert?.partID !== rev.partID) {
        const delta = selectPatchDelta(all, session.revert, rev)
        const direction = patchDirection(session.revert, rev)
        yield* applyPatchTexts(git, session.directory, delta, direction, input)
      }

      const range = messagesFrom(all, rev.messageID)
      const patches = collectMessagePatchTexts(range).toReversed()
      rev.diff = patches.join("\n")
      const diffs = yield* summary.computeDiff({ messages: range })
      const storedDiffs = compactDiffsForStorage(diffs)
      yield* storage.write(["session_diff", input.sessionID], storedDiffs).pipe(Effect.ignore)
      if (shouldPublishDiffEvent(storedDiffs)) {
        yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: storedDiffs })
      } else {
        log.warn("skipping oversized revert diff event", {
          sessionID: input.sessionID,
          files: storedDiffs.length,
          bytes: estimateDiffBytes(storedDiffs),
          fileLimit: MAX_SESSION_DIFF_EVENT_FILES,
          byteLimit: MAX_SESSION_DIFF_EVENT_BYTES,
        })
      }
      yield* sessions.setRevert({
        sessionID: input.sessionID,
        revert: rev,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      return yield* sessions.get(input.sessionID)
    })

    const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
      log.info("unreverting", input)
      yield* state.assertNotBusy(input.sessionID)
      const session = yield* sessions.get(input.sessionID)
      if (!session.revert) return session
      const all = yield* sessions.messages({ sessionID: input.sessionID, agentID: "*" })
      const patches = collectMessagePatchTexts(messagesFrom(all, session.revert.messageID))
      yield* applyPatchTexts(git, session.directory, patches, "forward", {
        sessionID: input.sessionID,
        messageID: session.revert.messageID,
      })
      yield* sessions.clearRevert(input.sessionID)
      return yield* sessions.get(input.sessionID)
    })

    const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
      if (!session.revert) return
      const sessionID = session.id
      const msgs = yield* sessions.messages({ sessionID, agentID: "*" })
      const messageID = session.revert.messageID
      const remove = [] as MessageV2.WithParts[]
      let target: MessageV2.WithParts | undefined
      for (const msg of msgs) {
        if (msg.info.id < messageID) continue
        if (msg.info.id > messageID) {
          remove.push(msg)
          continue
        }
        if (session.revert.partID) {
          target = msg
          continue
        }
        remove.push(msg)
      }
      for (const msg of remove) {
        yield* sessions.removeMessage({
          sessionID,
          messageID: msg.info.id,
        })
      }
      if (session.revert.partID && target) {
        const partID = session.revert.partID
        const idx = target.parts.findIndex((part) => part.id === partID)
        if (idx >= 0) {
          const removeParts = target.parts.slice(idx)
          target.parts = target.parts.slice(0, idx)
          for (const part of removeParts) {
            yield* sessions.removePart({
              sessionID,
              messageID: target.info.id,
              partID: part.id,
            })
          }
        }
      }
      yield* sessions.clearRevert(sessionID)
    })

    return Service.of({ revert, unrevert, cleanup })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Git.defaultLayer),
  ),
)

export * as SessionRevert from "./revert"

function messagesFrom(messages: MessageV2.WithParts[], messageID: MessageID) {
  return messages.filter((msg) => msg.info.id >= messageID)
}

function messagesBetween(messages: MessageV2.WithParts[], startID: MessageID, endID: MessageID) {
  return messages.filter((msg) => msg.info.id >= startID && msg.info.id < endID)
}

function patchDirection(current: Session.Info["revert"], next: NonNullable<Session.Info["revert"]>) {
  if (!current) return "reverse" as const
  return current.messageID < next.messageID ? ("forward" as const) : ("reverse" as const)
}

function selectPatchDelta(
  messages: MessageV2.WithParts[],
  current: Session.Info["revert"],
  next: NonNullable<Session.Info["revert"]>,
) {
  if (!current) {
    return collectMessagePatchTexts(messagesFrom(messages, next.messageID)).toReversed()
  }
  if (current.messageID < next.messageID) {
    return collectMessagePatchTexts(messagesBetween(messages, current.messageID, next.messageID))
  }
  return collectMessagePatchTexts(messagesBetween(messages, next.messageID, current.messageID)).toReversed()
}

const applyPatchTexts = Effect.fn("SessionRevert.applyPatchTexts")(function* (
  git: Git.Interface,
  directory: string,
  patches: string[],
  direction: "forward" | "reverse",
  input: RevertInput,
) {
  for (const patch of patches) {
    const result = yield* git.run(
      [
        "apply",
        ...(direction === "reverse" ? ["--reverse"] : []),
        "--unsafe-paths",
        "--whitespace=nowarn",
        "-",
      ],
      {
        cwd: directory,
        stdin: Stream.make(new TextEncoder().encode(patch)),
      },
    )
    if (result.exitCode === 0) continue
    log.warn(`git apply ${direction} failed, falling back to diff apply`, {
      sessionID: input.sessionID,
      messageID: input.messageID,
      stderr: result.stderr.toString(),
    })
    yield* applyPatchFallback(directory, patch, direction).pipe(Effect.orDie)
  }
})

const applyPatchFallback = Effect.fn("SessionRevert.applyPatchFallback")(function* (
  directory: string,
  patchText: string,
  direction: "forward" | "reverse",
) {
  const patches = parsePatch(patchText)
  if (!patches.length) {
    return yield* Effect.fail(new Error("failed to parse revert patch"))
  }

  for (const parsed of patches) {
    const normalized = direction === "reverse" ? reversePatch(parsed) : parsed
    const target = resolvePatchTarget(directory, parsed.oldFileName, parsed.newFileName)
    if (!target) {
      return yield* Effect.fail(new Error("failed to resolve revert patch target"))
    }

    const current = yield* readPatchTarget(target)
    const next = applyPatch(current, normalized)
    if (next === false) {
      return yield* Effect.fail(new Error(`failed to apply ${direction} patch for ${target}`))
    }

    if (shouldDeletePatchedFile(parsed, direction, next)) {
      yield* Effect.promise(() => Bun.file(target).delete()).pipe(Effect.catch(() => Effect.void))
      continue
    }

    yield* Effect.promise(() => Bun.write(target, next))
  }
})

function resolvePatchTarget(directory: string, oldFileName?: string, newFileName?: string) {
  const selected = [newFileName, oldFileName].find((item) => item && !isDevNull(item))
  if (!selected) return
  if (path.isAbsolute(selected)) return selected
  return path.join(directory, normalizePatchPath(selected))
}

function normalizePatchPath(fileName: string) {
  const trimmed = fileName.replace(/^[ab]\//, "").replace(/^\.\//, "")
  return trimmed.replaceAll("/", path.sep)
}

function isDevNull(fileName?: string) {
  return fileName === "/dev/null" || fileName === "nul"
}

function shouldDeletePatchedFile(parsed: ReturnType<typeof parsePatch>[number], direction: "forward" | "reverse", next: string) {
  if (next.length !== 0) return false
  if (direction === "forward") return isDevNull(parsed.newFileName)
  return isDevNull(parsed.oldFileName)
}

function readPatchTarget(target: string) {
  return Effect.promise(() => Bun.file(target).text()).pipe(
    Effect.catch(() => Effect.succeed("")),
  )
}
