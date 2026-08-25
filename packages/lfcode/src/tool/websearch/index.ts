import z from "zod"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "../tool"
import DESCRIPTION from "./websearch.txt"
import { formatLegacyWebSearchOutput, formatWebSearchFailure, runCompatWebSearch } from "./fallback"
import { normalizeWebSearchQuery, type WebSearchProvider, type WebSearchRoute } from "@lfcode-ai/shared/web-search"
import { chooseSearchRoute, type BrowserSearchEngine } from "@/research/routing"
import { getEvidenceByURL, getResearchSettings, isEvidenceFresh, listSourceProfiles } from "@/research/persistence"
import { sourceProfileEntryURL, sourceToWebSearchSource } from "@/research/registry"
import { Instance } from "@/project/instance"

const WEBFETCH_FALLBACK = "Web search unavailable. Use `webfetch` with a relevant URL instead."
const Parameters = z.object({
  query: z.string().describe("Websearch query"),
  url: z.string().url().optional().describe("Known URL to read directly instead of discovering new pages"),
  route: z.enum(["native", "direct", "browser", "cache", "compat"]).optional(),
  compatProvider: z.enum(["exa", "parallel"]).optional().describe("Explicitly selected legacy compatibility provider"),
  browserEngine: z.enum(["bing", "google", "baidu", "custom"]).optional(),
  browserURLTemplate: z.string().optional().describe("Custom browser URL template containing {query}"),
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
          const fidelity = normalizeWebSearchQuery(params.query)
          const projectID = String(Instance.project.id)
          const settings = getResearchSettings(projectID)
          const profiles = listSourceProfiles(projectID, { enabledOnly: true })
          const cached = params.url ? getEvidenceByURL(projectID, params.url) : undefined
          const browser = browserConfig(settings, params.browserEngine, params.browserURLTemplate)
          const decision = chooseSearchRoute({
            query: params.query,
            url: params.url,
            route: params.route,
            browser,
            compatProvider: params.compatProvider as WebSearchProvider | undefined,
            hasRegisteredDirectSource: profiles.length > 0,
            registeredDirectURL: profiles.map(sourceProfileEntryURL).find((value): value is string => Boolean(value)),
            cachedURL: cached && isEvidenceFresh(cached) ? cached.canonicalURL : undefined,
          })
          yield* ctx.ask({
            permission: "websearch",
            patterns: [decision.url ?? fidelity.querySent],
            always: ["*"],
            metadata: {
              query: fidelity.querySent,
              queryOriginal: fidelity.queryOriginal,
              queryFidelity: fidelity.queryFidelity,
              route: decision.route,
              url: decision.url,
              compatProvider: decision.compatProvider,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              timeout: params.timeout,
            },
          })

          const result =
            decision.route === "compat" && decision.compatProvider
              ? yield* runCompatWebSearch({
                  http,
                  sessionID: ctx.sessionID,
                  provider: decision.compatProvider,
                  query: params,
                }).pipe(
                  Effect.map((value) => ({ ...value, route: "compat" as const, queryPlanned: decision.queryPlanned })),
                  Effect.catch((failure) =>
                    Effect.succeed({
                      route: "compat" as const,
                      provider: decision.compatProvider!,
                      queryOriginal: fidelity.queryOriginal,
                      queryPlanned: decision.queryPlanned,
                      querySent: fidelity.querySent,
                      queryFidelity: fidelity.queryFidelity,
                      attemptedProviders: [decision.compatProvider!],
                      text: WEBFETCH_FALLBACK,
                      sources: [],
                      warnings: [...decision.warnings, formatWebSearchFailure(failure)],
                      limits: {
                        maxResults: params.numResults ?? 8,
                        maxContextCharacters: params.contextMaxCharacters,
                      },
                    }),
                  ),
                )
              : {
                  route: decision.route,
                  provider: decision.route,
                  queryOriginal: decision.queryOriginal,
                  queryPlanned: decision.queryPlanned,
                  querySent: decision.querySent,
                  queryFidelity: decision.queryFidelity,
                  attemptedProviders: [],
                  text: decision.route === "cache" && cached ? formatCachedEvidence(cached) : routeMessage(decision.route, decision.url),
                  sources:
                    decision.route === "cache" && cached
                      ? [
                          sourceToWebSearchSource({
                            url: cached.canonicalURL,
                            finalUrl: cached.finalURL,
                            title: cached.title,
                            snippet: cached.excerpts[0]?.text,
                            publishedAt: cached.publishedAt,
                            updatedAt: cached.sourceUpdatedAt,
                            sourceIdentity: cached.sourceIdentity,
                            evidenceStatus: cached.evidenceStatus,
                            evidenceID: cached.id,
                          }),
                        ].filter((source): source is NonNullable<typeof source> => Boolean(source))
                      : [],
                  warnings: decision.warnings,
                  limits: {
                    maxResults: params.numResults ?? 8,
                    maxContextCharacters: params.contextMaxCharacters,
                  },
                }

          return {
            output:
              result.route === "compat" && (result.provider === "exa" || result.provider === "parallel")
                ? formatLegacyWebSearchOutput(result)
                : `${result.text}${formatURLHint(result.route, decision.url)}`,
            title: `Web search: ${params.query}`,
            metadata: {
              route: result.route,
              provider: result.provider,
              queryOriginal: result.queryOriginal,
              queryPlanned: result.queryPlanned,
              querySent: result.querySent,
              queryFidelity: result.queryFidelity,
              attemptedProviders: result.attemptedProviders,
              sources: result.sources,
              warnings: result.warnings,
              limits: result.limits,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function browserConfig(
  settings: ReturnType<typeof getResearchSettings>,
  engine: BrowserSearchEngine | undefined,
  template: string | undefined,
) {
  const selected = settings?.browserSearchEngine ?? engine ?? (process.env.LFCODE_BROWSER_SEARCH_ENGINE as BrowserSearchEngine | undefined) ?? "bing"
  return {
    engine: selected,
    template: settings?.browserSearchURLTemplate ?? template ?? process.env.LFCODE_BROWSER_SEARCH_URL_TEMPLATE,
  }
}

function routeMessage(route: WebSearchRoute, url: string | undefined) {
  if (route === "direct") return url ? "Known URL selected for direct retrieval. Use `webfetch` to read it and persist evidence." : WEBFETCH_FALLBACK
  if (route === "browser")
    return url
      ? `Browser discovery URL prepared: ${url}\nOpen it with an available browser or browser-automation tool, then use webfetch only on the selected result URL.`
      : "Browser discovery is not configured. Choose Bing, Google, Baidu, or a custom URL template."
  if (route === "native") return "Provider-native search was selected; verifiable citations will be attached by the provider tool."
  if (route === "cache") return url ? `Fresh cached evidence was selected: ${url}` : "A cached evidence record was selected."
  return "Compatibility search requires an explicit provider selection."
}

function formatCachedEvidence(record: {
  id: string
  canonicalURL: string
  version: number
  body?: string
  excerpts: Array<{ text: string; locator?: string }>
}) {
  const body = record.body?.trim() || record.excerpts.map((excerpt) => excerpt.text).join("\n\n")
  const excerpt = body.slice(0, 50_000)
  return `Fresh cached evidence (v${record.version}) for ${record.canonicalURL} [${record.id}]:\n${excerpt || "No readable content was stored; use webfetch for the URL."}`
}

function formatURLHint(route: WebSearchRoute, url: string | undefined) {
  if (!url || route === "direct" || route === "browser") return ""
  return `\n\nRoute: ${route}`
}
