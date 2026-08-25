import path from "path"
import z from "zod"
import { Global } from "../global"
import { Effect, Layer, Context } from "effect"
import { AppFileSystem } from "@/filesystem"

export const Tokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
})
export type Tokens = z.infer<typeof Tokens>

export const ClientInfo = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientIdIssuedAt: z.number().optional(),
  clientSecretExpiresAt: z.number().optional(),
})
export type ClientInfo = z.infer<typeof ClientInfo>

export const Entry = z.object({
  tokens: Tokens.optional(),
  clientInfo: ClientInfo.optional(),
  codeVerifier: z.string().optional(),
  oauthState: z.string().optional(),
  serverUrl: z.string().optional(),
})
export type Entry = z.infer<typeof Entry>

const directory = path.join(Global.Path.config, "mcps")

function filepath(mcpName: string) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(mcpName)) {
    throw new Error(`Invalid MCP name: ${mcpName}`)
  }
  return path.join(directory, mcpName, "data", "auth.json")
}

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, Entry>>
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly set: (mcpName: string, entry: Entry, serverUrl?: string) => Effect.Effect<void>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateTokens: (mcpName: string, tokens: Tokens, serverUrl?: string) => Effect.Effect<void>
  readonly updateClientInfo: (mcpName: string, clientInfo: ClientInfo, serverUrl?: string) => Effect.Effect<void>
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
  readonly isTokenExpired: (mcpName: string) => Effect.Effect<boolean | null>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/McpAuth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const all = Effect.fn("McpAuth.all")(function* () {
      const entries = yield* fs.readDirectoryEntries(directory).pipe(Effect.orElseSucceed(() => []))
      const records = yield* Effect.forEach(
        entries.filter((entry) => entry.type === "directory" && /^[a-z0-9][a-z0-9._-]*$/i.test(entry.name)),
        (entry) =>
          fs.readJson(filepath(entry.name)).pipe(
            Effect.flatMap((data) =>
              Effect.try({
                try: () => [entry.name, Entry.parse(data)] as const,
                catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
              }),
            ),
            Effect.option,
          ),
        { concurrency: "unbounded" },
      )
      return Object.fromEntries(records.flatMap((entry) => (entry._tag === "Some" ? [entry.value] : [])))
    })

    const get = Effect.fn("McpAuth.get")(function* (mcpName: string) {
      return yield* fs.readJson(filepath(mcpName)).pipe(
        Effect.flatMap((data) =>
          Effect.try({
            try: () => Entry.parse(data),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }),
        ),
        Effect.option,
        Effect.map((entry) => (entry._tag === "Some" ? entry.value : undefined)),
      )
    })

    const getForUrl = Effect.fn("McpAuth.getForUrl")(function* (mcpName: string, serverUrl: string) {
      const entry = yield* get(mcpName)
      if (!entry) return undefined
      if (!entry.serverUrl) return undefined
      if (entry.serverUrl !== serverUrl) return undefined
      return entry
    })

    const set = Effect.fn("McpAuth.set")(function* (mcpName: string, entry: Entry, serverUrl?: string) {
      if (serverUrl) entry.serverUrl = serverUrl
      const target = filepath(mcpName)
      yield* fs.ensureDir(path.dirname(target)).pipe(Effect.orDie)
      yield* fs.writeJson(target, entry, 0o600).pipe(Effect.orDie)
    })

    const remove = Effect.fn("McpAuth.remove")(function* (mcpName: string) {
      yield* fs.remove(filepath(mcpName), { force: true }).pipe(Effect.orDie)
    })

    const updateField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string, value: NonNullable<Entry[K]>, serverUrl?: string) {
        const entry = (yield* get(mcpName)) ?? {}
        entry[field] = value
        yield* set(mcpName, entry, serverUrl)
      })

    const clearField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string) {
        const entry = yield* get(mcpName)
        if (entry) {
          delete entry[field]
          yield* set(mcpName, entry)
        }
      })

    const updateTokens = updateField("tokens", "updateTokens")
    const updateClientInfo = updateField("clientInfo", "updateClientInfo")
    const updateCodeVerifier = updateField("codeVerifier", "updateCodeVerifier")
    const updateOAuthState = updateField("oauthState", "updateOAuthState")
    const clearCodeVerifier = clearField("codeVerifier", "clearCodeVerifier")
    const clearOAuthState = clearField("oauthState", "clearOAuthState")

    const getOAuthState = Effect.fn("McpAuth.getOAuthState")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      return entry?.oauthState
    })

    const isTokenExpired = Effect.fn("McpAuth.isTokenExpired")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      if (!entry?.tokens) return null
      if (!entry.tokens.expiresAt) return false
      return entry.tokens.expiresAt < Date.now() / 1000
    })

    return Service.of({
      all,
      get,
      getForUrl,
      set,
      remove,
      updateTokens,
      updateClientInfo,
      updateCodeVerifier,
      clearCodeVerifier,
      updateOAuthState,
      getOAuthState,
      clearOAuthState,
      isTokenExpired,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as McpAuth from "./auth"

