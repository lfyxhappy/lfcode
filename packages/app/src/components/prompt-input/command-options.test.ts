import { describe, expect, test } from "bun:test"
import { promptAgentNames, promptAgentOptions, promptSlashCommands } from "./command-options"

describe("prompt-input command option helpers", () => {
  test("builds visible secondary agent options and names", () => {
    const agents = [
      { name: "primary", mode: "primary" },
      { name: "helper" },
      { name: "hidden", hidden: true },
    ]

    expect(promptAgentOptions(agents)).toEqual([{ name: "helper", display: "helper" }])
    expect(promptAgentNames(agents)).toEqual(["primary", "helper", "hidden"])
  })

  test("combines custom slash commands with visible builtin slash commands", () => {
    const commands = promptSlashCommands(
      [
        { id: "fix", title: "Fix", slash: "fix", keybind: "mod+f" },
        { id: "suggested.plan", title: "Plan", slash: "plan" },
        { id: "disabled", title: "Disabled", slash: "disabled", disabled: true },
      ],
      [{ name: "ship", description: "ship it", source: "command" }],
    )

    expect(commands).toEqual([
      {
        id: "custom.ship",
        trigger: "ship",
        title: "ship",
        description: "ship it",
        type: "custom",
        source: "command",
      },
      {
        id: "fix",
        trigger: "fix",
        title: "Fix",
        description: undefined,
        keybind: "mod+f",
        type: "builtin",
      },
    ])
  })
})
