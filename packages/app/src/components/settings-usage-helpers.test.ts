import { describe, expect, test } from "bun:test"
import {
  buildUsageFilters,
  buildUsageHeatmap,
  buildUsageOptions,
  formatUsageDuration,
  hasMoreUsageLogs,
  selectedUsageOption,
  usageHeatmapIntensity,
  usagePollingEnabled,
  USAGE_ALL,
} from "./settings-usage-helpers"

describe("settings-usage helpers", () => {
  test("only enables usage polling while the document and desktop window are visible", () => {
    expect(usagePollingEnabled({ documentVisible: true, nativeVisible: true })).toBe(true)
    expect(usagePollingEnabled({ documentVisible: false, nativeVisible: true })).toBe(false)
    expect(usagePollingEnabled({ documentVisible: true, nativeVisible: false })).toBe(false)
  })

  test("builds usage filters and strips empty values", () => {
    expect(
      buildUsageFilters({
        range: "30d",
        heatmapGranularity: "month",
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
      heatmap_granularity: "month",
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

  test("builds a three-column by eight-row hourly heatmap for today", () => {
    const points = [
      { time: new Date(2026, 6, 20, 23).getTime(), totalTokens: 45 },
      { time: new Date(2026, 6, 19, 2).getTime(), totalTokens: 10 },
      { time: new Date(2026, 6, 20, 0).getTime(), totalTokens: 20 },
    ]
    const heatmap = buildUsageHeatmap(points, "day", new Date(2026, 6, 20, 12).getTime())

    expect(heatmap.kind).toBe("day")
    if (heatmap.kind !== "day") return
    expect(heatmap.columns).toHaveLength(5)
    expect(heatmap.columns[4]?.cells[0]).toEqual(points[2])
    expect(heatmap.columns[4]?.cells[23]).toEqual(points[0])
    expect(heatmap.columns[3]?.cells[12]).toBeUndefined()
  })

  test("builds seven columns by eight three-hour slots", () => {
    const heatmap = buildUsageHeatmap([
      { time: new Date(2026, 6, 19, 2).getTime(), totalTokens: 10 },
      { time: new Date(2026, 6, 21, 4).getTime(), totalTokens: 20 },
    ], "week", new Date(2026, 6, 21, 12).getTime())

    expect(heatmap.kind).toBe("week")
    if (heatmap.kind !== "week") return
    expect(heatmap.columns).toHaveLength(14)
    expect(heatmap.columns[11]?.cells[0]?.totalTokens).toBe(10)
    expect(heatmap.columns[13]?.cells[1]?.totalTokens).toBe(20)
  })

  test("builds month-granularity heatmaps across the latest twenty-four weeks", () => {
    const now = new Date(2026, 6, 20, 12).getTime()
    const heatmap = buildUsageHeatmap([
      { time: new Date(2026, 0, 19, 12).getTime(), totalTokens: 10 },
      { time: new Date(2026, 3, 28, 12).getTime(), totalTokens: 20 },
      { time: new Date(2026, 6, 20, 12).getTime(), totalTokens: 30 },
    ], "month", now)

    expect(heatmap.kind).toBe("month")
    if (heatmap.kind !== "month") return
    expect(heatmap.columns.length).toBe(13)
    expect(heatmap.columns.flatMap((column) => column.cells).filter((item) => item.cell).length).toBe(2)
    expect(heatmap.columns.flatMap((column) => column.cells).find((item) => item.day === new Date(2026, 6, 20).getTime())?.cell?.totalTokens).toBe(30)
  })

  test("normalizes heatmap intensity and leaves empty cells uncolored", () => {
    expect(usageHeatmapIntensity(0, 100)).toBe(0)
    expect(usageHeatmapIntensity(10, 100)).toBeCloseTo(0.316)
    expect(usageHeatmapIntensity(100, 100)).toBe(1)
  })

  test("formats usage durations in seconds, switching to minutes only above one minute", () => {
    expect(formatUsageDuration(null, "en-US")).toBe("0.00 s")
    expect(formatUsageDuration(9_480.33, "en-US")).toBe("9.48 s")
    expect(formatUsageDuration(60_000, "en-US")).toBe("60.00 s")
    expect(formatUsageDuration(60_001, "en-US")).toBe("1m 0s")
    expect(formatUsageDuration(125_000, "en-US")).toBe("2m 5s")
  })
})
