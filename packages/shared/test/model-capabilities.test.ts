import { describe, expect, test } from "bun:test"
import {
  ProviderProtocol,
  inferModelCapabilities,
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
  test("infers GPT-5 web capabilities", () => {
    const capabilities = inferModelCapabilities({ modelID: "gpt-5-web" })

    expect(capabilities.reasoning).toBe(true)
    expect(capabilities.tool_call).toBe(true)
    expect(capabilities.temperature).toBe(false)
    expect(capabilities.native_web).toBe(true)
    expect(capabilities.attachment).toBe(true)
    expect(capabilities.input.image).toBe(true)
    expect(capabilities.input.audio).toBe(true)
    expect(capabilities.input.video).toBe(true)
    expect(capabilities.input.pdf).toBe(true)
  })

  test("infers Claude Sonnet 4 capabilities", () => {
    const capabilities = inferModelCapabilities({ modelID: "claude-sonnet-4" })

    expect(capabilities.reasoning).toBe(true)
    expect(capabilities.tool_call).toBe(true)
    expect(capabilities.temperature).toBe(true)
    expect(capabilities.native_web).toBe(false)
    expect(capabilities.attachment).toBe(true)
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
    expect(capabilities.input.image).toBe(true)
    expect(capabilities.input.audio).toBe(true)
    expect(capabilities.input.video).toBe(true)
    expect(capabilities.input.pdf).toBe(true)
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
        input: { image: false },
        output: { audio: true },
      },
      inferred: {
        reasoning: true,
        tool_call: true,
        temperature: true,
        native_web: true,
        attachment: true,
        input: { image: true },
        output: { audio: false },
      },
      legacy: {
        reasoning: false,
        tool_call: false,
        temperature: false,
        native_web: false,
        attachment: false,
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
