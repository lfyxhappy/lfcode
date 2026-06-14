import { describe, expect, test } from "bun:test"
import path from "path"
import { resolveMimocodeHome } from "@mimo-ai/shared/global"

describe("resolveMimocodeHome", () => {
  test("with OPENCODE_* final directories set, resolves directly to those directories", () => {
    const result = resolveMimocodeHome({
      OPENCODE_CONFIG_DIR: "C:\\OpenCode\\opencode-root",
      OPENCODE_DATA_DIR: "C:\\OpenCode\\opencode-root\\data",
      OPENCODE_STATE_DIR: "C:\\OpenCode\\opencode-root\\state",
      OPENCODE_CACHE_DIR: "C:\\OpenCode\\opencode-root\\cache",
    })
    expect(result.mode).toBe("xdg")
    expect(result.root).toBeUndefined()
    expect(result.config).toBe("C:\\OpenCode\\opencode-root")
    expect(result.data).toBe("C:\\OpenCode\\opencode-root\\data")
    expect(result.state).toBe("C:\\OpenCode\\opencode-root\\state")
    expect(result.cache).toBe("C:\\OpenCode\\opencode-root\\cache")
  })

  test("with incomplete OPENCODE_* final directories, throws a clear error", () => {
    expect(() =>
      resolveMimocodeHome({
        OPENCODE_CONFIG_DIR: "C:\\OpenCode\\opencode-root",
        OPENCODE_DATA_DIR: "C:\\OpenCode\\opencode-root\\data",
      }),
    ).toThrow(/must all be set together/)
  })

  test("with MIMOCODE_HOME set, resolves 4 subdirs under root", () => {
    const result = resolveMimocodeHome({
      MIMOCODE_HOME: "/tmp/profile-a",
    })
    expect(result.mode).toBe("mimocode_home")
    expect(result.root).toBe("/tmp/profile-a")
    expect(result.config).toBe(path.join("/tmp/profile-a", "config"))
    expect(result.data).toBe(path.join("/tmp/profile-a", "data"))
    expect(result.state).toBe(path.join("/tmp/profile-a", "state"))
    expect(result.cache).toBe(path.join("/tmp/profile-a", "cache"))
  })

  test("without MIMOCODE_HOME, falls through to xdg mode", () => {
    const result = resolveMimocodeHome({})
    expect(result.mode).toBe("xdg")
    expect(result.root).toBeUndefined()
    // xdg paths end with "/mimocode"
    expect(result.config.endsWith(path.join("", "mimocode"))).toBe(true)
    expect(result.data.endsWith(path.join("", "mimocode"))).toBe(true)
    expect(result.state.endsWith(path.join("", "mimocode"))).toBe(true)
    expect(result.cache.endsWith(path.join("", "mimocode"))).toBe(true)
  })

  test("empty MIMOCODE_HOME string is treated as unset (xdg mode)", () => {
    const result = resolveMimocodeHome({ MIMOCODE_HOME: "" })
    expect(result.mode).toBe("xdg")
  })

  test("relative MIMOCODE_HOME path throws with clear error", () => {
    expect(() => resolveMimocodeHome({ MIMOCODE_HOME: "./foo" })).toThrow(
      /MIMOCODE_HOME must be an absolute path/,
    )
    expect(() => resolveMimocodeHome({ MIMOCODE_HOME: "foo/bar" })).toThrow(
      /MIMOCODE_HOME must be an absolute path/,
    )
  })

  test("tilde-prefixed MIMOCODE_HOME throws (not treated as absolute)", () => {
    expect(() => resolveMimocodeHome({ MIMOCODE_HOME: "~/profiles/a" })).toThrow(
      /MIMOCODE_HOME must be an absolute path/,
    )
  })

  test("error message includes the offending value", () => {
    expect(() => resolveMimocodeHome({ MIMOCODE_HOME: "./relative" })).toThrow(
      /\.\/relative/,
    )
  })
})
