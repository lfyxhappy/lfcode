import { describe, expect, test } from "bun:test"
import { createPromptGoalCommandRequest } from "./goal-command"

describe("prompt-input goal command helper", () => {
  test("builds the request from session, agent, model, and variant", () => {
    expect(
      createPromptGoalCommandRequest({
        sessionID: "session-1",
        arguments: "pause",
        agent: { name: "builder" },
        model: { id: "gpt-5.4", provider: { id: "openai" } },
        variant: "fast",
      }),
    ).toEqual({
      sessionID: "session-1",
      command: "goal",
      arguments: "pause",
      agent: "builder",
      model: "openai/gpt-5.4",
      variant: "fast",
    })
  })

  test("returns undefined when required fields are missing", () => {
    expect(createPromptGoalCommandRequest({ arguments: "resume" })).toBeUndefined()
    expect(
      createPromptGoalCommandRequest({
        sessionID: "session-1",
        arguments: "resume",
        agent: { name: "builder" },
        model: { id: "gpt-5.4" },
      }),
    ).toBeUndefined()
  })
})
