import { describe, expect, test } from "bun:test"
import {
  isRealUserPart,
  repeatedToolValidationFailure,
  sameToolFailureCount,
  stableStringify,
  stepSignature,
} from "../../src/session/part-helpers"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

function textPart(text: string, options?: { synthetic?: boolean; ignored?: boolean }): MessageV2.Part {
  return {
    id: PartID.make("p"),
    sessionID: SessionID.make("s"),
    messageID: MessageID.make("m"),
    type: "text",
    text,
    synthetic: options?.synthetic,
    ignored: options?.ignored,
  }
}

function toolPart(tool: string, input: Record<string, unknown>): MessageV2.Part {
  return {
    id: PartID.make("p"),
    sessionID: SessionID.make("s"),
    messageID: MessageID.make("m"),
    type: "tool",
    callID: "c1",
    tool,
    state: {
      status: "completed",
      input,
      output: "",
      title: tool,
      metadata: {},
      time: { start: 0, end: 1 },
    },
  }
}

describe("session part helpers", () => {
  test("stableStringify sorts nested keys", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  test("stepSignature ignores non-tool parts and normalizes tool input order", () => {
    expect(
      stepSignature([
        textPart("thinking"),
        toolPart("read", { limit: 10, path: "src" }),
        toolPart("read", { path: "src", limit: 10 }),
      ]),
    ).toBe('tool:read:{"limit":10,"path":"src"}\ntool:read:{"limit":10,"path":"src"}')
    expect(stepSignature([textPart("done")])).toBeUndefined()
  })

  test("isRealUserPart filters synthetic, ignored, and empty text", () => {
    expect(isRealUserPart(textPart("hello"))).toBe(true)
    expect(isRealUserPart(textPart("   "))).toBe(false)
    expect(isRealUserPart(textPart("hello", { synthetic: true }))).toBe(false)
    expect(isRealUserPart(textPart("hello", { ignored: true }))).toBe(false)
    expect(isRealUserPart(toolPart("read", {}))).toBe(true)
  })

  test("repeatedToolValidationFailure detects three identical validation failures", () => {
    const error = "The task tool was called with invalid arguments: missing action"
    const messages = ["m1", "m2", "m3"].map((id) => ({
      info: {
        id: MessageID.make(id),
        sessionID: SessionID.make("s"),
        role: "assistant" as const,
        parentID: MessageID.make("u"),
        mode: "build",
        agent: "build",
        path: { cwd: ".", root: "." },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelID.make("grok-4.5"),
        providerID: ProviderID.make("jws"),
        time: { created: 1 },
        finish: "tool-calls" as const,
      },
      parts: [
        {
          id: PartID.make(`p-${id}`),
          sessionID: SessionID.make("s"),
          messageID: MessageID.make(id),
          type: "tool" as const,
          tool: "task",
          callID: `call-${id}`,
          state: { status: "error" as const, input: { operation: {} }, error, time: { start: 1, end: 2 } },
        },
      ],
    })) as MessageV2.WithParts[]

    expect(repeatedToolValidationFailure({ messages, threshold: 3 })).toBe(true)
    messages[2].parts[0] = toolPart("task", { operation: { action: "list" } })
    expect(repeatedToolValidationFailure({ messages, threshold: 3 })).toBe(false)
  })

  test("sameToolFailureCount aggregates the exact tool failure signature", () => {
    const error = "The task tool was called with invalid arguments: missing action"
    const messages = ["m1", "m2", "m3"].map((id) => ({
      info: {
        id: MessageID.make(id),
        sessionID: SessionID.make("s"),
        role: "assistant" as const,
        parentID: MessageID.make("u"),
        mode: "build",
        agent: "build",
        path: { cwd: ".", root: "." },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelID.make("grok-4.5"),
        providerID: ProviderID.make("jws"),
        time: { created: 1 },
        finish: "tool-calls" as const,
      },
      parts: [
        {
          id: PartID.make(`p-${id}`),
          sessionID: SessionID.make("s"),
          messageID: MessageID.make(id),
          type: "tool" as const,
          tool: "task",
          callID: `call-${id}`,
          state: { status: "error" as const, input: { operation: {} }, error, time: { start: 1, end: 2 } },
        },
      ],
    })) as MessageV2.WithParts[]

    expect(sameToolFailureCount({ messages, tool: "task", toolInput: { operation: {} }, error })).toBe(3)
    expect(sameToolFailureCount({ messages, tool: "task", toolInput: { operation: { action: "list" } }, error })).toBe(0)
  })
})
