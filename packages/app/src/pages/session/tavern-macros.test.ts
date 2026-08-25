import { describe, expect, test } from "bun:test"
import { applyTavernInputMacros, expandTavernMacros, runTavernSlash } from "./tavern-macros"

describe("Tavern macros", () => {
  test("expands character, user, date, time, and session variables", () => {
    const result = expandTavernMacros("{{char}} 与 {{user}} 在 {{datetime}} 遇到 {{getvar::place}}", {
      characterName: "艾达",
      userName: "林",
      variables: { place: "港口" },
      now: new Date(2026, 6, 31, 9, 5),
    })

    expect(result).toBe("艾达 与 林 在 2026-07-31 09:05 遇到 港口")
  })

  test("updates variables without evaluating arbitrary expressions", () => {
    const result = applyTavernInputMacros("{{setvar::mood::calm}} {{getvar::mood}} {{window.alert(1)}}", { variables: {} })

    expect(result.variables).toEqual({ mood: "calm" })
    expect(result.text).toBe(" calm {{window.alert(1)}}")
  })

  test("only handles the supported local slash commands", () => {
    expect(runTavernSlash("/set scene 雨夜", {})).toMatchObject({ handled: true, variables: { scene: "雨夜" } })
    expect(runTavernSlash("/unset scene", { scene: "雨夜" })).toMatchObject({ handled: true, variables: {} })
    expect(runTavernSlash("/vars", {})).toMatchObject({ handled: true, openVariables: true })
    expect(runTavernSlash("/run rm -rf /", {})).toEqual({ handled: false })
  })
})
