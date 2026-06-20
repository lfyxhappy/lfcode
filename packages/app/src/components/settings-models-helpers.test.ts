import { describe, expect, test } from "bun:test"
import { subagentModelPatch, subagentModelValue } from "./settings-models-helpers"

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
})
