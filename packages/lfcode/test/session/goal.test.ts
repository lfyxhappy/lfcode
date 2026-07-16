/**
 * Unit tests for the per-session goal stop-condition service (session/goal.ts).
 *
 * Covers the state machine (set / get / clear / bumpReact) — the deterministic
 * logic that drives the main runLoop's goal gate. The judge model call
 * (Goal.evaluate) is exercised by the integration path in prompt.ts and the live
 * headless harness; it converts the conversation to native model messages (tool
 * calls/results/images preserved) rather than flattening to text.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Goal } from "../../src/session/goal"
import { type Interface, Service, defaultLayer } from "../../src/session/session"
import { Log } from "../../src/util"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

function withMockedNow<T>(times: number[], fn: () => Promise<T>) {
  const original = Date.now
  let index = 0
  Date.now = () => times[Math.min(index++, times.length - 1)]!
  return fn().finally(() => {
    Date.now = original
  })
}

function runGoal<A>(
  dir: string,
  fn: (input: { goal: Goal.Interface; session: Interface }) => Effect.Effect<A, unknown>,
) {
  return Instance.provide({
    directory: dir,
    fn: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const goal = yield* Goal.Service
          const session = yield* Service
          return yield* fn({ goal, session })
        }).pipe(Effect.scoped, Effect.provide(Goal.defaultLayer), Effect.provide(defaultLayer)),
      ),
  })
}

describe("Goal state machine", () => {
  test("set then get returns an active persisted goal with react=0", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* goal.set(created.id, "tests pass")
        return yield* goal.get(created.id)
      }),
    )
    expect(got?.status).toBe("active")
    expect(got?.objective).toBe("tests pass")
    expect(got?.condition).toBe("tests pass")
    expect(got?.react).toBe(0)
  })

  test("get with no goal returns undefined", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        return yield* goal.get(created.id)
      }),
    )
    expect(got).toBeUndefined()
  })

  test("clear marks the goal cleared and disables active lookup", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* goal.set(created.id, "build green")
        yield* goal.clear(created.id)
        return {
          goal: yield* goal.get(created.id),
          active: yield* goal.getActive(created.id),
        }
      }),
    )
    expect(got.goal?.status).toBe("cleared")
    expect(got.goal?.condition).toBe("build green")
    expect(got.active).toBeUndefined()
  })

  test("bumpReact increments and is reflected in get", async () => {
    await using tmp = await tmpdir({})
    const result = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* goal.set(created.id, "x")
        const first = yield* goal.bumpReact(created.id)
        const second = yield* goal.bumpReact(created.id)
        const current = yield* goal.get(created.id)
        return { first, second, current: current?.react }
      }),
    )
    expect(result.first).toBe(1)
    expect(result.second).toBe(2)
    expect(result.current).toBe(2)
  })

  test("bumpReact with no active goal returns 0", async () => {
    await using tmp = await tmpdir({})
    const n = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        return yield* goal.bumpReact(created.id)
      }),
    )
    expect(n).toBe(0)
  })

  test("set resets react back to 0", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* goal.set(created.id, "a")
        yield* goal.bumpReact(created.id)
        yield* goal.set(created.id, "b")
        return yield* goal.get(created.id)
      }),
    )
    expect(got?.condition).toBe("b")
    expect(got?.react).toBe(0)
  })

  test("set on an existing goal updates objective without resetting accumulated stats", async () => {
    await using tmp = await tmpdir({})
    const got = await withMockedNow([1000, 1500, 2000, 2500], () =>
      runGoal(tmp.path, ({ goal, session }) =>
        Effect.gen(function* () {
          const created = yield* session.create()
          yield* goal.create(created.id, "first goal")
          yield* goal.addStats({
            sessionID: created.id,
            usage: {
              input: 10,
              output: 4,
              cache: { read: 2, write: 1 },
            },
          })
          yield* goal.set(created.id, "updated goal")
          return yield* goal.get(created.id)
        }),
      ),
    )
    expect(got?.objective).toBe("updated goal")
    expect(got?.condition).toBe("updated goal")
    expect(got?.stats.tokens.input).toBe(10)
    expect(got?.stats.tokens.output).toBe(4)
    expect(got?.stats.tokens.cache.read).toBe(2)
    expect(got?.stats.tokens.cache.write).toBe(1)
  })

  test("active goal persists after instance dispose and reopen", async () => {
    await using tmp = await tmpdir({})
    const sessionID = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* goal.set(created.id, "persist me")
        return created.id
      }),
    )

    await Instance.disposeAll()

    const restored = await runGoal(tmp.path, ({ goal }) => goal.get(sessionID))
    expect(restored?.status).toBe("active")
    expect(restored?.condition).toBe("persist me")
  })

  test("requestBlocked needs three matching reasons and resets on a new reason", async () => {
    await using tmp = await tmpdir({})
    const result = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* goal.set(created.id, "finish task")
        const first = yield* goal.requestBlocked({ sessionID: created.id, reason: "network down" })
        const second = yield* goal.requestBlocked({ sessionID: created.id, reason: "network down" })
        const reset = yield* goal.requestBlocked({ sessionID: created.id, reason: "permission denied" })
        const third = yield* goal.requestBlocked({ sessionID: created.id, reason: "permission denied" })
        const fourth = yield* goal.requestBlocked({ sessionID: created.id, reason: "permission denied" })
        return {
          first,
          second,
          reset,
          third,
          fourth,
          goal: yield* goal.get(created.id),
          active: yield* goal.getActive(created.id),
        }
      }),
    )

    expect(result.first.blocked).toBe(false)
    expect(result.first.remaining).toBe(2)
    expect(result.second.blocked).toBe(false)
    expect(result.second.remaining).toBe(1)
    expect(result.reset.blocked).toBe(false)
    expect(result.reset.remaining).toBe(2)
    expect(result.third.blocked).toBe(false)
    expect(result.third.remaining).toBe(1)
    expect(result.fourth.blocked).toBe(true)
    expect(result.fourth.remaining).toBe(0)
    expect(result.goal?.status).toBe("blocked")
    expect(result.goal?.blockedCount).toBe(3)
    expect(result.goal?.blockedReason).toBe("permission denied")
    expect(result.active).toBeUndefined()
  })

  test("pause and resume keep stats while getActive only returns active goals", async () => {
    await using tmp = await tmpdir({})
    const result = await withMockedNow([1000, 1500, 2000, 2500, 3000, 3500, 4000], () =>
      runGoal(tmp.path, ({ goal, session }) =>
        Effect.gen(function* () {
          const created = yield* session.create()
          yield* goal.create(created.id, "ship banner")
          yield* goal.addStats({
            sessionID: created.id,
            usage: {
              input: 10,
              output: 5,
              cache: { read: 3, write: 1 },
            },
          })
          const paused = yield* goal.pause(created.id)
          const pausedActive = yield* goal.getActive(created.id)
          yield* goal.addStats({
            sessionID: created.id,
            usage: {
              input: 99,
              output: 99,
              cache: { read: 99, write: 99 },
            },
          })
          const resumed = yield* goal.resume(created.id)
          yield* goal.addStats({
            sessionID: created.id,
            usage: {
              input: 2,
              output: 1,
              reasoning: 4,
              cache: { read: 0, write: 2 },
            },
          })
          return {
            paused,
            pausedActive,
            resumed,
            current: yield* goal.get(created.id),
            active: yield* goal.getActive(created.id),
          }
        }),
      ),
    )

    expect(result.paused?.status).toBe("paused")
    expect(result.paused?.stats.elapsed).toBeGreaterThanOrEqual(0)
    expect(result.pausedActive).toBeUndefined()
    expect(result.resumed?.status).toBe("active")
    expect(result.current?.stats.tokens.input).toBe(12)
    expect(result.current?.stats.tokens.output).toBe(6)
    expect(result.current?.stats.tokens.reasoning).toBe(4)
    expect(result.current?.stats.tokens.cache.read).toBe(3)
    expect(result.current?.stats.tokens.cache.write).toBe(3)
    expect(result.current?.stats.elapsed).toBeGreaterThanOrEqual(result.paused?.stats.elapsed ?? 0)
    expect(result.active?.status).toBe("active")
  })

  test("delete removes the goal entirely", async () => {
    await using tmp = await tmpdir({})
    const result = await runGoal(tmp.path, ({ goal, session }) =>
      Effect.gen(function* () {
        const created = yield* session.create()
        yield* goal.create(created.id, "remove me")
        yield* goal.delete(created.id)
        return {
          current: yield* goal.get(created.id),
          active: yield* goal.getActive(created.id),
        }
      }),
    )

    expect(result.current).toBeUndefined()
    expect(result.active).toBeUndefined()
  })
})
