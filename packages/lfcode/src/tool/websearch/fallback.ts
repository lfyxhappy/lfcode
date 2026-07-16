import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import {
  extractWebSearchSources,
  getWebSearchProviderOrder,
  isRetryableWebSearchFailure,
  type WebSearchFailureClass,
  type WebSearchProvider,
  type WebSearchSource,
} from "@lfcode-ai/shared/web-search"

const EXA_URL = "https://mcp.exa.ai/mcp"
const PARALLEL_URL = "https://search.parallel.ai/mcp"
const MAX_RESPONSE_BYTES = 256 * 1024

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
  }),
})
const decodeMcpResult = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))

const ExaArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})
const ParallelArgs = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.String,
})
const McpRequest = <F extends Schema.Struct.Fields>(args: Schema.Struct<F>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Literal(1),
    method: Schema.Literal("tools/call"),
    params: Schema.Struct({ name: Schema.String, arguments: args }),
  })

export type LegacyWebSearchInput = {
  query: string
  numResults?: number
  livecrawl?: "fallback" | "preferred"
  type?: "auto" | "fast" | "deep"
  contextMaxCharacters?: number
  timeout?: number
}

export type LegacyWebSearchResult = {
  provider: WebSearchProvider
  attemptedProviders: WebSearchProvider[]
  text: string
  sources: WebSearchSource[]
  warnings: string[]
}

type SearchFailure = {
  provider: WebSearchProvider
  classification: WebSearchFailureClass
  retryable: boolean
  status?: number
}

function parseMcpText(body: string) {
  return Effect.gen(function* () {
    const payloads = [body.trim(), ...body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6))]
    for (const payload of payloads) {
      if (!payload.startsWith("{")) continue
      const decoded = yield* decodeMcpResult(payload).pipe(
        Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
      )
      const text = decoded?.result.content.find((item) => item.text)?.text
      if (text) return text
    }
  })
}

function extractHttpStatus(error: unknown) {
  if (!error || typeof error !== "object") return
  const reason = "reason" in error ? error.reason : error
  if (!reason || typeof reason !== "object") return
  if ("response" in reason && reason.response && typeof reason.response === "object" && "status" in reason.response) {
    const status = reason.response.status
    if (typeof status === "number") return status
  }
}

function classifyFailure(provider: WebSearchProvider, error: unknown): SearchFailure {
  const status = extractHttpStatus(error)
  if (status !== undefined) {
    const classification: WebSearchFailureClass = status >= 500 ? "http_5xx" : "http_4xx"
    return { provider, classification, retryable: isRetryableWebSearchFailure(classification), status }
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  const classification: WebSearchFailureClass = message.includes("timed_out") || message.includes("timeout")
    ? "timeout"
    : message.includes("credential") || message.includes("unauthorized") || message.includes("forbidden")
      ? "missing_credentials"
      : message.includes("parse")
        ? "parse_failure"
        : message.includes("empty")
          ? "empty_response"
          : "transport"
  return { provider, classification, retryable: isRetryableWebSearchFailure(classification) }
}

export function formatWebSearchFailure(failure: SearchFailure) {
  return `${failure.provider}:${failure.classification}${failure.status ? ` (${failure.status})` : ""}`
}

const callMcp = <F extends Schema.Struct.Fields>(input: {
  http: HttpClient.HttpClient
  url: string
  tool: string
  args: Schema.Struct<F>
  value: Schema.Struct.Type<F>
  headers?: Record<string, string>
  timeout: Duration.Input
}) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(input.url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(input.headers ?? {}),
      HttpClientRequest.schemaBodyJson(McpRequest(input.args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call",
        params: { name: input.tool, arguments: input.value },
      }),
    )
    return yield* Effect.gen(function* () {
      const response = yield* HttpClient.filterStatusOk(input.http).execute(request)
      const body = yield* response.text
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) return yield* Effect.fail(new Error("response_too_large"))
      const text = yield* parseMcpText(body)
      if (!text?.trim()) return yield* Effect.fail(new Error("empty_response"))
      return text
    }).pipe(
      Effect.timeoutOrElse({ duration: input.timeout, orElse: () => Effect.fail(new Error("request_timed_out")) }),
    )
  })

const providerOverride = () => {
  const value = process.env.LFCODE_WEBSEARCH_PROVIDER
  return value === "exa" || value === "parallel" ? value : undefined
}

const callProvider = (input: {
  http: HttpClient.HttpClient
  provider: WebSearchProvider
  sessionID: string
  query: LegacyWebSearchInput
}) => {
  const timeout = Duration.seconds(Math.min(input.query.timeout ?? 20, 20))
  const effect = input.provider === "exa"
    ? callMcp({
        http: input.http,
        url: process.env.EXA_API_KEY ? `${EXA_URL}?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}` : EXA_URL,
        tool: "web_search_exa",
        args: ExaArgs,
        value: {
          query: input.query.query,
          type: input.query.type ?? "auto",
          numResults: input.query.numResults ?? 8,
          livecrawl: input.query.livecrawl ?? "fallback",
          contextMaxCharacters: input.query.contextMaxCharacters,
        },
        timeout,
      })
    : callMcp({
        http: input.http,
        url: PARALLEL_URL,
        tool: "web_search",
        args: ParallelArgs,
        value: { objective: input.query.query, search_queries: [input.query.query], session_id: input.sessionID },
        headers: {
          "User-Agent": "lfcode",
          ...(process.env.PARALLEL_API_KEY ? { Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` } : {}),
        },
        timeout,
      })
  return effect.pipe(Effect.mapError((error) => classifyFailure(input.provider, error)))
}

export const runLegacyWebSearchWithFallback = Effect.fn("WebSearch.runLegacyWebSearchWithFallback")(function* (input: {
  http: HttpClient.HttpClient
  sessionID: string
  query: LegacyWebSearchInput
}) {
  return yield* Effect.gen(function* () {
    const providers = getWebSearchProviderOrder(providerOverride())
    const attemptedProviders: WebSearchProvider[] = []
    const warnings: string[] = []

    for (const provider of providers) {
      attemptedProviders.push(provider)
      const attempt = yield* callProvider({ ...input, provider }).pipe(
        Effect.match({
          onFailure: (failure) => ({ ok: false as const, failure }),
          onSuccess: (text) => ({ ok: true as const, text }),
        }),
      )
      if (attempt.ok) {
        return {
          provider,
          attemptedProviders,
          text: attempt.text,
          sources: extractWebSearchSources(attempt.text),
          warnings,
        } satisfies LegacyWebSearchResult
      }
      warnings.push(formatWebSearchFailure(attempt.failure))
      if (!attempt.failure.retryable || providers.at(-1) === provider) return yield* Effect.fail(attempt.failure)
    }

    return yield* Effect.fail({ provider: "exa", classification: "transport", retryable: true } satisfies SearchFailure)
  }).pipe(
    Effect.timeoutOrElse({
      duration: "45 seconds",
      orElse: () => Effect.fail({ provider: "exa", classification: "timeout", retryable: true } satisfies SearchFailure),
    }),
  )
})

export function formatLegacyWebSearchOutput(result: LegacyWebSearchResult) {
  const sources = result.sources.slice(0, 12).map((source) => `- [${source.sourceTier}] ${source.title ?? source.domain}: ${source.url}`)
  if (sources.length === 0) return result.text
  return `${result.text}\n\nSources (${result.provider}):\n${sources.join("\n")}`
}
