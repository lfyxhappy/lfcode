import { describe, expect, test } from "bun:test"
import {
  A6API_BASE_URL,
  A6API_MODEL_PROTOCOLS,
  A6API_PROVIDER_ID,
  LFAPI_BASE_URL,
  LFAPI_MODEL_PROTOCOLS,
  LFAPI_PRESET_ID,
  LFAPI_PROVIDER_ID,
  apiKeyForPresetChange,
  CUSTOM_PROVIDER_PRESETS,
  CUSTOM_PROVIDER_PRESET_OPTIONS,
  inferCapabilities,
  isA6ApiModelID,
  isLfApiProtocol,
  mergeA6ApiModelRows,
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
  attachment: false,
  tool_call: true,
  reasoning: false,
  patch_editing: false,
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
            protocol: "openai-chat",
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
              attachment: false,
              tool_call: true,
              reasoning: false,
              patch_editing: false,
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
      attachment: false,
      native_web: true,
      reasoning: true,
      patch_editing: false,
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

  test("persists each model protocol independently of the provider default", () => {
    const result = validateCustomProvider({
      form: {
        protocol: "openai-chat",
        providerID: A6API_PROVIDER_ID,
        name: "A6API",
        baseURL: A6API_BASE_URL,
        apiKey: "secret",
        models: [
          {
            row: "m0",
            id: "gpt-5.6",
            name: "GPT-5.6",
            protocol: "openai-responses",
            capabilities: caps(),
            manual: {},
            err: {},
          },
          {
            row: "m1",
            id: "claude-5-sonnet",
            name: "Claude 5 Sonnet",
            protocol: "anthropic-messages",
            capabilities: caps({ image: true, pdf: true }),
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

    expect(result.result?.config.models["gpt-5.6"].protocol).toBe("openai-responses")
    expect(result.result?.config.models["claude-5-sonnet"].protocol).toBe("anthropic-messages")
  })

  test("rejects non-A6 protocols and non-canonical URLs for A6API", () => {
    const base = {
      providerID: A6API_PROVIDER_ID,
      name: "A6API",
      apiKey: "",
      models: [
        {
          row: "m0",
          id: "gpt-5.6",
          name: "GPT-5.6",
          protocol: "gemini" as const,
          capabilities: caps(),
          manual: {},
          err: {},
        },
      ],
      headers: [{ row: "h0", key: "", value: "", err: {} }],
      err: {},
    }
    const invalidProtocol = validateCustomProvider({
      form: { ...base, protocol: "openai-chat", baseURL: A6API_BASE_URL },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    const invalidURL = validateCustomProvider({
      form: { ...base, protocol: "openai-chat", baseURL: "https://example.com/v1", models: [{ ...base.models[0], protocol: "openai-chat" }] },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(invalidProtocol.result).toBeUndefined()
    expect(invalidProtocol.models[0].id).toBe("provider.custom.a6api.error.unsupportedProtocol")
    expect(invalidURL.result).toBeUndefined()
    expect(invalidURL.err.baseURL).toBe("provider.custom.a6api.error.baseURL")
  })

  test("keeps the A6API connection definition outside the custom preset picker", () => {
    const preset = CUSTOM_PROVIDER_PRESETS.find((item) => item.id === A6API_PROVIDER_ID)

    expect(CUSTOM_PROVIDER_PRESET_OPTIONS).not.toContain(A6API_PROVIDER_ID)
    expect(preset).toMatchObject({
      providerID: A6API_PROVIDER_ID,
      name: "A6API",
      baseURL: A6API_BASE_URL,
      models: [],
    })
    expect(A6API_MODEL_PROTOCOLS).toEqual(["openai-chat", "openai-responses", "anthropic-messages"])
  })

  test("keeps the LFAPI connection definition outside the custom preset picker", () => {
    const preset = CUSTOM_PROVIDER_PRESETS.find((item) => item.id === LFAPI_PRESET_ID)

    expect(CUSTOM_PROVIDER_PRESET_OPTIONS).not.toContain(LFAPI_PRESET_ID)
    expect(preset).toMatchObject({
      providerID: LFAPI_PROVIDER_ID,
      name: "LFAPI",
      baseURL: LFAPI_BASE_URL,
      models: [],
    })
    expect(LFAPI_MODEL_PROTOCOLS).toEqual(["openai-chat", "openai-responses"])
    expect(isLfApiProtocol("openai-chat")).toBe(true)
    expect(isLfApiProtocol("openai-responses")).toBe(true)
    expect(isLfApiProtocol("anthropic-messages")).toBe(false)
  })

  test("validates LFAPI protocol and canonical URL while accepting arbitrary model IDs", () => {
    const base = {
      providerID: LFAPI_PROVIDER_ID,
      name: "LFAPI",
      apiKey: "secret",
      models: [
        {
          row: "m0",
          id: "vendor-model",
          name: "Vendor Model",
          protocol: "anthropic-messages" as const,
          capabilities: caps(),
          manual: {},
          err: {},
        },
      ],
      headers: [{ row: "h0", key: "", value: "", err: {} }],
      err: {},
    }
    const invalidProtocol = validateCustomProvider({
      form: { ...base, protocol: "openai-chat", baseURL: LFAPI_BASE_URL },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    const invalidURL = validateCustomProvider({
      form: {
        ...base,
        protocol: "openai-chat",
        baseURL: "https://example.com/v1",
        models: [{ ...base.models[0], protocol: "openai-chat" }],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    const valid = validateCustomProvider({
      form: {
        ...base,
        protocol: "openai-responses",
        baseURL: LFAPI_BASE_URL,
        models: [{ ...base.models[0], protocol: "openai-responses" }],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(invalidProtocol.result).toBeUndefined()
    expect(invalidProtocol.models[0].id).toBe("provider.custom.lfapi.error.unsupportedProtocol")
    expect(invalidURL.result).toBeUndefined()
    expect(invalidURL.err.baseURL).toBe("provider.custom.lfapi.error.baseURL")
    expect(valid.result?.providerID).toBe(LFAPI_PROVIDER_ID)
    expect(valid.result?.config.models["vendor-model"].protocol).toBe("openai-responses")
  })

  test("clears an unsaved key when changing provider presets", () => {
    expect(
      apiKeyForPresetChange({ current: A6API_PROVIDER_ID, next: "custom", apiKey: "a6-api-key" }),
    ).toBe("")
    expect(apiKeyForPresetChange({ current: LFAPI_PRESET_ID, next: "custom", apiKey: "lfapi-key" })).toBe("")
    expect(apiKeyForPresetChange({ current: "custom", next: "custom", apiKey: "new-key" })).toBe("new-key")
  })

  test("keeps unavailable A6API selections while appending the refreshed catalog", () => {
    const current = [
      {
        row: "m0",
        id: "gpt-5.6",
        name: "My GPT",
        protocol: "openai-chat" as const,
        available: true,
        capabilities: caps({ image: false }),
        manual: { image: true as const },
        err: {},
      },
      {
        row: "m1",
        id: "deepseek-old",
        name: "DeepSeek Old",
        protocol: "openai-chat" as const,
        available: true,
        capabilities: caps(),
        manual: {},
        err: {},
      },
    ]
    const result = mergeA6ApiModelRows({
      current,
      discovered: [
        { id: "gpt-5.6", name: "GPT-5.6", protocol: "openai-responses" },
        { id: "claude-5-sonnet", name: "Claude 5 Sonnet", protocol: "anthropic-messages" },
      ],
    })

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ name: "My GPT", protocol: "openai-responses", available: true })
    expect(result[0].capabilities.image).toBe(false)
    expect(result[1]).toMatchObject({ id: "deepseek-old", available: false })
    expect(result[2]).toMatchObject({ id: "claude-5-sonnet", protocol: "anthropic-messages", available: true })
  })

  test("allows only the requested A6API model families", () => {
    expect(isA6ApiModelID("GPT-5.6-mini")).toBe(true)
    expect(isA6ApiModelID("grok-4.6-fast")).toBe(true)
    expect(isA6ApiModelID("claude-5-opus")).toBe(true)
    expect(isA6ApiModelID("deepseek-r1")).toBe(true)
    expect(isA6ApiModelID("gpt-5.5")).toBe(false)
    expect(isA6ApiModelID("claude-4-sonnet")).toBe(false)
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
          attachment: false,
          tool_call: true,
          reasoning: false,
          patch_editing: false,
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
      audio: false,
      video: false,
      pdf: true,
      reasoning: true,
      native_web: true,
      temperature: true,
    })
  })

  test("infers capabilities from OpenCode model names", () => {
    expect(
      inferCapabilities({
        providerID: "opencode-go",
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        protocol: "openai-chat",
      }),
    ).toMatchObject({
      reasoning: true,
      image: false,
      pdf: false,
      temperature: true,
      tool_call: true,
    })
  })

  test("re-infers capabilities for a model protocol change without overwriting manual values", () => {
    const current = caps({ image: false, pdf: false, temperature: false })
    const next = inferCapabilities({
      id: "claude-5-sonnet",
      name: "Claude 5 Sonnet",
      protocol: "anthropic-messages",
      current,
      manual: { image: true, temperature: true },
    })

    expect(next.image).toBe(false)
    expect(next.pdf).toBe(true)
    expect(next.temperature).toBe(false)
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
