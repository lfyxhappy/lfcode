import { describe, expect, test } from "bun:test"
import { buildDetectedModelPatch } from "./provider"

describe("ProviderRoutes detect helpers", () => {
  test("builds a config-safe model patch", () => {
    expect(
      buildDetectedModelPatch({
        id: "gpt-5",
        name: "GPT-5",
        family: "gpt",
        release_date: "2026-01-01",
        protocol: "openai-responses",
        api: {
          id: "gpt-5",
          url: "https://api.openai.com/v1",
          npm: "@ai-sdk/openai",
        },
        cost: {
          input: 1,
          output: 2,
          cache: {
            read: 3,
            write: 4,
          },
        },
        limit: {
          context: 128000,
          input: 64000,
          output: 4096,
        },
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          native_web: false,
          patch_editing: false,
          input: {
            text: true,
            audio: false,
            image: true,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: { field: "reasoning_content" },
        },
        variants: {},
        headers: {
          "x-test": "1",
        },
        options: {
          baseURL: "https://api.openai.com/v1",
        },
        cachePromptTTL: "1h",
      } as never),
    ).toMatchObject({
      id: "gpt-5",
      name: "GPT-5",
      family: "gpt",
      release_date: "2026-01-01",
      protocol: "openai-responses",
      interleaved: { field: "reasoning_content" },
      cachePromptTTL: "1h",
      provider: {
        api: "https://api.openai.com/v1",
        npm: "@ai-sdk/openai",
      },
      limit: {
        context: 128000,
        input: 64000,
        output: 4096,
      },
      cost: {
        input: 1,
        output: 2,
        cache_read: 3,
        cache_write: 4,
      },
      capabilities: {
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        text: true,
        image: true,
        audio: false,
        video: false,
        pdf: false,
        attachment: true,
        tool_call: true,
        reasoning: true,
        patch_editing: false,
        native_web: false,
        temperature: true,
      },
      headers: {
        "x-test": "1",
      },
      options: {
        baseURL: "https://api.openai.com/v1",
      },
    })
  })

  test("drops unsupported false interleaved values", () => {
    expect(
      buildDetectedModelPatch({
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        family: "deepseek",
        protocol: "openai-chat",
        api: {
          id: "deepseek-v4-flash",
          url: "https://example.com/v1",
          npm: "@ai-sdk/openai-compatible",
        },
        cost: {
          input: 1,
          output: 2,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 128000,
          input: 128000,
          output: 8192,
        },
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          native_web: false,
          patch_editing: false,
          input: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        variants: {},
        headers: {},
        options: {},
      } as never),
    ).toMatchObject({
      interleaved: undefined,
    })
  })

  test("overrides probed capabilities without touching unrelated ones", () => {
    expect(
      buildDetectedModelPatch(
        {
          id: "o4-mini",
          name: "o4-mini",
          family: "o4",
          protocol: "openai-responses",
          api: {
            id: "o4-mini",
            url: "https://api.openai.com/v1",
            npm: "@ai-sdk/openai",
          },
          cost: {
            input: 1,
            output: 2,
            cache: {
              read: 0,
              write: 0,
            },
          },
          limit: {
            context: 200000,
            input: 100000,
            output: 8192,
          },
          capabilities: {
            temperature: false,
            reasoning: true,
            attachment: true,
            toolcall: true,
            native_web: false,
            patch_editing: true,
            input: {
              text: true,
              audio: false,
              image: true,
              video: false,
              pdf: true,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          variants: {},
          headers: {},
          options: {},
        } as never,
        {
          text: true,
          image: false,
          pdf: false,
          attachment: false,
          tool_call: false,
          reasoning: false,
          native_web: true,
          temperature: true,
        },
      ),
    ).toMatchObject({
      capabilities: {
        text: true,
        image: false,
        pdf: false,
        input: {
          text: true,
          image: false,
          pdf: false,
        },
        tool_call: false,
        reasoning: false,
        native_web: true,
        temperature: true,
        patch_editing: true,
        attachment: false,
      },
    })
  })

  test("writes detected variant options for reasoning effort support", () => {
    expect(
      buildDetectedModelPatch(
        {
          id: "gpt-5",
          name: "GPT-5",
          family: "gpt",
          protocol: "openai-responses",
          api: {
            id: "gpt-5",
            url: "https://api.openai.com/v1",
            npm: "@ai-sdk/openai",
          },
          cost: {
            input: 1,
            output: 2,
            cache: {
              read: 0,
              write: 0,
            },
          },
          limit: {
            context: 200000,
            input: 100000,
            output: 8192,
          },
          capabilities: {
            temperature: false,
            reasoning: true,
            attachment: true,
            toolcall: true,
            native_web: false,
            patch_editing: true,
            input: {
              text: true,
              audio: false,
              image: true,
              video: false,
              pdf: true,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          variants: {
            low: { reasoningEffort: "low" },
            high: { reasoningEffort: "high" },
          },
          headers: {},
          options: {},
        } as never,
        {},
        {
          variantGroup: "custom",
          variantOptions: ["low", "high"],
          variants: {
            low: { reasoningEffort: "low" },
            high: { reasoningEffort: "high" },
          },
        },
      ),
    ).toMatchObject({
      variantGroup: "custom",
      variantOptions: ["low", "high"],
      request: {
        variantGroup: "custom",
        variantOptions: ["low", "high"],
      },
      variants: {
        low: { reasoningEffort: "low" },
        high: { reasoningEffort: "high" },
      },
    })
  })
})
