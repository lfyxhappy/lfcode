import { describe, expect, test } from "bun:test"
import { lanAgentOptions, lanModelOptions } from "../../src/lan-access"

describe("LAN catalog projection", () => {
  test("keeps only safe model identity fields", () => {
    expect(lanModelOptions({
      providers: [{
        id: "openai",
        name: "OpenAI",
        models: { "gpt-test": { id: "gpt-test", name: "GPT Test", apiKey: "secret" } },
        headers: { authorization: "secret" },
      }],
      default: { openai: "gpt-test" },
    })).toEqual([{ providerID: "openai", providerName: "OpenAI", modelID: "gpt-test", modelName: "GPT Test", modelRef: "openai/gpt-test", default: true }])
  })

  test("excludes hidden and subagent entries", () => {
    expect(lanAgentOptions([
      { name: "build", mode: "primary" },
      { name: "worker", mode: "subagent" },
      { name: "internal", mode: "all", hidden: true },
    ])).toEqual([{ name: "build" }])
  })
})
