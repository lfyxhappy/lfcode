import { describe, expect, test } from "bun:test"
import {
  buildModelOverridePatch,
  readDetectedCapabilities,
  readDetectedVariants,
  subagentModelPatch,
  subagentModelValue,
} from "./settings-models-helpers"

describe("settings-models helpers", () => {
  test("reads configured subagent model", () => {
    expect(
      subagentModelValue(
        {
          agent: {
            general: { model: "openai/gpt-5" },
          },
        },
        "general",
      ),
    ).toBe("openai/gpt-5")
  })

  test("falls back to inherit when subagent model is missing", () => {
    expect(subagentModelValue({}, "general")).toBe("")
  })

  test("builds update patch for explicit subagent model", () => {
    expect(subagentModelPatch("general", "openai/gpt-5")).toEqual({
      agent: {
        general: {
          model: "openai/gpt-5",
        },
      },
    })
  })

  test("builds update patch that clears subagent model", () => {
    expect(subagentModelPatch("general", "")).toEqual({
      agent: {
        general: {
          model: null,
        },
      },
    })
  })

  test("builds model override patch without inventing defaults", () => {
    expect(
      buildModelOverridePatch({
        name: "Model A",
        provider: {
          api: "https://api.example.com",
        },
        limit: {
          output: 4096,
        },
      }),
    ).toEqual({
      id: undefined,
      name: "Model A",
      family: undefined,
      release_date: undefined,
      protocol: undefined,
      status: undefined,
      interleaved: undefined,
      cachePromptTTL: undefined,
      provider: {
        api: "https://api.example.com",
      },
      limit: {
        output: 4096,
      },
      cost: undefined,
      request: undefined,
      headers: undefined,
      options: undefined,
    })
  })

  test("builds model override patch with explicit context and output limits", () => {
    expect(
      buildModelOverridePatch({
        limit: {
          context: 256000,
          output: 8192,
        },
      }),
    ).toEqual({
      id: undefined,
      name: undefined,
      family: undefined,
      release_date: undefined,
      protocol: undefined,
      status: undefined,
      interleaved: undefined,
      cachePromptTTL: undefined,
      provider: undefined,
      limit: {
        context: 256000,
        output: 8192,
      },
      cost: undefined,
      request: undefined,
      headers: undefined,
      options: undefined,
    })
  })

  test("reads detected capabilities from a saved detect result", () => {
    expect(
      readDetectedCapabilities({
        detected: {
          capabilities: {
            input: {
              text: true,
              image: true,
              pdf: false,
            },
            attachment: true,
            tool_call: true,
            reasoning: true,
            patch_editing: false,
            native_web: true,
            temperature: false,
          },
        },
      }),
    ).toEqual({
      text: true,
      image: true,
      audio: false,
      video: false,
      pdf: false,
      attachment: true,
      tool_call: true,
      reasoning: true,
      patch_editing: false,
      native_web: true,
      temperature: false,
    })
  })

  test("reads detected thinking variants", () => {
    expect(
      readDetectedVariants({
        detected: {
          request: {
            variantGroup: "custom",
            variantOptions: ["low", "medium", "high"],
          },
        },
      }),
    ).toEqual({
      variantGroup: "custom",
      variantOptions: ["low", "medium", "high"],
    })
  })
})
