import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { resolveAppControlTarget } from "./app-control-target"

describe("app control target", () => {
  test("keeps the default discovery environment unchanged", () => {
    const env = { LFCODE_STATE_DIR: "C:\\custom\\state" }
    expect(resolveAppControlTarget(["health"], env)).toEqual({ args: ["health"], env, channel: "default" })
  })

  test("uses the isolated pre-release discovery root", () => {
    expect(resolveAppControlTarget(["--pre", "health"], {})).toEqual({
      args: ["health"],
      env: { LFCODE_STATE_DIR: join(homedir(), ".lfcodepre", "state") },
      channel: "pre",
    })
  })

  test("rejects an explicit discovery file that conflicts with pre-release mode", () => {
    expect(() => resolveAppControlTarget(["--pre", "health"], { LFCODE_AUTOMATION_STATE_FILE: "C:\\custom.json" })).toThrow(
      "--pre cannot be combined",
    )
  })
})
