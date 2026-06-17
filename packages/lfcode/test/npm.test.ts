import { describe, expect, test } from "bun:test"
import { Npm } from "../src/npm"

const win = process.platform === "win32"

describe("Npm.sanitize", () => {
  test("keeps normal scoped package specs unchanged", () => {
    expect(Npm.sanitize("@lfcode/acme")).toBe("@lfcode/acme")
    expect(Npm.sanitize("@lfcode/acme@1.0.0")).toBe("@lfcode/acme@1.0.0")
    expect(Npm.sanitize("prettier")).toBe("prettier")
  })

  test("handles git https specs", () => {
    const spec = "acme@git+https://github.com/lfcode/acme.git"
    const expected = win ? "acme@git+https_//github.com/lfcode/acme.git" : spec
    expect(Npm.sanitize(spec)).toBe(expected)
  })
})
