import { describe, expect, test } from "bun:test"
import path from "path"
import { resolveLfcodeHome } from "@lfcode-ai/shared/global"

describe("resolveLfcodeHome", () => {
  test("with LFCODE_* final directories set, resolves directly to those directories", () => {
    const result = resolveLfcodeHome({
      LFCODE_CONFIG_DIR: "C:\\Lfcode\\lfcode-root",
      LFCODE_DATA_DIR: "C:\\Lfcode\\lfcode-root\\data",
      LFCODE_STATE_DIR: "C:\\Lfcode\\lfcode-root\\state",
      LFCODE_CACHE_DIR: "C:\\Lfcode\\lfcode-root\\cache",
    })
    expect(result.mode).toBe("xdg")
    expect(result.root).toBeUndefined()
    expect(result.config).toBe("C:\\Lfcode\\lfcode-root")
    expect(result.data).toBe("C:\\Lfcode\\lfcode-root\\data")
    expect(result.state).toBe("C:\\Lfcode\\lfcode-root\\state")
    expect(result.cache).toBe("C:\\Lfcode\\lfcode-root\\cache")
  })

  test("with incomplete LFCODE_* final directories, throws a clear error", () => {
    expect(() =>
      resolveLfcodeHome({
        LFCODE_CONFIG_DIR: "C:\\Lfcode\\lfcode-root",
        LFCODE_DATA_DIR: "C:\\Lfcode\\lfcode-root\\data",
      }),
    ).toThrow(/must all be set together/)
  })

  test("with LFCODE_HOME set, resolves 4 subdirs under root", () => {
    const result = resolveLfcodeHome({
      LFCODE_HOME: "/tmp/profile-a",
    })
    expect(result.mode).toBe("lfcode_home")
    expect(result.root).toBe("/tmp/profile-a")
    expect(result.config).toBe(path.join("/tmp/profile-a", "config"))
    expect(result.data).toBe(path.join("/tmp/profile-a", "data"))
    expect(result.state).toBe(path.join("/tmp/profile-a", "state"))
    expect(result.cache).toBe(path.join("/tmp/profile-a", "cache"))
  })

  test("without LFCODE_HOME, falls through to xdg mode", () => {
    const result = resolveLfcodeHome({})
    expect(result.mode).toBe("xdg")
    expect(result.root).toBeUndefined()
    expect(result.config.endsWith(path.join("", "lfcode"))).toBe(true)
    expect(result.data.endsWith(path.join("", "lfcode"))).toBe(true)
    expect(result.state.endsWith(path.join("", "lfcode"))).toBe(true)
    expect(result.cache.endsWith(path.join("", "lfcode"))).toBe(true)
  })

  test("empty LFCODE_HOME string is treated as unset (xdg mode)", () => {
    const result = resolveLfcodeHome({ LFCODE_HOME: "" })
    expect(result.mode).toBe("xdg")
  })

  test("relative LFCODE_HOME path throws with clear error", () => {
    expect(() => resolveLfcodeHome({ LFCODE_HOME: "./foo" })).toThrow(
      /LFCODE_HOME must be an absolute path/,
    )
    expect(() => resolveLfcodeHome({ LFCODE_HOME: "foo/bar" })).toThrow(
      /LFCODE_HOME must be an absolute path/,
    )
  })

  test("tilde-prefixed LFCODE_HOME throws (not treated as absolute)", () => {
    expect(() => resolveLfcodeHome({ LFCODE_HOME: "~/profiles/a" })).toThrow(
      /LFCODE_HOME must be an absolute path/,
    )
  })

  test("error message includes the offending value", () => {
    expect(() => resolveLfcodeHome({ LFCODE_HOME: "./relative" })).toThrow(
      /\.\/relative/,
    )
  })
})
