import { describe, expect, test } from "bun:test"
import {
  CUSTOM_PROVIDER_PRESETS,
  CUSTOM_PROVIDER_PRESET_OPTIONS,
  inferCapabilities,
  presetModelRow,
  type ModelCapabilities,
  validateCustomProvider,
} from "./dialog-custom-provider-form"

const t = (key: string) => key
const caps = (input: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
  text: true,
  image: false,
  audio: false,
  video: false,
  pdf: false,
  tool_call: true,
  reasoning: false,
  native_web: false,
  temperature: true,
  ...input,
})

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        protocol: "openai-chat",
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [
          {
            row: "m0",
            id: " model-a ",
            name: " Model A ",
            limit: { context: "128000", output: "4096" },
            capabilities: caps({ image: true, native_web: true }),
            manual: {},
            err: {},
          },
        ],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        protocol: "openai-chat",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": {
            name: "Model A",
            limit: {
              context: 128000,
              output: 4096,
            },
            capabilities: {
              text: true,
              image: true,
              audio: false,
              video: false,
              pdf: false,
              tool_call: true,
              reasoning: false,
              native_web: true,
              temperature: true,
            },
          },
        },
      },
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        protocol: "openai-responses",
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          {
            row: "m0",
            id: "model-a",
            name: "Model A",
            capabilities: caps({ reasoning: true, temperature: false }),
            manual: {},
            err: {},
          },
          {
            row: "m1",
            id: "model-a",
            name: "Model A 2",
            capabilities: caps({ temperature: false }),
            manual: {},
            err: {},
          },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
      context: undefined,
      output: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
    expect(result.result).toBeUndefined()
  })

  test("infers capabilities from model identity but keeps manual overrides", () => {
    const result = validateCustomProvider({
      form: {
        protocol: "openai-chat",
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          {
            row: "m0",
            id: "gpt-5-web",
            name: "GPT-5 Web",
            capabilities: caps({ reasoning: true, native_web: true, temperature: false }),
            manual: {},
            err: {},
          },
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.protocol).toBe("openai-chat")
    expect(result.result?.config.models["gpt-5-web"].capabilities).toEqual({
      text: true,
      image: false,
      audio: false,
      video: false,
      pdf: false,
      native_web: true,
      reasoning: true,
      tool_call: true,
      temperature: false,
    })
  })

  test("maps protocol presets to provider packages", () => {
    const base = {
      providerID: "custom-provider",
      name: "Provider",
      baseURL: "https://api.example.com",
      apiKey: "",
      models: [
        {
          row: "m0",
          id: "claude-sonnet-4",
          name: "Claude Sonnet 4",
          capabilities: caps({ image: true, pdf: true, reasoning: true }),
          manual: {},
          err: {},
        },
      ],
      headers: [{ row: "h0", key: "", value: "", err: {} }],
      err: {},
    }

    expect(
      validateCustomProvider({
        form: { ...base, protocol: "openai-responses" },
        t,
        disabledProviders: [],
        existingProviderIDs: new Set(),
      }).result?.config.npm,
    ).toBe("@ai-sdk/openai")
    expect(
      validateCustomProvider({
        form: { ...base, protocol: "anthropic-messages" },
        t,
        disabledProviders: [],
        existingProviderIDs: new Set(),
      }).result?.config.npm,
    ).toBe("@ai-sdk/anthropic")
    expect(
      validateCustomProvider({
        form: { ...base, protocol: "gemini" },
        t,
        disabledProviders: [],
        existingProviderIDs: new Set(),
      }).result?.config.npm,
    ).toBe("@ai-sdk/google")
  })

  test("capability inference fills recommendations and keeps manual overrides", () => {
    expect(
      inferCapabilities({
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        protocol: "gemini",
      }),
    ).toMatchObject({
      image: true,
      audio: true,
      video: true,
      pdf: true,
      reasoning: true,
      tool_call: true,
    })

    expect(
      inferCapabilities({
        id: "gpt-5-web",
        name: "GPT-5 Web",
        protocol: "openai-chat",
        current: {
          text: true,
          image: false,
          audio: false,
          video: false,
          pdf: false,
          tool_call: true,
          reasoning: false,
          native_web: false,
          temperature: true,
        },
        manual: {
          image: true,
          temperature: true,
        },
      }),
    ).toMatchObject({
      image: false,
      audio: true,
      video: true,
      pdf: true,
      reasoning: true,
      native_web: true,
      temperature: true,
    })
  })

  test("serializes the Volcengine Coding Plan preset models with limits and capabilities", () => {
    const preset = CUSTOM_PROVIDER_PRESETS.find((item) => item.id === "volcengine-coding-plan")!
    expect(CUSTOM_PROVIDER_PRESET_OPTIONS).toEqual(["custom"])

    const result = validateCustomProvider({
      form: {
        preset: preset.id,
        protocol: preset.protocol,
        providerID: preset.providerID,
        name: preset.name,
        baseURL: preset.baseURL,
        apiKey: "{env: ARK_API_KEY}",
        models: preset.models.map((model) => presetModelRow(model)),
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.providerID).toBe("volcengine-plan")
    expect(result.result?.config.options.baseURL).toBe("https://ark.cn-beijing.volces.com/api/coding/v3")
    expect(Object.keys(result.result?.config.models ?? {})).toHaveLength(14)
    expect(result.result?.config.models["glm-5.2"]).toMatchObject({
      name: "glm-5.2",
      limit: {
        context: 1024000,
        output: 4096,
      },
      capabilities: {
        image: false,
      },
    })
    expect(result.result?.config.models["minimax-m3"]).toMatchObject({
      limit: {
        context: 512000,
        output: 4096,
      },
      capabilities: {
        image: true,
      },
    })
  })

  test("validates model limit fields as positive integers", () => {
    const result = validateCustomProvider({
      form: {
        protocol: "openai-chat",
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          {
            row: "m0",
            id: "model-a",
            name: "Model A",
            limit: { context: "0", output: "4096" },
            capabilities: caps(),
            manual: {},
            err: {},
          },
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toBeUndefined()
    expect(result.models[0].context).toBe("provider.custom.error.positiveInteger")
  })
})
