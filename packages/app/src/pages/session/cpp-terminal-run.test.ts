import { describe, expect, test } from "bun:test"
import { CPP_TERMINAL_TITLE, runCppFileInTerminal } from "./cpp-terminal-run"

describe("cpp terminal run helper", () => {
  test("reuses the dedicated C++ terminal slot by recreating it", async () => {
    const calls: Array<{ name: string; value?: unknown }> = []
    const result = await runCppFileInTerminal({
      sdk: {
        client: {
          cpp: {
            prepareTerminalRun: async () => ({
              data: {
                command: "& 'g++.exe' 'main.cpp' -std=c++20 -o 'main.exe'; if ($?) { & 'main.exe' }",
                cwd: "C:/repo",
                sourcePath: "C:/repo/main.cpp",
                outputPath: "C:/repo/.lfcode/build/cpp/main.exe",
                terminalTitle: CPP_TERMINAL_TITLE,
              },
            }),
          },
        },
      } as never,
      terminal: {
        all: () => [{ id: "old", title: CPP_TERMINAL_TITLE, titleNumber: 1 }],
        close: async (id: string) => {
          calls.push({ name: "close", value: id })
        },
        create: async (input: unknown) => {
          calls.push({ name: "create", value: input })
          return "new-terminal"
        },
        open: (id: string) => {
          calls.push({ name: "open", value: id })
        },
      } as never,
      openPanel: () => {
        calls.push({ name: "panel" })
      },
      path: "main.cpp",
      args: ["hello"],
    })

    expect(calls.map((item) => item.name)).toEqual(["close", "create", "panel", "open"])
    expect(calls[1]?.value).toEqual({
      args: ["-NoExit", "-Command", "& 'g++.exe' 'main.cpp' -std=c++20 -o 'main.exe'; if ($?) { & 'main.exe' }"],
      cwd: "C:/repo",
      title: CPP_TERMINAL_TITLE,
    })
    expect(result.terminalID).toBe("new-terminal")
    expect(result.outputPath).toContain(".lfcode/build/cpp")
  })
})
