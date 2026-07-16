import { describe, test, expect } from "bun:test"
import { recallHintLines } from "../../src/session/prompt"

describe("recallHintLines", () => {
  test("json mode (no tool config): task and actor use JSON form", () => {
    const lines = recallHintLines(undefined)
    expect(lines).toContain(`- task({ operation: "list" })`)
    expect(lines).toContain(`- actor({ operation: "status", actor_id: "<id>" })`)
    expect(lines.some((l) => l.includes(`memory({ operation: "search"`))).toBe(true)
  })

  test("shell mode for task+actor: shell forms, no JSON for those tools", () => {
    const lines = recallHintLines({ invocation_style: "shell" })
    expect(lines).toContain("- task list")
    expect(lines).toContain("- actor status <actor_id>")
    expect(lines.some((l) => l.includes(`task({ operation`))).toBe(false)
    expect(lines.some((l) => l.includes(`actor({ operation`))).toBe(false)
    expect(lines.some((l) => l.includes(`memory({ operation: "search"`))).toBe(true)
  })

  test("per-tool: task shell, actor json", () => {
    const lines = recallHintLines({ invocation_style_by_tool: { task: "shell" } })
    expect(lines).toContain("- task list")
    expect(lines).toContain(`- actor({ operation: "status", actor_id: "<id>" })`)
  })

  // Guards the positional contract the reminder block relies on: hints[0]=task,
  // hints[1]=actor, hints[2]=memory. A future edit that reorders the returned array
  // would silently swap which hint lands in which reminder slot — this catches it.
  test("returned order is [task, actor, memory]", () => {
    const lines = recallHintLines({ invocation_style: "shell" })
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe("- task list")
    expect(lines[1]).toBe("- actor status <actor_id>")
    expect(lines[2]).toContain("memory(")
  })
})
