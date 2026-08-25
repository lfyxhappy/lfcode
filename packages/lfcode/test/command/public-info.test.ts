import { describe, expect, test } from "bun:test"
import { Command } from "../../src/command"

describe("command public metadata", () => {
  test("never serializes a command template", () => {
    const metadata = Command.publicInfo({
      name: "private-skill",
      description: "Internal workflow",
      source: "skill",
      template: "# Private Skill\nDo not disclose this body.",
      hints: [],
    })

    expect(metadata).toEqual({
      name: "private-skill",
      description: "Internal workflow",
      source: "skill",
      hints: [],
    })
    expect(JSON.stringify(metadata)).not.toContain("Do not disclose")
    expect("template" in metadata).toBe(false)
  })

  test("does not disclose slash-Skill names in an unknown-command hint", () => {
    const names = Command.unknownCommandHints([
      {
        name: "review",
        source: "command",
        template: "Review the workspace.",
        hints: [],
      },
      {
        name: "private-skill",
        description: "A Skill that this session may be denied.",
        source: "skill",
        template: "# Private body",
        hints: [],
      },
      {
        name: "external-prompt",
        source: "mcp",
        template: "Prompt body",
        hints: [],
      },
    ])

    expect(names).toEqual(["review", "external-prompt"])
    expect(names).not.toContain("private-skill")
  })

  test("does not disclose Skill metadata through the global command list", () => {
    const commands = Command.publicList([
      {
        name: "review",
        source: "command",
        template: "Review the workspace.",
        hints: [],
      },
      {
        name: "private-skill",
        description: "A Skill denied by the active session.",
        source: "skill",
        template: "# Private body",
        hints: [],
      },
      {
        name: "external-prompt",
        source: "mcp",
        template: "Prompt body",
        hints: [],
      },
    ])

    expect(commands.map((command) => command.name)).toEqual(["review", "external-prompt"])
    expect(commands.find((command) => command.name === "private-skill")).toBeUndefined()
  })
})
