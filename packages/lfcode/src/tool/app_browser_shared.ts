import z from "zod"
import { Effect } from "effect"
import { isAbsolute, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Config } from "@/config"
import { Session } from "@/session"
import type * as Tool from "./tool"
import { createAppControlClient, ensureAppControlAccess, ensureBrowserControlAccess } from "@/app-control/client"
import { browserSessionKey } from "@/server/routes/browser-session-authorization"

export function withAppControlAccess(
  required: "read_only" | "session_control" | "browser_control" | "full_app_control",
) {
  return Effect.gen(function* () {
    const config = yield* Config.Service
    const current = yield* config.getGlobal()
    ensureAppControlAccess(current, required)
    return yield* Effect.promise(() => createAppControlClient())
  })
}

export function normalizeBrowserToolURL(value: string, directory: string) {
  const input = value.trim()
  if (!input) return input
  if (/^(?:file|https?|about):\/\//i.test(input) || /^about:/i.test(input)) return input

  const looksLikePath =
    /^[A-Za-z]:[\\/]/.test(input) ||
    /^\\\\/.test(input) ||
    /^\/(?!\/)/.test(input) ||
    /(?:^|[\\/])[^\\/]+\.html?(?:[?#].*)?$/i.test(input)
  if (!looksLikePath) return input

  const match = input.match(/^([^?#]*)([?#].*)?$/)
  const path = isAbsolute(match?.[1] ?? input) ? (match?.[1] ?? input) : resolve(directory, match?.[1] ?? input)
  return `${pathToFileURL(path).href}${match?.[2] ?? ""}`
}

export const appBrowserAccess = Effect.gen(function* () {
  const config = yield* Config.Service
  const session = yield* Session.Service
  return {
    client: (required: "read_only" | "session_control" | "browser_control" | "full_app_control") =>
      Effect.gen(function* () {
        ensureAppControlAccess(yield* config.getGlobal(), required)
        return yield* Effect.promise(() => createAppControlClient())
      }),
    browserClient: (required: "read_only" | "interactive") =>
      Effect.gen(function* () {
        ensureBrowserControlAccess(yield* config.getGlobal(), required)
        return yield* Effect.promise(() => createAppControlClient())
      }),
    sessionKey: (ctx: Tool.Context, sessionKey?: string) => {
      if (sessionKey) return Effect.succeed(sessionKey)
      return session
        .get(ctx.sessionID)
        .pipe(Effect.map((info) => browserSessionKey({ directory: info.directory, sessionID: ctx.sessionID })))
    },
    authorizationSessionKey: (ctx: Tool.Context) =>
      session
        .get(ctx.sessionID)
        .pipe(Effect.map((info) => browserSessionKey({ directory: info.directory, sessionID: ctx.sessionID }))),
    browserURL: (ctx: Tool.Context, value: string) =>
      session.get(ctx.sessionID).pipe(
        Effect.map((info) => normalizeBrowserToolURL(value, info.directory)),
      ),
  }
})

export function appBrowserTool<Parameters extends z.ZodType, Result extends Tool.Metadata>(
  parameters: Parameters,
  init: (app: Effect.Success<typeof appBrowserAccess>) => Omit<Tool.DefWithoutID<Parameters, Result>, "parameters">,
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
  return browserSessionKey({ directory: info.directory, sessionID: ctx.sessionID })
})
