import z from "zod"
import { Effect } from "effect"
import { Config } from "@/config"
import { Session } from "@/session"
import type * as Tool from "./tool"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

export function withAppControlAccess(required: "read_only" | "session_control" | "browser_control" | "full_app_control") {
  return Effect.gen(function* () {
    const config = yield* Config.Service
    const current = yield* config.get()
    ensureAppControlAccess(current, required)
    return yield* Effect.promise(() => createAppControlClient())
  })
}

export const appBrowserAccess = Effect.gen(function* () {
  const config = yield* Config.Service
  const session = yield* Session.Service
  return {
    client: (required: "read_only" | "session_control" | "browser_control" | "full_app_control") =>
      Effect.gen(function* () {
        ensureAppControlAccess(yield* config.get(), required)
        return yield* Effect.promise(() => createAppControlClient())
      }),
    sessionKey: (ctx: Tool.Context, sessionKey?: string) => {
      if (sessionKey) return Effect.succeed(sessionKey)
      return session.get(ctx.sessionID).pipe(Effect.map((info) => `${info.directory}/${ctx.sessionID}`))
    },
  }
})

export function appBrowserTool<Parameters extends z.ZodType, Result extends Tool.Metadata>(
  parameters: Parameters,
  init: (
    app: Effect.Success<typeof appBrowserAccess>,
  ) => Omit<Tool.DefWithoutID<Parameters, Result>, "parameters">,
) {
  return appBrowserAccess.pipe(Effect.map((app) => ({ ...init(app), parameters })))
}

export const resolveCurrentSessionKey = Effect.fn("AppControl.resolveCurrentSessionKey")(function* (
  ctx: Tool.Context,
  sessionKey?: string,
) {
  if (sessionKey) return sessionKey
  const session = yield* Session.Service
  const info = yield* session.get(ctx.sessionID)
  return `${info.directory}/${ctx.sessionID}`
})
