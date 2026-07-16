import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildCppRunCommand, defaultCppOutputPath, formatCppCommand, resolveCppCommand } from "../../src/cpp/runtime"

describe("cpp runtime", () => {
  test("prefers LFCODE_CXX_PATH when provided", async () => {
    const previous = process.env.LFCODE_CXX_PATH
    const root = path.join(tmpdir(), `lfcode-cpp-test-${process.pid}-${Date.now()}`)
    const compiler = path.join(root, process.platform === "win32" ? "g++.exe" : "g++")
    mkdirSync(path.dirname(compiler), { recursive: true })
    await Bun.write(compiler, "")
    process.env.LFCODE_CXX_PATH = compiler
    try {
      expect(resolveCppCommand()).toEqual({
        command: compiler,
        args: [],
      })
    } finally {
      if (previous === undefined) delete process.env.LFCODE_CXX_PATH
      else process.env.LFCODE_CXX_PATH = previous
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("formats compiler command with args", () => {
    expect(
      formatCppCommand({
        command: "g++",
        args: ["-std=c++20", "-O2"],
      }),
    ).toBe("g++ -std=c++20 -O2")
  })

  test("build output path is rooted under .lfcode/build/cpp", () => {
    const output = defaultCppOutputPath("C:/repo", "src/main.cpp")
    expect(output).toContain(path.join(".lfcode", "build", "cpp"))
    expect(output.endsWith(process.platform === "win32" ? "main.exe" : "main")).toBe(true)
  })

  test("builds a pwsh compile and run command", () => {
    const command = buildCppRunCommand({
      compiler: {
        command: "C:/mingw64/bin/g++.exe",
        args: [],
      },
      sourcePath: "C:/repo/src/main.cpp",
      outputPath: "C:/repo/.lfcode/build/cpp/main.exe",
      args: ["hello world"],
    })
    expect(command).toContain("& 'C:/mingw64/bin/g++.exe'")
    expect(command).toContain("'C:/repo/src/main.cpp'")
    expect(command).toContain("-std=c++20")
    expect(command).toContain("'C:/repo/.lfcode/build/cpp/main.exe'")
    expect(command).toContain("if ($?)")
  })
})
