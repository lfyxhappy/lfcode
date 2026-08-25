import { expect, test } from "bun:test"
import { codegraphFallbackReminder } from "../../src/session/prompt"

test("CodeGraph fallback reminder is bounded and directs the model to normal tools", () => {
  const reminder = codegraphFallbackReminder(`runtime failed\n${"x".repeat(400)}`)

  expect(reminder).toContain("codegraph_explore is intentionally hidden")
  expect(reminder).toContain("Do not retry codegraph_explore")
  expect(reminder).toContain("Read, Grep, Glob")
  expect(reminder).not.toContain("\nxxx")
  expect(reminder.length).toBeLessThan(600)
})
