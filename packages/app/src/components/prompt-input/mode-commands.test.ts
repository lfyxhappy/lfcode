import { describe, expect, test } from "bun:test"
import {
  buildPromptInputCommandOptions,
  PROMPT_NORMAL_MODE_KEYBIND,
  PROMPT_SHELL_MODE_KEYBIND,
} from "./mode-commands"

describe("prompt-input mode command helpers", () => {
  test("builds prompt input command options for normal mode", () => {
    let attached = false
    let shell = false
    let normal = false
    const commands = buildPromptInputCommandOptions({
      normalMode: true,
      t: (key) => `t:${key}`,
      onAttach: () => {
        attached = true
      },
      onShellMode: () => {
        shell = true
      },
      onNormalMode: () => {
        normal = true
      },
    })

    expect(commands.map((command) => [command.id, command.keybind, command.disabled])).toEqual([
      ["file.attach", "mod+u", false],
      ["prompt.mode.shell", PROMPT_SHELL_MODE_KEYBIND, false],
      ["prompt.mode.normal", PROMPT_NORMAL_MODE_KEYBIND, true],
    ])

    commands[0]?.onSelect?.()
    commands[1]?.onSelect?.()
    commands[2]?.onSelect?.()
    expect(attached).toBe(true)
    expect(shell).toBe(true)
    expect(normal).toBe(true)
  })

  test("disables attach and shell mode while already in shell mode", () => {
    const commands = buildPromptInputCommandOptions({
      normalMode: false,
      t: (key) => key,
      onAttach: () => {},
      onShellMode: () => {},
      onNormalMode: () => {},
    })

    expect(commands.map((command) => command.disabled)).toEqual([true, true, false])
  })
})
