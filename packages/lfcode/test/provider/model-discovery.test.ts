import { expect, test } from "bun:test"
import { discoverProviderModels } from "../../src/provider/model-discovery"
import { matchModelsInCatalog } from "../../src/provider/model-suggestions"
import { ProviderID } from "../../src/provider/schema"

test("generic model discovery parses OpenAI-compatible catalogs", async () => {
  const result = await discoverProviderModels(
    {
      id: ProviderID.make("custom"),
      name: "Custom",
      source: "config",
      env: [],
      key: "secret",
      options: { baseURL: "https://example.test/v1" },
      models: {},
    },
    {
      fetch: async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret")
        return new Response(
          JSON.stringify({
            data: [{ id: "gpt-test", name: "GPT Test", protocol: "openai-responses" }, { id: "gpt-test" }],
          }),
          {
          headers: { "content-type": "application/json" },
          },
        )
      },
    },
  )
  expect(result).toEqual({
    source: "remote",
    models: [{ id: "gpt-test", name: "GPT Test", protocol: "openai-responses" }],
  })
})

test("generic discovery rejects unsafe endpoints", async () => {
  const result = await discoverProviderModels({
    id: ProviderID.make("custom"),
    name: "Custom",
    source: "config",
    env: [],
    options: { baseURL: "file:///tmp/provider" },
    models: {},
  })
  expect(result.error).toBe("unsafe_url")
})

test("local model matching prioritizes the selected provider", () => {
  const result = matchModelsInCatalog({
    providerID: "custom",
    query: "gpt-5",
    catalog: {
      other: {
        id: "other",
        name: "Other",
        env: [],
        models: {
          "gpt-5": {
            id: "gpt-5",
            name: "GPT 5",
            release_date: "",
            attachment: false,
            reasoning: false,
            temperature: true,
            tool_call: true,
            limit: { context: 1, output: 1 },
          },
        },
      },
      custom: {
        id: "custom",
        name: "Custom",
        env: [],
        models: {
          "gpt-5": {
            id: "gpt-5",
            name: "GPT 5 custom",
            release_date: "",
            attachment: false,
            reasoning: false,
            temperature: true,
            tool_call: true,
            limit: { context: 1, output: 1 },
          },
        },
      },
    },
  })
  expect(result[0].providerID).toBe("custom")
})
