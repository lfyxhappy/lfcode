import { describe, expect, test } from "bun:test"
import { buildUsageFilters, buildUsageOptions, hasMoreUsageLogs, selectedUsageOption, USAGE_ALL } from "./settings-usage-helpers"

describe("settings-usage helpers", () => {
  test("builds usage filters and strips empty values", () => {
    expect(
      buildUsageFilters({
        range: "30d",
        provider: "openai",
        model: USAGE_ALL,
        project: "proj_1",
        session: USAGE_ALL,
        status: "error",
        agentKind: "subagent",
        search: "  usage  ",
      }),
    ).toEqual({
      range: "30d",
      provider: "openai",
      model: undefined,
      project: "proj_1",
      session: undefined,
      status: "error",
      agent_kind: "subagent",
      search: "usage",
      source: "lfcode",
    })
  })

  test("prepends all option and removes duplicate values", () => {
    expect(
      buildUsageOptions(
        "All providers",
        [
          { id: "openai", name: "OpenAI" },
          { id: "anthropic", name: "Anthropic" },
          { id: "openai", name: "OpenAI duplicate" },
        ],
        (item) => ({ value: item.id, label: item.name }),
      ),
    ).toEqual([
      { value: USAGE_ALL, label: "All providers" },
      { value: "openai", label: "OpenAI" },
      { value: "anthropic", label: "Anthropic" },
    ])
  })

  test("finds the selected option and falls back to the first option", () => {
    const options = [
      { value: USAGE_ALL, label: "All" },
      { value: "openai", label: "OpenAI" },
    ]
    expect(selectedUsageOption(options, "openai")).toEqual({ value: "openai", label: "OpenAI" })
    expect(selectedUsageOption(options, "missing")).toEqual({ value: USAGE_ALL, label: "All" })
  })

  test("treats only non-null cursors as load-more state", () => {
    expect(hasMoreUsageLogs(1)).toBe(true)
    expect(hasMoreUsageLogs(0)).toBe(true)
    expect(hasMoreUsageLogs(null)).toBe(false)
    expect(hasMoreUsageLogs(undefined)).toBe(false)
  })
})
