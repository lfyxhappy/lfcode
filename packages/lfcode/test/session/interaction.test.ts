import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import type { MessageV2 } from "../../src/session/message-v2"
import * as SessionInteraction from "../../src/session/interaction"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Log } from "../../src/util"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

function runInteraction<A>(
  dir: string,
  fn: (input: {
    session: Session.Interface
    run: SessionRunState.Interface
    status: SessionStatus.Interface
  }) => Effect.Effect<A>,
) {
  const sessionLayer = Session.defaultLayer
  const statusLayer = SessionStatus.defaultLayer
  const runLayer = SessionRunState.layer.pipe(Layer.provide(statusLayer), Layer.provide(sessionLayer))
  const fullLayer = Layer.mergeAll(sessionLayer, statusLayer, runLayer)

  return Instance.provide({
    directory: dir,
    fn: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const session = yield* Session.Service
          const run = yield* SessionRunState.Service
          const status = yield* SessionStatus.Service
          return yield* fn({ session, run, status })
        }).pipe(Effect.scoped, Effect.provide(fullLayer)),
      ),
  })
}

describe("interactive html waiting state", () => {
  test("detects only closed lfcode-html blocks", () => {
    expect(
      SessionInteraction.containsInteractiveHtmlBlock(
        'before\n```lfcode-html height=420 title="棋盘"\n<html><body>ok</body></html>\n```\nafter',
      ),
    ).toBe(true)
    expect(
      SessionInteraction.containsInteractiveHtmlBlock('```lfcode-html\n<html><body>missing fence</body></html>'),
    ).toBe(false)
  })

  test("detects escaped lfcode html alias blocks", () => {
    expect(
      SessionInteraction.containsInteractiveHtmlBlock(
        'before\n```<<lfcode>>-<<html>>\n<html><body>ok</body></html>\n```\nafter',
      ),
    ).toBe(true)
  })

  test("main runner settles back to waiting when interactive mode is active", async () => {
    await using tmp = await tmpdir({})
    const status = await runInteraction(tmp.path, ({ session, run, status }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* session.setInteraction({
          sessionID: created.id,
          interaction: { mode: "interactive-html" },
        })
        yield* run.ensureRunning(
          created.id,
          "main",
          Effect.succeed({} as MessageV2.WithParts),
          Effect.succeed({} as MessageV2.WithParts),
        )
        return yield* status.get(created.id)
      }),
    )

    expect(status).toMatchObject({
      type: "waiting",
      mode: "interactive-html",
    })
  })

  test("abort while waiting clears interactive mode and returns idle", async () => {
    await using tmp = await tmpdir({})
    const result = await runInteraction(tmp.path, ({ session, run, status }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* session.setInteraction({
          sessionID: created.id,
          interaction: { mode: "interactive-html" },
        })
        yield* status.set(created.id, {
          type: "waiting",
          mode: "interactive-html",
        })
        yield* run.cancel(created.id)
        return {
          session: yield* session.get(created.id),
          status: yield* status.get(created.id),
        }
      }),
    )

    expect(result.session.interaction).toBeUndefined()
    expect(result.status).toEqual({ type: "idle" })
  })
})
