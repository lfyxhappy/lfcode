import { describe, expect, test } from "bun:test"
import type { Info } from "./config"
import { withGlobalCustomProvider, withoutGlobalCustomProvider } from "./config"

describe("global custom provider helpers", () => {
  const base: Info = {
    provider: {
      "existing-custom": {
        name: "Existing Custom",
        npm: "@ai-sdk/openai-compatible",
        protocol: "openai-chat",
        options: {
          baseURL: "https://existing.example.com",
        },
        models: {
          "model-a": {
            name: "Model A",
          },
        },
      },
    },
    disabled_providers: ["existing-custom", "other"],
  }

  test("upsert helper stores provider and clears disabled flag", () => {
    expect(
      withGlobalCustomProvider(base as never, "existing-custom", {
        name: "Updated Custom",
        npm: "@ai-sdk/openai-compatible",
        protocol: "openai-chat",
        options: {
          baseURL: "https://updated.example.com",
        },
        models: {
          "model-b": {
            name: "Model B",
          },
        },
      } as never),
    ).toMatchObject({
      provider: {
        "existing-custom": {
          name: "Updated Custom",
          options: {
            baseURL: "https://updated.example.com",
          },
        },
      },
      disabled_providers: ["other"],
    })
  })

  test("remove helper clears provider and disabled flag", () => {
    expect(withoutGlobalCustomProvider(base as never, "existing-custom")).toMatchObject({
      disabled_providers: ["other"],
    })
  })
})
