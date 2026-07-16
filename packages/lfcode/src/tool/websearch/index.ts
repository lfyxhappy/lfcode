import z from "zod"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "../tool"
import DESCRIPTION from "./websearch.txt"
import {
  formatLegacyWebSearchOutput,
  formatWebSearchFailure,
  runLegacyWebSearchWithFallback,
} from "./fallback"

const WEBFETCH_FALLBACK =
  "Web search unavailable. Use `webfetch` with a relevant URL instead."
const Parameters = z.object({
  query: z.string().describe("Websearch query"),
  numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
  timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  livecrawl: z
    .enum(["fallback", "preferred"])
    .optional()
    .describe(
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    ),
  type: z
    .enum(["auto", "fast", "deep"])
    .optional()
    .describe("Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search"),
  contextMaxCharacters: z
    .number()
    .optional()
    .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
})

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              timeout: params.timeout,
            },
          })

          const result = yield* runLegacyWebSearchWithFallback({
            http,
            sessionID: ctx.sessionID,
            query: params,
          }).pipe(
            Effect.catch((failure) =>
              Effect.succeed({
                provider: failure.provider,
                attemptedProviders: [failure.provider],
                text: WEBFETCH_FALLBACK,
                sources: [],
                warnings: [formatWebSearchFailure(failure)],
              }),
            ),
          )

          return {
            output: formatLegacyWebSearchOutput(result),
            title: `Web search: ${params.query}`,
            metadata: {
              provider: result.provider,
              attemptedProviders: result.attemptedProviders,
              sources: result.sources,
              warnings: result.warnings,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
