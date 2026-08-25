import { describe, expect, test } from "bun:test"
import {
  ProviderProtocol,
  inferModelCapabilities,
  inferModelLimits,
  inferModelProfile,
  normalizeModelCapabilities,
  protocolPackage,
} from "@lfcode-ai/shared/model-capabilities"

describe("protocolPackage", () => {
  test("maps each provider protocol to the expected package", () => {
    expect(protocolPackage(ProviderProtocol.OpenAIChat)).toBe("@ai-sdk/openai-compatible")
    expect(protocolPackage(ProviderProtocol.OpenAIResponses)).toBe("@ai-sdk/openai")
    expect(protocolPackage(ProviderProtocol.AnthropicMessages)).toBe("@ai-sdk/anthropic")
    expect(protocolPackage(ProviderProtocol.Gemini)).toBe("@ai-sdk/google")
  })
})

describe("inferModelCapabilities", () => {
  test("uses model identity only and stays consistent across providers", () => {
    const names = ["gpt-5.6", "o3", "claude-sonnet-4", "gemini-2.5-pro", "deepseek-reasoner", "qwen3-max", "kimi-k2.5", "glm-5", "mimo-v2.5", "hy3", "ox-alpha-free"]
    for (const modelID of names) {
      expect(inferModelCapabilities({ modelID })).toEqual(
        inferModelCapabilities({ modelID, apiID: modelID }),
      )
    }
  })

  test("infers GPT-5 web capabilities", () => {
    const capabilities = inferModelCapabilities({ modelID: "gpt-5-web" })

    expect(capabilities.reasoning).toBe(true)
    expect(capabilities.tool_call).toBe(true)
    expect(capabilities.temperature).toBe(false)
    expect(capabilities.native_web).toBe(true)
    expect(capabilities.attachment).toBe(true)
    expect(capabilities.patch_editing).toBe(true)
    expect(capabilities.input.image).toBe(true)
    expect(capabilities.input.audio).toBe(false)
    expect(capabilities.input.video).toBe(false)
    expect(capabilities.input.pdf).toBe(true)
  })

  test("infers Claude Sonnet 4 capabilities", () => {
    const capabilities = inferModelCapabilities({ modelID: "claude-sonnet-4" })

    expect(capabilities.reasoning).toBe(true)
    expect(capabilities.tool_call).toBe(true)
    expect(capabilities.temperature).toBe(true)
    expect(capabilities.native_web).toBe(false)
    expect(capabilities.attachment).toBe(true)
    expect(capabilities.patch_editing).toBe(true)
    expect(capabilities.input.image).toBe(true)
    expect(capabilities.input.audio).toBe(false)
    expect(capabilities.input.video).toBe(false)
    expect(capabilities.input.pdf).toBe(true)
  })

  test("infers Gemini 2.5 Pro capabilities", () => {
    const capabilities = inferModelCapabilities({ modelID: "gemini-2.5-pro" })

    expect(capabilities.reasoning).toBe(true)
    expect(capabilities.tool_call).toBe(true)
    expect(capabilities.temperature).toBe(true)
    expect(capabilities.native_web).toBe(false)
    expect(capabilities.attachment).toBe(true)
    expect(capabilities.patch_editing).toBe(true)
    expect(capabilities.input.image).toBe(true)
    expect(capabilities.input.audio).toBe(true)
    expect(capabilities.input.video).toBe(true)
    expect(capabilities.input.pdf).toBe(true)
  })
})

describe("inferModelProfile", () => {
  test("provides limits, reasoning tiers, and modalities for OpenCode names", () => {
    for (const modelID of ["gpt-5.6-luna", "deepseek-v4-pro", "qwen3.7-max", "mimo-v2-omni", "hy3"]) {
      const profile = inferModelProfile({ modelID })
      expect(profile.limit.context).toBeGreaterThan(0)
      expect(profile.limit.output).toBeGreaterThan(0)
      expect(profile.modalities.input).toContain("text")
      expect(profile.modalities.output).toContain("text")
      expect(profile.reasoningOptions.length + profile.reasoningModes.length).toBeGreaterThan(0)
    }
    expect(inferModelLimits({ modelID: "unknown-model" })).toEqual({ context: 128_000, output: 16_000 })
  })

  test("matches multimodal inputs and exact thinking modes by model name", () => {
    const mimo = inferModelProfile({ modelID: "mimo-v2.5" })
    expect(mimo.modalities.input).toEqual(["text", "audio", "image", "video"])
    expect(mimo.reasoningOptions).toEqual([])
    expect(mimo.reasoningModes).toEqual([{ type: "toggle" }])

    const pro = inferModelProfile({ modelID: "mimo-v2.5-pro" })
    expect(pro.modalities.input).toEqual(["text"])

    expect(inferModelProfile({ modelID: "step-3.5-flash" }).reasoningOptions).toEqual(["low", "high"])
    expect(inferModelProfile({ modelID: "deepseek-v4-pro" }).reasoningOptions).toEqual(["high", "max"])
    expect(inferModelProfile({ modelID: "kimi-k3" }).reasoningOptions).toEqual(["low", "high", "max"])
    expect(inferModelProfile({ modelID: "claude-opus-4-7" }).reasoningOptions).toEqual(["low", "medium", "high", "xhigh", "max"])
  })
})

describe("normalizeModelCapabilities", () => {
  test("applies base, inferred, legacy, then explicit overrides in order", () => {
    const capabilities = normalizeModelCapabilities({
      base: {
        reasoning: false,
        tool_call: false,
        temperature: false,
        native_web: false,
        attachment: false,
        patch_editing: false,
        input: { image: false },
        output: { audio: true },
      },
      inferred: {
        reasoning: true,
        tool_call: true,
        temperature: true,
        native_web: true,
        attachment: true,
        patch_editing: true,
        input: { image: true },
        output: { audio: false },
      },
      legacy: {
        reasoning: false,
        tool_call: false,
        temperature: false,
        native_web: false,
        attachment: false,
        patch_editing: false,
        image: false,
        modalities: {
          input: ["audio"],
          output: ["text", "pdf"],
        },
      },
      explicit: {
        reasoning: true,
        tool_call: true,
        temperature: true,
        native_web: false,
        attachment: false,
        patch_editing: true,
        image: true,
        audio: true,
        modalities: {
          input: ["text", "image", "audio"],
          output: ["text"],
        },
      },
    })

    expect(capabilities.reasoning).toBe(true)
    expect(capabilities.tool_call).toBe(true)
    expect(capabilities.temperature).toBe(true)
    expect(capabilities.native_web).toBe(false)
    expect(capabilities.attachment).toBe(true)
    expect(capabilities.patch_editing).toBe(true)
    expect(capabilities.input.text).toBe(true)
    expect(capabilities.input.audio).toBe(true)
    expect(capabilities.input.image).toBe(true)
    expect(capabilities.input.video).toBe(false)
    expect(capabilities.input.pdf).toBe(false)
    expect(capabilities.output.text).toBe(true)
    expect(capabilities.output.audio).toBe(false)
    expect(capabilities.output.image).toBe(false)
    expect(capabilities.output.video).toBe(false)
    expect(capabilities.output.pdf).toBe(false)
  })
})
