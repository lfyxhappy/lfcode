export * as PluginV2 from "./plugin"

import { createDraft, finishDraft, type Draft } from "immer"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Cause, Context, Effect, Exit, Layer, Schema, Scope } from "effect"
import type { ModelV2 } from "./model"
import type { Catalog } from "./catalog"
import { EventV2 } from "./event"
import { KeyedMutex } from "./effect/keyed-mutex"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

export const Lifecycle = Schema.Literal("discovered", "installed", "resolved", "active", "degraded", "disabled", "removed")
export type Lifecycle = typeof Lifecycle.Type

export type Identity = {
  id: ID
  name?: string
  source: "bundled" | "official" | "dev-local" | "external" | "legacy"
  trust: "bundled" | "official" | "dev-local" | "external"
  apiVersion?: string
  capabilities: string[]
  order: number
}

export type Status = {
  identity: Identity
  lifecycle: Lifecycle
  error?: string
}

export const Event = {
  Added: EventV2.define({
    type: "plugin.added",
    schema: {
      id: ID,
    },
  }),
  StatusChanged: EventV2.define({
    type: "plugin.status.changed",
    schema: {
      id: ID,
      lifecycle: Lifecycle,
      error: Schema.optional(Schema.String),
    },
  }),
}

type HookSpec = {
  "catalog.transform": {
    input: Catalog.Editor
    output: {}
  }
  "aisdk.language": {
    input: {
      model: ModelV2.Info
      sdk: any
      options: Record<string, any>
    }
    output: {
      language?: LanguageModelV3
    }
  }
  "aisdk.sdk": {
    input: {
      model: ModelV2.Info
      package: string
      options: Record<string, any>
    }
    output: {
      sdk?: any
    }
  }
}

export type Hooks = {
  [Name in keyof HookSpec]: Readonly<HookSpec[Name]["input"]> & {
    -readonly [Field in keyof HookSpec[Name]["output"]]: HookSpec[Name]["output"][Field] extends object
      ? Draft<HookSpec[Name]["output"][Field]>
      : HookSpec[Name]["output"][Field]
  }
}

export type HookFunctions = {
  [key in keyof Hooks]?: (input: Hooks[key]) => Effect.Effect<void>
}

export type HookInput<Name extends keyof Hooks> = HookSpec[Name]["input"]
export type HookOutput<Name extends keyof Hooks> = HookSpec[Name]["output"]

export type Effect<R = never> = Effect.Effect<HookFunctions | void, never, R | Scope.Scope>

export type Registration = {
  id: ID
  identity?: Partial<Omit<Identity, "id" | "order" | "capabilities">> & {
    capabilities?: readonly string[]
    order?: number
  }
  effect: Effect.Effect<void | HookFunctions, never, Scope.Scope>
}

export function define<R>(input: { id: ID; effect: Effect.Effect<HookFunctions | void, never, R> }) {
  return input
}

export interface Interface {
  readonly register: (input: Registration) => Effect.Effect<void>
  readonly activate: (id: ID) => Effect.Effect<void>
  readonly deactivate: (id: ID) => Effect.Effect<void>
  readonly inspect: () => Effect.Effect<Status[]>
  readonly add: (input: {
    id: ID
    effect: Effect.Effect<void | HookFunctions, never, Scope.Scope>
  }) => Effect.Effect<void, never, never>
  readonly remove: (id: ID) => Effect.Effect<void>
  readonly triggerFor: <Name extends keyof Hooks>(
    id: ID,
    name: Name,
    input: HookInput<Name>,
    output: HookOutput<Name>,
  ) => Effect.Effect<HookInput<Name> & HookOutput<Name>>
  readonly trigger: <Name extends keyof Hooks>(
    name: Name,
    input: HookInput<Name>,
    output: HookOutput<Name>,
  ) => Effect.Effect<HookInput<Name> & HookOutput<Name>>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/v2/Plugin") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    type Entry = Registration & {
      identity: Identity
      lifecycle: Lifecycle
      error?: string
      hooks?: HookFunctions
      scope?: Scope.Closeable
    }

    let entries: Entry[] = []
    const events = yield* EventV2.Service
    const scope = yield* Scope.Scope
    const locks = KeyedMutex.makeUnsafe<ID>()

    const find = (id: ID) => entries.find((item) => item.id === id)
    const publishStatus = (entry: Entry) =>
      events.publish(Event.StatusChanged, {
        id: entry.id,
        lifecycle: entry.lifecycle,
        ...(entry.error ? { error: entry.error } : {}),
      })
    const deactivate = Effect.fn("Plugin.deactivate")(function* (id: ID) {
      yield* locks.withLock(id)(
        Effect.gen(function* () {
          const entry = find(id)
          if (!entry || entry.lifecycle === "disabled") return
          const scope = entry.scope
          entry.scope = undefined
          entry.hooks = undefined
          entry.lifecycle = "disabled"
          entry.error = undefined
          if (scope) yield* Scope.close(scope, Exit.void).pipe(Effect.ignore)
          yield* publishStatus(entry)
        }),
      )
    })
    const activate = Effect.fn("Plugin.activate")(function* (id: ID) {
      yield* locks.withLock(id)(
        Effect.gen(function* () {
          const entry = find(id)
          if (!entry) throw new Error(`Plugin ${id} is not registered`)
          if (entry.lifecycle === "active") return

          const childScope = yield* Scope.fork(scope)
          const result = yield* entry.effect.pipe(
            Scope.provide(childScope),
            Effect.withSpan("Plugin.activate", {
              attributes: {
                "plugin.id": entry.id,
              },
            }),
            Effect.onExit((exit) => {
              if (Exit.isSuccess(exit)) return Effect.void
              entry.scope = undefined
              entry.hooks = undefined
              entry.lifecycle = "degraded"
              entry.error = Cause.pretty(exit.cause).slice(0, 1_000)
              return Scope.close(childScope, exit).pipe(Effect.zipRight(publishStatus(entry)))
            }),
          )
          entry.scope = childScope
          entry.hooks = result ?? {}
          entry.lifecycle = "active"
          entry.error = undefined
          yield* publishStatus(entry)
          yield* events.publish(Event.Added, { id: entry.id })
        }),
      )
    })
    const register = Effect.fn("Plugin.register")(function* (input: Registration) {
      yield* locks.withLock(input.id)(
        Effect.gen(function* () {
          const existing = find(input.id)
          if (existing?.scope) yield* Scope.close(existing.scope, Exit.void).pipe(Effect.ignore)
          const next: Entry = {
            ...input,
            identity: {
              id: input.id,
              source: input.identity?.source ?? "bundled",
              trust: input.identity?.trust ?? "bundled",
              ...(input.identity?.name ? { name: input.identity.name } : {}),
              ...(input.identity?.apiVersion ? { apiVersion: input.identity.apiVersion } : {}),
              capabilities: [...(input.identity?.capabilities ?? [])],
              order: input.identity?.order ?? 0,
            },
            lifecycle: "resolved",
          }
          entries = [...entries.filter((item) => item.id !== input.id), next].toSorted(
            (a, b) => a.identity.order - b.identity.order || a.identity.id.localeCompare(b.identity.id),
          )
          yield* publishStatus(next)
        }),
      )
    })
    const inspect = Effect.fn("Plugin.inspect")(function* () {
      return entries.map((entry) => ({
        identity: { ...entry.identity, capabilities: [...entry.identity.capabilities] },
        lifecycle: entry.lifecycle,
        ...(entry.error ? { error: entry.error } : {}),
      }))
    })
    const remove = Effect.fn("Plugin.remove")(function* (id: ID) {
      yield* locks.withLock(id)(
        Effect.gen(function* () {
          const existing = find(id)
          entries = entries.filter((item) => item.id !== id)
          if (!existing) return
          if (existing.scope) yield* Scope.close(existing.scope, Exit.void).pipe(Effect.ignore)
          existing.scope = undefined
          existing.hooks = undefined
          existing.lifecycle = "removed"
          yield* publishStatus(existing)
        }),
      )
    })

    const svc = Service.of({
      register,
      activate,
      deactivate,
      inspect,
      add: Effect.fn("Plugin.add")(function* (input) {
        yield* register({ id: input.id, effect: input.effect })
        yield* activate(input.id)
      }),
      trigger: Effect.fn("Plugin.trigger")(function* (name, input, output) {
        return yield* svc.triggerFor(ID.make("*"), name, input, output)
      }),
      triggerFor: Effect.fn("Plugin.triggerFor")(function* (id, name, input, output) {
        const draftEntries = new Map<string, ReturnType<typeof createDraft>>()
        const event = {
          ...input,
          ...output,
        } as Record<string, unknown>

        for (const [field, value] of Object.entries(output)) {
          if (value && typeof value === "object") {
            draftEntries.set(field, createDraft(value))
            event[field] = draftEntries.get(field)
          }
        }

        for (const item of entries) {
          if (id !== ID.make("*") && item.id !== id) continue
          if (item.lifecycle !== "active") continue
          const match = item.hooks?.[name]
          if (!match) continue
          yield* match(event as any).pipe(
            Effect.withSpan(`Plugin.hook.${name}`, {
              attributes: {
                plugin: item.id,
                hook: name,
              },
            }),
          )
        }

        for (const [field, draft] of draftEntries) {
          event[field] = finishDraft(draft)
        }

        return event as any
      }),
      remove,
    })
    return svc
  }),
)

export const locationLayer = layer

// legacy compatibility notes
