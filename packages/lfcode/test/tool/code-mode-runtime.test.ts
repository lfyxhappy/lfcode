import { describe, expect, test } from "bun:test"
import { CodeRunFailed, runCode } from "../../src/tool/code-mode-runtime"

describe("Code Mode runtime", () => {
  test("routes SDK calls through the host and returns the program result", async () => {
    const result = await runCode({
      code: "const result = await tools.read({ path: 'README.md' }); return { result }",
      tools: ["read"],
      call: async (input) => ({ ...input, output: "ok" }),
    })
    expect(result).toEqual({ result: { tool: "read", args: { path: "README.md" }, sequence: 1, output: "ok" } })
  })

  test("rejects calls to an unavailable tool without returning partial output", async () => {
    await expect(
      runCode({
        code: "return await tools.shell({ command: 'whoami' })",
        tools: ["read"],
        call: async () => "unexpected",
      }),
    ).rejects.toBeInstanceOf(CodeRunFailed)
  })

  test("does not expose Node globals to the program", async () => {
    await expect(
      runCode({
        code: "return [typeof process, typeof require, typeof Bun]",
        tools: [],
        call: async () => "unexpected",
      }),
    ).resolves.toEqual(["undefined", "undefined", "undefined"])
  })
})
