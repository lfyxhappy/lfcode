import { expect, test } from "bun:test"
import { nativeWebSearchProvider } from "../../src/tool/websearch/native"
import { nativeWebSearchToolOutput } from "../../src/tool/websearch/native-result"

const model = (npm: string, native = true) =>
  ({
    api: { npm },
    capabilities: { native_web: native },
  }) as Parameters<typeof nativeWebSearchProvider>[0]

test("selects only supported provider-native web search adapters", () => {
  expect(nativeWebSearchProvider(model("@ai-sdk/openai"))).toBe("openai")
  expect(nativeWebSearchProvider(model("@ai-sdk/anthropic"))).toBe("anthropic")
  expect(nativeWebSearchProvider(model("@ai-sdk/xai"))).toBe("xai")
  expect(nativeWebSearchProvider(model("@ai-sdk/openai-compatible"))).toBeUndefined()
  expect(nativeWebSearchProvider(model("@ai-sdk/openai", false))).toBeUndefined()
})

test("turns provider-native search events into a reusable citation result", () => {
  const result = nativeWebSearchToolOutput({
    action: {
      type: "search",
      query: "RFC 9110",
      sources: [{ url: "https://www.rfc-editor.org/rfc/rfc9110.html", title: "HTTP Semantics" }],
    },
    status: "completed",
  })

  expect(result.metadata).toMatchObject({
    route: "native",
    provider: "native",
    querySent: "RFC 9110",
    fallbackRecommended: false,
    sources: [{ sourceTier: "primary", title: "HTTP Semantics" }],
  })
})

test("marks an unverified provider-native result for one local fallback", () => {
  expect(
    nativeWebSearchToolOutput({ action: { type: "search", query: "latest news" }, status: "failed" }).metadata,
  ).toMatchObject({ fallbackRecommended: true, route: "native" })
})
