import { expect, test } from "bun:test"
import {
  nativeWebSearchNeedsFallback,
  nativeWebSearchResult,
  normalizeWebSearchQuery,
  normalizeWebSearchSources,
} from "./web-search"

test("normalizes search queries without rewriting Chinese text", () => {
  expect(normalizeWebSearchQuery("玄奘仙族")).toEqual({
    queryOriginal: "玄奘仙族",
    querySent: "玄奘仙族",
    queryFidelity: "exact",
    warnings: [],
  })
})

test("reports a harmless NFC rewrite as normalized rather than suspect", () => {
  const result = normalizeWebSearchQuery("cafe\u0301")
  expect(result.querySent).toBe("café")
  expect(result.queryFidelity).toBe("normalized")
  expect(result.warnings).toEqual(["query normalized to Unicode NFC"])
})

test("marks suspicious literal escapes and replacement characters", () => {
  const result = normalizeWebSearchQuery("\\u7384\uFFFD")
  expect(result.queryOriginal).toBe("\\u7384\uFFFD")
  expect(result.querySent).toBe("\\u7384\uFFFD")
  expect(result.queryFidelity).toBe("suspect")
  expect(result.warnings).toHaveLength(2)
})

test("normalizes provider-native sources into the common citation shape", () => {
  expect(
    normalizeWebSearchSources([
      {
        url: "https://www.rfc-editor.org/rfc/rfc9110.html?utm_source=test#section",
        title: "HTTP Semantics",
        description: "The HTTP core specification.",
        published_at: "2022-06-01",
      },
    ]),
  ).toEqual([
    {
      url: "https://www.rfc-editor.org/rfc/rfc9110.html",
      domain: "www.rfc-editor.org",
      sourceTier: "primary",
      title: "HTTP Semantics",
      snippet: "The HTTP core specification.",
      publishedAt: "2022-06-01",
    },
  ])
})

test("marks source-less or failed native search results for local fallback", () => {
  const failed = nativeWebSearchResult({ query: "玄奘仙族", status: "failed", sources: [] })
  expect(failed.queryFidelity).toBe("exact")
  expect(nativeWebSearchNeedsFallback(failed)).toBe(true)

  const cited = nativeWebSearchResult({
    query: "RFC 9110",
    status: "completed",
    sources: [{ url: "https://www.rfc-editor.org/rfc/rfc9110.html" }],
  })
  expect(nativeWebSearchNeedsFallback(cited)).toBe(false)
})
