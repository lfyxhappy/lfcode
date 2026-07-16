import { describe, expect, test } from "bun:test"
import { isCppEditablePath, isCppRunnablePath } from "./cpp-file"

describe("cpp file helpers", () => {
  test("matches editable source and header extensions", () => {
    expect(isCppEditablePath("C:/repo/main.cpp")).toBe(true)
    expect(isCppEditablePath("C:/repo/engine.CXX")).toBe(true)
    expect(isCppEditablePath("C:/repo/include/vector.HPP")).toBe(true)
    expect(isCppEditablePath("C:/repo/readme.md")).toBe(false)
  })

  test("restricts runnable files to source extensions", () => {
    expect(isCppRunnablePath("C:/repo/main.cpp")).toBe(true)
    expect(isCppRunnablePath("C:/repo/program.C++")).toBe(true)
    expect(isCppRunnablePath("C:/repo/include/vector.hpp")).toBe(false)
    expect(isCppRunnablePath(undefined)).toBe(false)
  })
})
