import path from "path"
import { Context, Effect, Function, Layer, Schema } from "effect"
import type { Scope } from "effect"
import { Global } from "@/global"
import { Flock } from "@lfcode-ai/shared/util/flock"

export namespace EffectFlock {
  export class LockTimeoutError extends Schema.TaggedErrorClass<LockTimeoutError>()("LockTimeoutError", {
    key: Schema.String,
  }) {}

  export class LockCompromisedError extends Schema.TaggedErrorClass<LockCompromisedError>()("LockCompromisedError", {
    detail: Schema.String,
  }) {}

  export type LockError = LockTimeoutError | LockCompromisedError

  export interface Interface {
    readonly acquire: (key: string, dir?: string) => Effect.Effect<void, LockError, Scope.Scope>
    readonly withLock: {
      (key: string, dir?: string): <A, E, R>(body: Effect.Effect<A, E, R>) => Effect.Effect<A, E | LockError, R>
      <A, E, R>(body: Effect.Effect<A, E, R>, key: string, dir?: string): Effect.Effect<A, E | LockError, R>
    }
  }

  export class Service extends Context.Service<Service, Interface>()("EffectFlock") {}

  const message = (cause: unknown) => {
    if (cause instanceof Error) return cause.message
    return typeof cause === "string" ? cause : String(cause)
  }

  const lockDir = (dir?: string) => dir ?? path.join(Global.Path.state, "locks")

  const acquireLease = (key: string, dir?: string) =>
    Effect.tryPromise({
      try: () => Flock.acquire(key, { dir: lockDir(dir) }),
      catch: (cause) => {
        const detail = message(cause)
        if (detail.startsWith("Timed out waiting for lock:")) return new LockTimeoutError({ key })
        return new LockCompromisedError({ detail })
      },
    })

  const releaseLease = (lease: Awaited<ReturnType<typeof Flock.acquire>>) =>
    Effect.tryPromise({
      try: () => lease.release(),
      catch: (cause) => new LockCompromisedError({ detail: message(cause) }),
    }).pipe(Effect.orDie)

  const acquire = Effect.fn("EffectFlock.acquire")(function* (key: string, dir?: string) {
    yield* Effect.acquireRelease(acquireLease(key, dir), releaseLease)
  }, Effect.scoped)

  const withLock: Interface["withLock"] = Function.dual(
    (args) => Effect.isEffect(args[0]),
    <A, E, R>(body: Effect.Effect<A, E, R>, key: string, dir?: string): Effect.Effect<A, E | LockError, R> =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* acquire(key, dir)
          return yield* body
        }),
      ),
  )

  export const layer = Layer.succeed(Service, Service.of({ acquire, withLock }))
  export const defaultLayer = layer
}
