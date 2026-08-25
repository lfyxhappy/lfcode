import { nativeWebSearchNeedsFallback, nativeWebSearchResult } from "@lfcode-ai/shared/web-search"

type UnknownRecord = Record<string, unknown>

export function nativeWebSearchToolOutput(input: {
  action?: unknown
  output?: unknown
  /**
   * Responses providers can emit URL citations on the assistant message
   * instead of on `web_search_call.action`. Keep those citations attached to
   * the provider result so a completed search is not mistaken for a failed
   * search while the stream is being normalized.
   */
  sources?: unknown
  status?: string
}) {
  const action = asRecord(input.action)
  const output = asRecord(input.output)
  const metadata = asRecord(output?.metadata)
  const result = nativeWebSearchResult({
    query:
      readString(action, "query") ??
      readString(output, "query") ??
      readString(metadata, "querySent") ??
      readString(metadata, "queryOriginal"),
    sources: input.sources ?? action?.sources ?? output?.sources ?? metadata?.sources,
    status: input.status ?? readString(output, "status"),
  })
  const sourceText = result.sources.map((source) => `- ${source.title ?? source.url}: ${source.url}`).join("\n")
  return {
    title: readString(output, "title") ?? "Native web search",
    output: readString(output, "output") ?? (sourceText || "Provider-native search returned no verifiable citations."),
    metadata: {
      ...result,
      fallbackRecommended: nativeWebSearchNeedsFallback(result),
    },
  }
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as UnknownRecord
}

function readString(record: UnknownRecord | undefined, key: string) {
  const value = record?.[key]
  return typeof value === "string" && value.trim() ? value : undefined
}
