import { test, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { ProviderID } from "../../src/provider/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Auth } from "../../src/auth"
import { VOLCENGINE_CODING_PLAN_PROVIDER_ID } from "@lfcode-ai/shared/volcengine-coding-plan"

async function list() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.list()
    }),
  )
}

async function setAuth(providerID: string, key: string) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set(providerID, {
        type: "api",
        key,
      })
    }),
  )
}

test("custom provider protocols and capabilities are normalized", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify({
          $schema: "https://lfcode.ai/config.json",
          provider: {
            "custom-openai": {
              name: "Custom OpenAI",
              protocol: "openai-responses",
              api: "https://api.custom.com/v1",
              models: {
                "gpt-5-web": {
                  name: "GPT 5 Web",
                },
                "gpt-5-manual": {
                  name: "GPT 5 Manual",
                  capabilities: {
                    image: false,
                    audio: false,
                    video: false,
                    pdf: false,
                    reasoning: false,
                    native_web: false,
                    temperature: true,
                  },
                },
                "legacy-vision": {
                  name: "Legacy Vision",
                  modalities: {
                    input: ["text", "image"],
                    output: ["text"],
                  },
                  tool_call: false,
                },
              },
              options: {
                apiKey: "custom-key",
              },
            },
            "custom-claude": {
              name: "Custom Claude",
              protocol: "anthropic-messages",
              api: "https://api.anthropic-custom.com/v1",
              models: {
                "claude-sonnet-4": {
                  name: "Claude Sonnet 4",
                },
              },
              options: {
                apiKey: "custom-key",
              },
            },
            "custom-gemini": {
              name: "Custom Gemini",
              protocol: "gemini",
              api: "https://generativelanguage.googleapis.com/v1beta",
              models: {
                "gemini-2.5-pro": {
                  name: "Gemini 2.5 Pro",
                },
              },
              options: {
                apiKey: "custom-key",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await list()
      const gpt = providers[ProviderID.make("custom-openai")].models["gpt-5-web"]
      expect(gpt.protocol).toBe("openai-responses")
      expect(gpt.api.npm).toBe("@ai-sdk/openai")
      expect(gpt.capabilities.reasoning).toBe(true)
      expect(gpt.capabilities.native_web).toBe(true)
      expect(gpt.capabilities.input.image).toBe(true)
      expect(gpt.capabilities.input.audio).toBe(true)
      expect(gpt.capabilities.input.video).toBe(true)
      expect(gpt.capabilities.input.pdf).toBe(true)
      expect(gpt.capabilities.temperature).toBe(false)

      const manual = providers[ProviderID.make("custom-openai")].models["gpt-5-manual"]
      expect(manual.capabilities.reasoning).toBe(false)
      expect(manual.capabilities.native_web).toBe(false)
      expect(manual.capabilities.input.image).toBe(false)
      expect(manual.capabilities.input.audio).toBe(false)
      expect(manual.capabilities.input.video).toBe(false)
      expect(manual.capabilities.input.pdf).toBe(false)
      expect(manual.capabilities.temperature).toBe(true)

      const legacy = providers[ProviderID.make("custom-openai")].models["legacy-vision"]
      expect(legacy.capabilities.toolcall).toBe(false)
      expect(legacy.capabilities.input.image).toBe(true)
      expect(legacy.capabilities.input.audio).toBe(false)

      const claude = providers[ProviderID.make("custom-claude")].models["claude-sonnet-4"]
      expect(claude.protocol).toBe("anthropic-messages")
      expect(claude.api.npm).toBe("@ai-sdk/anthropic")
      expect(claude.capabilities.reasoning).toBe(true)
      expect(claude.capabilities.input.image).toBe(true)
      expect(claude.capabilities.input.pdf).toBe(true)

      const gemini = providers[ProviderID.make("custom-gemini")].models["gemini-2.5-pro"]
      expect(gemini.protocol).toBe("gemini")
      expect(gemini.api.npm).toBe("@ai-sdk/google")
      expect(gemini.capabilities.reasoning).toBe(true)
      expect(gemini.capabilities.input.image).toBe(true)
      expect(gemini.capabilities.input.audio).toBe(true)
      expect(gemini.capabilities.input.video).toBe(true)
      expect(gemini.capabilities.input.pdf).toBe(true)
    },
  })
})

test("volcengine Coding Plan custom provider keeps configured limits and capabilities", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify({
          $schema: "https://lfcode.ai/config.json",
          provider: {
            "volcengine-plan": {
              name: "Volcano Engine Coding Plan",
              protocol: "openai-chat",
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
                apiKey: "custom-key",
              },
              models: {
                "ark-code-latest": {
                  name: "ark-code-latest",
                  limit: {
                    context: 256000,
                    output: 4096,
                  },
                  capabilities: {
                    image: true,
                    audio: false,
                    video: false,
                    pdf: false,
                    tool_call: true,
                    reasoning: false,
                    native_web: false,
                    temperature: true,
                  },
                },
                "glm-5.2": {
                  name: "glm-5.2",
                  limit: {
                    context: 1024000,
                    output: 4096,
                  },
                  capabilities: {
                    image: false,
                    audio: false,
                    video: false,
                    pdf: false,
                    tool_call: true,
                    reasoning: false,
                    native_web: false,
                    temperature: true,
                  },
                },
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await list()
      const ark = providers[ProviderID.make("volcengine-plan")].models["ark-code-latest"]
      expect(ark.api.npm).toBe("@ai-sdk/openai-compatible")
      expect(ark.protocol).toBe("openai-chat")
      expect(ark.limit.context).toBe(256000)
      expect(ark.limit.output).toBe(4096)
      expect(ark.capabilities.input.image).toBe(true)
      expect(ark.capabilities.input.audio).toBe(false)
      expect(ark.capabilities.native_web).toBe(false)

      const glm = providers[ProviderID.make("volcengine-plan")].models["glm-5.2"]
      expect(glm.limit.context).toBe(1024000)
      expect(glm.capabilities.input.image).toBe(false)
    },
  })
})

test("volcengine Coding Plan is available as a built-in API-key provider", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify({
          $schema: "https://lfcode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await setAuth(VOLCENGINE_CODING_PLAN_PROVIDER_ID, "test-key")

      const providers = await list()
      const provider = providers[ProviderID.make(VOLCENGINE_CODING_PLAN_PROVIDER_ID)]
      expect(provider).toBeDefined()
      expect(provider.source).toBe("api")
      expect(provider.name).toBe("Volcano Engine Coding Plan")
      expect(provider.key).toBe("test-key")
      expect(provider.options.baseURL).toBeUndefined()

      const ark = provider.models["ark-code-latest"]
      expect(ark.api.url).toBe("https://ark.cn-beijing.volces.com/api/coding/v3")
      expect(ark.api.npm).toBe("@ai-sdk/openai-compatible")
      expect(ark.protocol).toBe("openai-chat")
      expect(ark.limit.context).toBe(256000)
      expect(ark.limit.output).toBe(4096)
      expect(ark.capabilities.input.image).toBe(true)
      expect(ark.capabilities.toolcall).toBe(true)

      const glm = provider.models["glm-5.2"]
      expect(glm.limit.context).toBe(1024000)
      expect(glm.capabilities.input.image).toBe(false)
    },
  })
})
