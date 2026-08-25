import { describe, expect, test } from "bun:test"
import { parseUsage, usage } from "./minimax-usage"

describe("MiniMax usage", () => {
  test("maps the official coding plan response into actual usage windows", () => {
    expect(
      parseUsage({
        base_resp: { status_code: 0 },
        model_remains: [
          { model_name: "video", current_interval_remaining_percent: 90, end_time: 1_900_000_000_000 },
          {
            model_name: "general",
            current_interval_remaining_percent: 72,
            end_time: 1_900_000_000_000,
            current_weekly_status: 1,
            current_weekly_remaining_percent: 44,
            weekly_end_time: 1_900_100_000_000,
          },
        ],
      }),
    ).toEqual([
      { id: "video:five_hour", percent: 10, usedPercent: 10, remainingPercent: 90, resetsAt: "2030-03-17T17:46:40.000Z", status: "ok", scope: "model", modelName: "video" },
      { id: "five_hour", percent: 28, usedPercent: 28, remainingPercent: 72, resetsAt: "2030-03-17T17:46:40.000Z", status: "ok", scope: "account", modelName: "general" },
      { id: "weekly", percent: 56, usedPercent: 56, remainingPercent: 44, resetsAt: "2030-03-18T21:33:20.000Z", status: "ok", scope: "account", modelName: "general" },
    ])
  })

  test("keeps provider-returned absolute values when available", () => {
    expect(
      parseUsage({
        base_resp: { status_code: 0 },
        model_remains: [
          {
            model_name: "general",
            current_interval_remaining_percent: 25,
            current_interval_remaining: 750,
            current_interval_total: 1000,
            current_interval_usage: 250,
            end_time: 1_900_000_000_000,
          },
        ],
      }),
    ).toEqual([
      {
        id: "five_hour",
        percent: 75,
        usedPercent: 75,
        remainingPercent: 25,
        resetsAt: "2030-03-17T17:46:40.000Z",
        status: "ok",
        scope: "account",
        modelName: "general",
        remaining: 750,
        total: 1000,
        used: 250,
      },
    ])
  })

  test("does not turn an application error into quota data", async () => {
    const result = await usage({
      storedApiKey: "key",
      fetch: async () => new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: "cookie is missing" } })),
    })
    expect(result).toEqual({ ok: false, error: "invalid_response" })
  })

  test("uses the official relative reset fields and treats usage_count as remaining count", () => {
    const now = Date.now()
    const windows = parseUsage({
      base_resp: { status_code: 0 },
      model_remains: [
        {
          model_name: "general",
          current_interval_remaining_percent: 80,
          remains_time: 3600,
          current_interval_usage_count: 80,
          current_interval_total_count: 100,
          current_weekly_remaining_percent: 60,
          weekly_remains_time: 7200,
          current_weekly_usage_count: 600,
          current_weekly_total_count: 1000,
        },
      ],
    })
    expect(windows).toHaveLength(2)
    expect(windows?.[0]).toMatchObject({ remaining: 80, total: 100, used: 20, unit: "requests", percent: 20, usedPercent: 20, remainingPercent: 80, resetInSeconds: 3600 })
    expect(windows?.[1]).toMatchObject({ remaining: 600, total: 1000, used: 400, unit: "requests", percent: 40, usedPercent: 40, remainingPercent: 60, resetInSeconds: 7200 })
    expect(new Date(windows?.[0].resetsAt ?? 0).getTime()).toBeGreaterThanOrEqual(now + 3_500_000)
    expect(new Date(windows?.[1].resetsAt ?? 0).getTime()).toBeGreaterThanOrEqual(now + 7_000_000)
  })

  test("derives percentages when only absolute limits are returned", () => {
    const windows = parseUsage({
      base_resp: { status_code: 0 },
      model_remains: [
        {
          model_name: "general",
          current_interval_remaining: 300,
          current_interval_total: 1000,
          current_interval_used: 700,
          current_interval_reset_in: "1800",
        },
      ],
    })
    expect(windows?.[0]).toMatchObject({
      percent: 70,
      usedPercent: 70,
      remainingPercent: 30,
      remaining: 300,
      total: 1000,
      used: 700,
      resetInSeconds: 1800,
    })
  })

  test("normalizes reset durations returned in milliseconds", () => {
    const windows = parseUsage({
      base_resp: { status_code: 0 },
      model_remains: [
        {
          model_name: "general",
          current_interval_remaining_percent: 80,
          current_interval_reset_in: 18_000_000,
          current_weekly_remaining_percent: 60,
          current_weekly_reset_in: 135_000_000,
        },
      ],
    })
    expect(windows?.[0]?.resetInSeconds).toBe(18_000)
    expect(windows?.[1]?.resetInSeconds).toBe(135_000)
  })
})
