import { afterEach, test, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ModelsDev, Provider } from "../../src/provider"
import { selectLanguageModel } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Auth } from "../../src/auth"
import { VOLCENGINE_CODING_PLAN_PROVIDER_ID } from "@lfcode-ai/shared/volcengine-coding-plan"
import type { LanguageModelV3 } from "@ai-sdk/provider"

afterEach(async () => {
  await Instance.disposeAll()
})

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

async function getModel(providerID: string, modelID: string) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
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
                "claude-5-opus": {
                  name: "Claude 5 Opus",
                  protocol: "anthropic-messages",
                },
                "model-level-chat": {
                  name: "Model Level Chat",
                  protocol: "openai-chat",
                  provider: {
                    protocol: "anthropic-messages",
                    npm: "@ai-sdk/anthropic",
                  },
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
      expect(gpt.capabilities.input.audio).toBe(false)
      expect(gpt.capabilities.input.video).toBe(false)
      expect(gpt.capabilities.input.pdf).toBe(true)
      expect(gpt.capabilities.temperature).toBe(false)

      const mixedProtocol = providers[ProviderID.make("custom-openai")].models["claude-5-opus"]
      expect(mixedProtocol.protocol).toBe("anthropic-messages")
      expect(mixedProtocol.api.npm).toBe("@ai-sdk/anthropic")
      expect(mixedProtocol.capabilities.reasoning).toBe(true)

      const modelLevelProtocol = providers[ProviderID.make("custom-openai")].models["model-level-chat"]
      expect(modelLevelProtocol.protocol).toBe("openai-chat")
      expect(modelLevelProtocol.api.npm).toBe("@ai-sdk/openai-compatible")

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

test("OpenCode model-name inference wins over stale persisted capability and limits", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify({
          $schema: "https://lfcode.ai/config.json",
          provider: {
            "opencode-go": {
              name: "OpenCode Go",
              protocol: "openai-chat",
              models: {
                "mimo-v2.5": {
                  capabilities: {
                    reasoning: false,
                    temperature: true,
                    tool_call: false,
                    modalities: { input: ["text"], output: ["text"] },
                  },
                  limit: { context: 128_000, output: 16_000 },
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
      const model = (await list())[ProviderID.make("opencode-go")].models["mimo-v2.5"]
      expect(model.capabilities.reasoning).toBe(true)
      expect(model.capabilities.temperature).toBe(false)
      expect(model.capabilities.toolcall).toBe(true)
      expect(model.capabilities.input).toEqual({ text: true, audio: true, image: true, video: true, pdf: false })
      expect(model.capabilities.output).toEqual({ text: true, audio: false, image: false, video: false, pdf: false })
      expect(model.limit).toEqual({ context: 1_048_576, output: 131_072 })
      expect(Object.keys(model.variants ?? {})).toEqual([])

      const grok = (await list())[ProviderID.make("opencode-go")].models["grok-4.5"]
      expect(grok.capabilities.reasoning).toBe(true)
      expect(Object.keys(grok.variants ?? {})).toEqual(["low", "medium", "high"])
    },
  })
})

test("OpenCode Go normalizes GLM-5.3-Flash capabilities and limits", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify({
          $schema: "https://lfcode.ai/config.json",
          provider: {
            "opencode-go": {
              name: "OpenCode Go",
              protocol: "openai-chat",
              models: {
                "glm-5.3-flash": {
                  capabilities: {
                    reasoning: false,
                    temperature: false,
                    tool_call: false,
                    modalities: { input: ["text"], output: ["text"] },
                  },
                  limit: { context: 128_000, output: 16_000 },
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
      const model = (await list())[ProviderID.make("opencode-go")].models["glm-5.3-flash"]
      expect(model.capabilities.reasoning).toBe(true)
      expect(model.capabilities.temperature).toBe(true)
      expect(model.capabilities.toolcall).toBe(true)
      expect(model.capabilities.attachment).toBe(true)
      expect(model.capabilities.input).toEqual({ text: true, audio: false, image: true, video: true, pdf: true })
      expect(model.limit).toEqual({ context: 1_000_000, output: 128_000 })
      expect(Object.keys(model.variants ?? {})).toEqual(["low", "high", "max"])
    },
  })
})

test("models.dev model protocols select the matching SDK independently", () => {
  const info = Provider.fromModelsDevProvider({
    id: "mixed-wire-provider",
    name: "Mixed Wire Provider",
    env: [],
    npm: "@ai-sdk/openai-compatible",
    models: {
      responses: {
        id: "responses",
        name: "Responses",
        protocol: "openai-responses",
        release_date: "",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128_000, output: 8_192 },
      },
      chat: {
        id: "chat",
        name: "Chat",
        protocol: "openai-chat",
        release_date: "",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 128_000, output: 8_192 },
      },
    },
  })

  expect(info.models.responses.protocol).toBe("openai-responses")
  expect(info.models.responses.api.npm).toBe("@ai-sdk/openai")
  expect(info.models.chat.protocol).toBe("openai-chat")
  expect(info.models.chat.api.npm).toBe("@ai-sdk/openai-compatible")
})

test("Responses models select the Responses SDK entrypoint", () => {
  const calls: string[] = []
  const responseModel = {} as LanguageModelV3
  const model = selectLanguageModel(
    {
      chat: (id) => {
        calls.push(`chat:${id}`)
        return responseModel
      },
      responses: (id) => {
        calls.push(`responses:${id}`)
        return responseModel
      },
    },
    {
      providerID: ProviderID.make("minimax-cn-coding-plan"),
      protocol: "openai-responses",
      api: { id: "MiniMax-M3", npm: "@ai-sdk/openai", url: "https://api.minimaxi.com/v1" },
    } as never,
  )

  expect(model).toBe(responseModel)
  expect(calls).toEqual(["responses:MiniMax-M3"])
})

test("all MiniMax Token Plan models are normalized to Responses", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify({
          provider: {
            "minimax-cn-coding-plan": {
              protocol: "anthropic-messages",
              models: Object.fromEntries(
                ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed"].map(
                  (id) => [
                    id,
                    {
                      provider: {
                        api: "https://api.minimaxi.com/anthropic/v1",
                        npm: "@ai-sdk/anthropic",
                      },
                    },
                  ],
                ),
              ),
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const models = (await list())[ProviderID.make("minimax-cn-coding-plan")].models
      for (const id of ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed"]) {
        expect(models[id].protocol).toBe("openai-responses")
        expect(models[id].api.npm).toBe("@ai-sdk/openai")
        expect(models[id].api.url).toBe("https://api.minimaxi.com/v1")
      }
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

test("MiniMax Token Plan routes M3 through Responses and preserves legacy aliases", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify({
          $schema: "https://lfcode.ai/config.json",
          provider: {
            minimax: {
              options: {
                apiKey: "test-key-not-a-real-credential",
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
      const provider = providers[ProviderID.make("minimax")]
      expect(provider).toBeDefined()
      expect(provider.name).toBe("MiniMax Token Plan")

      const m3 = provider.models["MiniMax-M3"]
      expect(m3.api.url).toBe("https://api.minimaxi.com/v1")
      expect(m3.api.npm).toBe("@ai-sdk/openai")
      expect(m3.protocol).toBe("openai-responses")
      expect(m3.limit).toEqual({ context: 1_000_000, input: undefined, output: 128_000 })
      expect(m3.capabilities.reasoning).toBe(true)
      expect(m3.capabilities.toolcall).toBe(true)
      expect(m3.capabilities.input.image).toBe(true)
      expect(m3.capabilities.input.video).toBe(true)

      const m27 = provider.models["MiniMax-M2.7"]
      expect(m27.protocol).toBe("openai-responses")
      expect(m27.api.npm).toBe("@ai-sdk/openai")
      expect(m27.api.url).toBe("https://api.minimaxi.com/v1")
      expect(m27.limit.context).toBe(204_800)
      expect(m27.limit.output).toBe(131_072)
      expect(m27.capabilities.input.image).toBe(false)

      for (const [alias, canonical] of [
        ["minimax-m3", "MiniMax-M3"],
        ["MINIMAX-M2.7", "MiniMax-M2.7"],
        ["minimax-m2.7-highspeed", "MiniMax-M2.7-highspeed"],
        ["minimax-m2.5", "MiniMax-M2.5"],
      ]) {
        expect(String((await getModel("minimax", alias)).id)).toBe(canonical)
      }

      const m25 = await getModel("minimax", "MiniMax-M2.5")
      expect(m25.protocol).toBe("openai-responses")
      expect(m25.api.npm).toBe("@ai-sdk/openai")
    },
  })
})
