export * as WebSearchTool from "./websearch"

import { ToolFailure } from "@lfcode-ai/llm"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { truthy } from "../flag/flag"
import { InstallationVersion } from "../installation/version"
import { PositiveInt } from "../schema"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import {
  extractWebSearchSources,
  getWebSearchProviderOrder,
  isRetryableWebSearchFailure,
  type WebSearchFailureClass,
  type WebSearchProvider,
  type WebSearchSource,
} from "@lfcode-ai/shared/web-search"

export const name = "websearch"
export const NO_RESULTS = "No search results found. Please try a different query."
export const EXA_URL = "https://mcp.exa.ai/mcp"
export const PARALLEL_URL = "https://search.parallel.ai/mcp"
export const MAX_NUM_RESULTS = 20
export const MAX_CONTEXT_CHARACTERS = 50_000
export const MAX_RESPONSE_BYTES = 256 * 1024

/**
 * Provider-independent local web search retained in V2 core for launch parity.
 * This invokes the legacy Exa/Parallel product backends itself. It is distinct
 * from provider-hosted web search tools, which remain route-owned and execute
 * at the model provider. Ownership of this compromise can be revisited later.
 */
export const description = `Search the web using the session's local web search provider. Use this for current information beyond knowledge cutoff.

This is a provider-independent local tool backed by Exa or Parallel. Provider-hosted web search tools are separate and execute at the model provider.

Optional controls support result count, live crawling ('fallback' or 'preferred'), search type ('auto', 'fast', or 'deep'), and maximum context characters.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_NUM_RESULTS))).annotate({
    description: `Number of search results to return (default: 8, maximum: ${MAX_NUM_RESULTS})`,
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_CONTEXT_CHARACTERS))).annotate(
    {
      description: `Maximum characters for context string optimized for models (default: 10000, maximum: ${MAX_CONTEXT_CHARACTERS})`,
    },
  ),
})

export const Provider = Schema.Literals(["exa", "parallel"])
export type Provider = typeof Provider.Type

export interface Config {
  readonly provider?: Provider
  readonly enableExa: boolean
  readonly enableParallel: boolean
  readonly exaApiKey?: string
  readonly parallelApiKey?: string
}

export class ConfigService extends Context.Service<ConfigService, Config>()("@lfcode/v2/WebSearchConfig") {}

/** Isolates the retained product environment contract from the generic tool implementation. */
export const defaultConfigLayer = Layer.sync(ConfigService, () =>
  ConfigService.of({
    provider:
      process.env.LFCODE_WEBSEARCH_PROVIDER === "exa" || process.env.LFCODE_WEBSEARCH_PROVIDER === "parallel"
        ? process.env.LFCODE_WEBSEARCH_PROVIDER
        : undefined,
    enableExa: truthy("LFCODE_EXPERIMENTAL") || truthy("LFCODE_ENABLE_EXA") || truthy("LFCODE_EXPERIMENTAL_EXA"),
    enableParallel: truthy("LFCODE_ENABLE_PARALLEL") || truthy("LFCODE_EXPERIMENTAL_PARALLEL"),
    exaApiKey: process.env.EXA_API_KEY,
    parallelApiKey: process.env.PARALLEL_API_KEY,
  }),
)

export function selectProvider(_sessionID: string, _flags?: Pick<Config, "enableExa" | "enableParallel">, override?: Provider): Provider {
  return getWebSearchProviderOrder(override)[0] ?? "exa"
}

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
  }),
})
const decodeMcpResult = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))

const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    return (yield* decodeMcpResult(trimmed)).result.content.find((item) => item.text)?.text
  })

export const parseResponse = Effect.fn("WebSearchTool.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* parsePayload(line.substring(6))
    if (data) return data
  }
  return undefined
})

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

const exaUrl = (apiKey: string | undefined) => {
  if (!apiKey) return EXA_URL
  const url = new URL(EXA_URL)
  url.searchParams.set("exaApiKey", apiKey)
  return url.toString()
}

const callMcp = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  headers: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(McpRequest(args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    return yield* Effect.gen(function* () {
      const response = yield* HttpClient.filterStatusOk(http).execute(request)
      const body = yield* response.text
      if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) return yield* Effect.fail(new Error("response_too_large"))
      return yield* parseResponse(body)
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(20),
        orElse: () => Effect.fail(new Error("request_timed_out")),
      }),
    )
  })

const Output = Schema.Struct({
  provider: Provider,
  text: Schema.String,
  attemptedProviders: Schema.Array(Provider),
  sources: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      domain: Schema.String,
      sourceTier: Schema.Literals(["primary", "authoritative-secondary", "practitioner", "discovery-only"]),
      title: Schema.optional(Schema.String),
      snippet: Schema.optional(Schema.String),
      publishedAt: Schema.optional(Schema.String),
    }),
  ),
  warnings: Schema.Array(Schema.String),
})

type SearchFailure = {
  provider: WebSearchProvider
  classification: WebSearchFailureClass
  retryable: boolean
  status?: number
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

function classifySearchFailure(provider: WebSearchProvider, error: unknown): SearchFailure {
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

function formatSearchFailure(failure: SearchFailure) {
  return `${failure.provider}:${failure.classification}${failure.status ? ` (${failure.status})` : ""}`
}

const callSearchProvider = (input: {
  http: HttpClient.HttpClient
  config: Config
  provider: WebSearchProvider
  sessionID: string
  query: typeof Input.Type
}) => {
  const result = input.provider === "exa"
    ? callMcp(input.http, exaUrl(input.config.exaApiKey), "web_search_exa", ExaArgs, {
        query: input.query.query,
        type: input.query.type || "auto",
        numResults: input.query.numResults || 8,
        livecrawl: input.query.livecrawl || "fallback",
        contextMaxCharacters: input.query.contextMaxCharacters,
      })
    : callMcp(
        input.http,
        PARALLEL_URL,
        "web_search",
        ParallelArgs,
        {
          objective: input.query.query,
          search_queries: [input.query.query],
          session_id: input.sessionID,
        },
        {
          "User-Agent": `lfcode/${InstallationVersion}`,
          ...(input.config.parallelApiKey ? { Authorization: `Bearer ${input.config.parallelApiKey}` } : {}),
        },
      )
  return result.pipe(
    Effect.flatMap((text) => text?.trim() ? Effect.succeed(text) : Effect.fail(new Error("empty_response"))),
    Effect.mapError((error) => classifySearchFailure(input.provider, error)),
  )
}

export const runSearchWithFallback = Effect.fn("WebSearchTool.runSearchWithFallback")(function* (input: {
  http: HttpClient.HttpClient
  config: Config
  sessionID: string
  query: typeof Input.Type
}) {
  return yield* Effect.gen(function* () {
    const providers = getWebSearchProviderOrder(input.config.provider)
    const attemptedProviders: WebSearchProvider[] = []
    const warnings: string[] = []

    for (const provider of providers) {
      attemptedProviders.push(provider)
      const attempt = yield* callSearchProvider({ ...input, provider }).pipe(
        Effect.match({
          onFailure: (failure) => ({ ok: false as const, failure }),
          onSuccess: (text) => ({ ok: true as const, text }),
        }),
      )
      if (attempt.ok) {
        return {
          provider,
          text: attempt.text,
          attemptedProviders,
          sources: extractWebSearchSources(attempt.text),
          warnings,
        }
      }
      warnings.push(formatSearchFailure(attempt.failure))
      if (!attempt.failure.retryable || providers.at(-1) === provider) return yield* Effect.fail(attempt.failure)
    }

    return yield* Effect.fail({ provider: "exa", classification: "transport", retryable: true } satisfies SearchFailure)
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(45),
      orElse: () => Effect.fail({ provider: "exa", classification: "timeout", retryable: true } satisfies SearchFailure),
    }),
  )
})

export function formatWebSearchModelOutput(output: {
  text: string
  provider: WebSearchProvider
  sources: ReadonlyArray<WebSearchSource>
  warnings: ReadonlyArray<string>
}) {
  const provenance = output.sources.slice(0, 12).map((source) => {
    const label = source.title ?? source.domain
    return `- [${source.sourceTier}] ${label}: ${source.url}`
  })
  if (provenance.length === 0) return output.text
  return `${output.text}\n\nSources (${output.provider}):\n${provenance.join("\n")}`
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const http = yield* HttpClient.HttpClient
    const config = yield* ConfigService
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: formatWebSearchModelOutput(output) }],
          execute: (input, context) => {
            return Effect.gen(function* () {
              const provider = selectProvider(context.sessionID, config, config.provider)
              yield* permission.assert({
                action: name,
                resources: [input.query],
                save: ["*"],
                metadata: { ...input, provider },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              return yield* runSearchWithFallback({ http, config, sessionID: context.sessionID, query: input }).pipe(
                Effect.mapError((failure) =>
                  new ToolFailure({
                    message: `Unable to search the web for ${input.query} (${formatSearchFailure(failure)})`,
                  }),
                ),
              )
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: error instanceof Error ? error.message : String(error) }),
              ),
            )
          },
        }),
      })
      .pipe(Effect.orDie)
  }),
)
