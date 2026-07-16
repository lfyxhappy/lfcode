import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect"
import type { SessionID } from "@/session/schema"

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<{ count: number; missingKey?: string }>
  readonly bump: (sessionID: SessionID, missing?: readonly string[]) => Effect.Effect<number>
  readonly clear: (sessionID: SessionID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/ComposeGateState") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(
      Effect.fn("ComposeGateState.state")(function* () {
        return { entries: new Map<string, { count: number; missingKey?: string }>() }
      }),
    )

    const get = Effect.fn("ComposeGateState.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.entries.get(sessionID) ?? { count: 0, missingKey: undefined }
    })

    const bump = Effect.fn("ComposeGateState.bump")(function* (sessionID: SessionID, missing?: readonly string[]) {
      const data = yield* InstanceState.get(state)
      const key = missing?.join("||")
      const prev = data.entries.get(sessionID)
      const next = prev && prev.missingKey === key ? prev.count + 1 : 1
      data.entries.set(sessionID, { count: next, missingKey: key })
      return next
    })

    const clear = Effect.fn("ComposeGateState.clear")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      data.entries.delete(sessionID)
    })

    return Service.of({ get, bump, clear })
  }),
)

export const defaultLayer = layer

export * as ComposeGateState from "./compose-gate-state"
