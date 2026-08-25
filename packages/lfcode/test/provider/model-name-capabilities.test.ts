import { expect, test } from "bun:test"
import { inferModelProfile } from "@lfcode-ai/shared/model-capabilities"
import { snapshot } from "../../src/provider/models-snapshot"
import { ProviderTransform, type Provider } from "../../src/provider"
import { resolveModelReasoningOptions } from "../../src/provider/provider"

type SnapshotCatalog = Record<string, { models?: Record<string, { id: string }> }>
const catalog = snapshot as unknown as SnapshotCatalog

test("every bundled model name resolves to a complete model-name profile", () => {
  const rows = Object.values(catalog).flatMap((provider) => Object.values(provider.models ?? {}))
  expect(rows.length).toBeGreaterThan(5_000)

  for (const model of rows) {
    const profile = inferModelProfile({ modelID: model.id })
    expect(profile.limit.context).toBeGreaterThan(0)
    expect(profile.limit.output).toBeGreaterThanOrEqual(0)
    expect(profile.modalities.input.length).toBeGreaterThan(0)
    expect(profile.modalities.output.length).toBeGreaterThan(0)
  }
})

test("OpenCode model names keep their exact multimodal and effort profiles", () => {
  const models = {
    ...catalog.opencode?.models,
    ...catalog["opencode-go"]?.models,
  }
  for (const model of Object.values(models)) {
    const profile = inferModelProfile({ modelID: model.id })
    expect(profile.limit.context).toBeGreaterThan(0)
    expect(profile.limit.output).toBeGreaterThan(0)
  }

  expect(inferModelProfile({ modelID: "mimo-v2.5" }).modalities.input).toEqual(["text", "audio", "image", "video"])
  expect(inferModelProfile({ modelID: "mimo-v2.5-pro" }).modalities.input).toEqual(["text"])
  expect(inferModelProfile({ modelID: "step-3.5-flash" }).reasoningOptions).toEqual(["low", "high"])
  expect(inferModelProfile({ modelID: "deepseek-v4-pro" }).reasoningOptions).toEqual(["high", "max"])
  expect(inferModelProfile({ modelID: "claude-opus-4-8" }).reasoningOptions).toEqual(["low", "medium", "high", "xhigh", "max"])

  const oxAlpha = inferModelProfile({ modelID: "ox-alpha-free" })
  expect(oxAlpha.capabilities.tool_call).toBe(false)
  expect(oxAlpha.limit).toEqual({ context: 1_000_000, output: 131_072 })
  expect(oxAlpha.modalities).toEqual({ input: ["text", "image", "video"], output: ["text"] })
  expect(oxAlpha.reasoningOptions).toEqual(["low", "high", "max"])

  const vision = inferModelProfile({ modelID: "deepseek-v4-flash-vision-exp", apiID: "deepseek-v4-flash-vision-exp" })
  expect(vision.capabilities.reasoning).toBe(true)
  expect(vision.reasoningModes).toEqual([
    { type: "toggle" },
    { type: "effort", values: ["low", "high", "max"] },
  ])
  expect(vision.modalities).toEqual({ input: ["text", "image"], output: ["text"] })
  expect(vision.limit).toEqual({ context: 1_000_000, output: 384_000 })
})

test("OpenCode variants use the model-specific effort list", () => {
  for (const id of ["kimi-k3", "deepseek-v4-pro", "glm-5.2", "gpt-5.6-luna"] as const) {
    const profile = inferModelProfile({ modelID: id })
    const model = {
      id,
      providerID: "opencode-go",
      api: { id, npm: "@ai-sdk/openai-compatible", url: "https://opencode.ai" },
      capabilities: {
        reasoning: profile.capabilities.reasoning,
        input: profile.capabilities.input,
        output: profile.capabilities.output,
        temperature: profile.capabilities.temperature,
        toolcall: profile.capabilities.tool_call,
        attachment: profile.capabilities.attachment,
        patch_editing: profile.capabilities.patch_editing,
        native_web: profile.capabilities.native_web,
      },
      reasoning_options: profile.reasoningModes,
    } as unknown as Provider.Model
    expect(Object.keys(ProviderTransform.variants(model))).toEqual(profile.reasoningOptions)
  }

  const mimo = inferModelProfile({ modelID: "mimo-v2.5" })
  const mimoModel = {
    id: "mimo-v2.5",
    providerID: "opencode-go",
    api: { id: "mimo-v2.5", npm: "@ai-sdk/openai-compatible", url: "https://opencode.ai" },
    capabilities: {
      reasoning: true,
      input: mimo.capabilities.input,
      output: mimo.capabilities.output,
      temperature: false,
      toolcall: true,
      attachment: true,
      patch_editing: true,
      native_web: false,
    },
    reasoning_options: mimo.reasoningModes,
  } as unknown as Provider.Model
  expect(ProviderTransform.variants(mimoModel)).toEqual({})
})

test("empty catalog reasoning options fall back to model-name options without inventing fixed modes", () => {
  expect(
    resolveModelReasoningOptions([], undefined, inferModelProfile({ modelID: "glm-5" })),
  ).toEqual([{ type: "toggle" }])
  expect(
    resolveModelReasoningOptions([], undefined, inferModelProfile({ modelID: "minimax-m2.7" })),
  ).toEqual([{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }])
  expect(resolveModelReasoningOptions([], undefined, inferModelProfile({ modelID: "mimo-v2.5" }))).toEqual([
    { type: "toggle" },
  ])
  expect(resolveModelReasoningOptions([], undefined, inferModelProfile({ modelID: "ring-2.6-1t-free" }))).toEqual([])
})

test("model-name reasoning options supersede stale existing options", () => {
  expect(
    resolveModelReasoningOptions(
      [],
      [{ type: "effort", values: ["low", "medium", "high"] }],
      inferModelProfile({ modelID: "deepseek-v4-flash-vision-exp" }),
    ),
  ).toEqual([
    { type: "toggle" },
    { type: "effort", values: ["low", "high", "max"] },
  ])
})
