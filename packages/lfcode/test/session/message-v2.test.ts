import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { MessageV2, selectContinuationMessages } from "../../src/session/message-v2"
import { ProviderTransform } from "../../src/provider"
import type { Provider } from "../../src/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { Question } from "../../src/question"

const sessionID = SessionID.make("session")
const providerID = ProviderID.make("test")
const model: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID,
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 0,
    input: 0,
    output: 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function userInfo(id: string): MessageV2.User {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID, modelID: ModelID.make("test") },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function assistantInfo(
  id: string,
  parentID: string,
  error?: MessageV2.Assistant["error"],
  meta?: { providerID: string; modelID: string },
): MessageV2.Assistant {
  const infoModel = meta ?? { providerID: model.providerID, modelID: model.api.id }
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    error,
    parentID,
    modelID: infoModel.modelID,
    providerID: infoModel.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as unknown as MessageV2.Assistant
}

function basePart(messageID: string, id: string) {
  return {
    id: PartID.make(id),
    sessionID,
    messageID: MessageID.make(messageID),
  }
}

function userMessage(id: string, parts: MessageV2.Part[]): MessageV2.WithParts {
  return {
    info: userInfo(id),
    parts,
  }
}

function assistantMessage(id: string, parts: MessageV2.Part[]): MessageV2.WithParts {
  return {
    info: assistantInfo(id, "m-user"),
    parts,
  }
}

describe("session.message-v2.toModelMessage", () => {
  test("falls back to raw history when the latest compaction boundary has no assistant summary", () => {
    const history: MessageV2.WithParts[] = [
      userMessage("m-1", [
        {
          ...basePart("m-1", "p1"),
          type: "text",
          text: "keep this",
        },
      ]),
      userMessage("m-2", [
        {
          ...basePart("m-2", "p1"),
          type: "compaction",
          auto: true,
        },
      ]),
    ]

    expect(selectContinuationMessages(history)).toMatchObject({
      messages: history,
      source: "raw",
      fallbackReason: "compaction: missing summary assistant after compaction boundary",
      boundary: {
        messageID: "m-2",
        kind: "compaction",
        valid: false,
      },
    })
  })

  test("keeps the latest checkpoint boundary when it has rebuild text", () => {
    const history: MessageV2.WithParts[] = [
      userMessage("m-1", [
        {
          ...basePart("m-1", "p1"),
          type: "text",
          text: "older",
        },
      ]),
      userMessage("m-2", [
        {
          ...basePart("m-2", "p1"),
          type: "checkpoint",
          checkpointDir: "C:/tmp",
          checkpointNumber: 1,
          coveredUpTo: MessageID.make("m-1"),
        },
        {
          ...basePart("m-2", "p2"),
          type: "text",
          text: "## Checkpoint\nrebuild context",
          synthetic: true,
        },
      ]),
    ]

    expect(selectContinuationMessages(history).messages).toStrictEqual(history.slice(1))
  })

  test("places a compaction summary before its preserved raw tail", () => {
    const tail = userMessage("m-2", [{ ...basePart("m-2", "p1"), type: "text", text: "recent user turn" }])
    const boundary = userMessage("m-3", [
      {
        ...basePart("m-3", "p1"),
        type: "compaction",
        auto: true,
        tail_start_id: MessageID.make("m-2"),
      },
    ])
    const summary = assistantMessage("m-4", [{ ...basePart("m-4", "p1"), type: "text", text: "summary" }])
    summary.info.summary = true
    const followup = userMessage("m-5", [{ ...basePart("m-5", "p1"), type: "text", text: "continue" }])

    expect(selectContinuationMessages([userMessage("m-1", []), tail, boundary, summary, followup]).messages).toStrictEqual([
      boundary,
      summary,
      tail,
      followup,
    ])
  })

  test("rejects a preserved tail from a different actor", () => {
    const tail = userMessage("m-2", [{ ...basePart("m-2", "p1"), type: "text", text: "other actor" }])
    tail.info.agentID = "actor-a"
    const boundary = userMessage("m-3", [
      {
        ...basePart("m-3", "p1"),
        type: "compaction",
        auto: true,
        tail_start_id: MessageID.make("m-2"),
      },
    ])
    boundary.info.agentID = "actor-b"
    const summary = assistantMessage("m-4", [{ ...basePart("m-4", "p1"), type: "text", text: "summary" }])
    summary.info.summary = true

    expect(selectContinuationMessages([userMessage("m-1", []), tail, boundary, summary])).toMatchObject({
      source: "raw",
      fallbackReason: "compaction: tail belongs to another actor",
      boundary: {
        messageID: "m-3",
        kind: "compaction",
        valid: false,
      },
    })
  })

  test("rejects a preserved tail from a different session", () => {
    const tail = userMessage("m-2", [{ ...basePart("m-2", "p1"), type: "text", text: "other session" }])
    tail.info.sessionID = SessionID.make("other-session")
    const boundary = userMessage("m-3", [
      {
        ...basePart("m-3", "p1"),
        type: "compaction",
        auto: true,
        tail_start_id: MessageID.make("m-2"),
      },
    ])
    const summary = assistantMessage("m-4", [{ ...basePart("m-4", "p1"), type: "text", text: "summary" }])
    summary.info.summary = true

    expect(selectContinuationMessages([userMessage("m-1", []), tail, boundary, summary])).toMatchObject({
      source: "raw",
      fallbackReason: "compaction: tail belongs to another session",
    })
  })

  test("rejects a compaction tail that does not start at a user message", () => {
    const tail = assistantMessage("m-2", [{ ...basePart("m-2", "p1"), type: "text", text: "not a turn start" }])
    const boundary = userMessage("m-3", [
      {
        ...basePart("m-3", "p1"),
        type: "compaction",
        auto: true,
        tail_start_id: MessageID.make("m-2"),
      },
    ])
    const summary = assistantMessage("m-4", [{ ...basePart("m-4", "p1"), type: "text", text: "summary" }])
    summary.info.summary = true

    expect(selectContinuationMessages([userMessage("m-1", []), tail, boundary, summary])).toMatchObject({
      source: "raw",
      fallbackReason: "compaction: tail start is not a user message",
    })
  })

  test("rejects an absent preserved tail instead of duplicating history", () => {
    const boundary = userMessage("m-3", [
      {
        ...basePart("m-3", "p1"),
        type: "compaction",
        auto: true,
        tail_start_id: MessageID.make("m-missing"),
      },
    ])
    const summary = assistantMessage("m-4", [{ ...basePart("m-4", "p1"), type: "text", text: "summary" }])
    summary.info.summary = true
    const history = [userMessage("m-1", []), boundary, summary]

    expect(selectContinuationMessages(history)).toMatchObject({
      messages: history,
      source: "raw",
      fallbackReason: "compaction: tail start not found",
    })
  })

  test("falls back to raw history when a checkpoint boundary has no rebuild text", () => {
    const history: MessageV2.WithParts[] = [
      userMessage("m-1", [
        {
          ...basePart("m-1", "p1"),
          type: "text",
          text: "older",
        },
      ]),
      userMessage("m-2", [
        {
          ...basePart("m-2", "p1"),
          type: "checkpoint",
          checkpointDir: "C:/tmp",
          checkpointNumber: 1,
          coveredUpTo: MessageID.make("m-1"),
        },
      ]),
    ]

    expect(selectContinuationMessages(history)).toMatchObject({
      messages: history,
      source: "raw",
      fallbackReason: "checkpoint: missing checkpoint rebuild body",
      boundary: {
        messageID: "m-2",
        kind: "checkpoint",
        valid: false,
      },
    })
  })

  test("falls back to the earlier valid boundary when the latest boundary is invalid", () => {
    const history: MessageV2.WithParts[] = [
      userMessage("m-1", [
        {
          ...basePart("m-1", "p1"),
          type: "text",
          text: "older",
        },
      ]),
      userMessage("m-2", [
        {
          ...basePart("m-2", "p1"),
          type: "checkpoint",
          checkpointDir: "C:/tmp",
          checkpointNumber: 1,
          coveredUpTo: MessageID.make("m-1"),
        },
        {
          ...basePart("m-2", "p2"),
          type: "text",
          text: "## Checkpoint\nrebuild context",
          synthetic: true,
        },
      ]),
      userMessage("m-3", [
        {
          ...basePart("m-3", "p1"),
          type: "compaction",
          auto: true,
        },
      ]),
    ]

    expect(selectContinuationMessages(history)).toMatchObject({
      messages: history.slice(1),
      source: "checkpoint",
      fallbackReason: "compaction: missing summary assistant after compaction boundary",
      boundary: {
        messageID: "m-2",
        kind: "checkpoint",
        valid: true,
      },
    })
  })

  test("filters out messages with no parts", async () => {
    const input: MessageV2.WithParts[] = [
      {
        info: userInfo("m-empty"),
        parts: [],
      },
      {
        info: userInfo("m-user"),
        parts: [
          {
            ...basePart("m-user", "p1"),
            type: "text",
            text: "hello",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ])
  })

  test("filters out messages with only ignored parts", async () => {
    const messageID = "m-user"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "ignored",
            ignored: true,
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([])
  })

  test("includes synthetic text parts", async () => {
    const messageID = "m-user"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "hello",
            synthetic: true,
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo("m-assistant", messageID),
        parts: [
          {
            ...basePart("m-assistant", "a1"),
            type: "text",
            text: "assistant",
            synthetic: true,
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "assistant" }],
      },
    ])
  })

  test("converts user text/file parts and injects subtask prompt", async () => {
    const messageID = "m-user"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "hello",
          },
          {
            ...basePart(messageID, "p2"),
            type: "text",
            text: "ignored",
            ignored: true,
          },
          {
            ...basePart(messageID, "p3"),
            type: "file",
            mime: "image/png",
            filename: "img.png",
            url: "https://example.com/img.png",
          },
          {
            ...basePart(messageID, "p4"),
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "https://example.com/note.txt",
          },
          {
            ...basePart(messageID, "p5"),
            type: "file",
            mime: "application/x-directory",
            filename: "dir",
            url: "https://example.com/dir",
          },
          {
            ...basePart(messageID, "p7"),
            type: "subtask",
            prompt: "prompt",
            description: "desc",
            agent: "agent",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "img.png",
            data: "https://example.com/img.png",
          },
          { type: "text", text: "The following tool was executed by the user" },
        ],
      },
    ])
  })

  test("extracts tool-result media into a user message for openai models", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "done",
            metadata: { openai: { assistant: "meta" } },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "ok",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1 },
              attachments: [
                {
                  ...basePart(assistantID, "file-1"),
                  type: "file",
                  mime: "image/png",
                  filename: "attachment.png",
                  url: "data:image/png;base64,Zm9v",
                },
              ],
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "done", providerOptions: { openai: { assistant: "meta" } } },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: {
              type: "text",
              value: "ok",
            },
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: MessageV2.SYNTHETIC_ATTACHMENT_PROMPT },
          {
            type: "file",
            mediaType: "image/png",
            filename: "attachment.png",
            data: "data:image/png;base64,Zm9v",
          },
        ],
      },
    ])
  })

  test("preserves jpeg tool-result media for anthropic models", async () => {
    const anthropicModel: Provider.Model = {
      ...model,
      id: ModelID.make("anthropic/claude-opus-4-7"),
      providerID: ProviderID.make("anthropic"),
      api: {
        id: "claude-opus-4-7-20250805",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
      capabilities: {
        ...model.capabilities,
        attachment: true,
        input: {
          ...model.capabilities.input,
          image: true,
          pdf: true,
        },
      },
    }
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString(
      "base64",
    )
    const userID = "m-user-anthropic"
    const assistantID = "m-assistant-anthropic"
    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1-anthropic"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1-anthropic"),
            type: "tool",
            callID: "call-anthropic-1",
            tool: "read",
            state: {
              status: "completed",
              input: { filePath: "/tmp/rails-demo.png" },
              output: "Image read successfully",
              title: "Read",
              metadata: {},
              time: { start: 0, end: 1 },
              attachments: [
                {
                  ...basePart(assistantID, "file-anthropic-1"),
                  type: "file",
                  mime: "image/jpeg",
                  filename: "rails-demo.png",
                  url: `data:image/jpeg;base64,${jpeg}`,
                },
              ],
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    const result = ProviderTransform.message(await MessageV2.toModelMessages(input, anthropicModel), anthropicModel, {})
    expect(result).toHaveLength(3)
    expect(result[2].role).toBe("tool")
    expect(result[2].content[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "call-anthropic-1",
      toolName: "read",
      output: {
        type: "content",
        value: [
          { type: "text", text: "Image read successfully" },
          { type: "media", mediaType: "image/jpeg", data: jpeg },
        ],
      },
    })
  })

  test("omits provider metadata when assistant model differs", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID, undefined, { providerID: "other", modelID: "other" }),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "done",
            metadata: { openai: { assistant: "meta" } },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "ok",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1 },
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "done" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ])
  })

  test("replaces compacted tool output with placeholder", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "ls" },
              output: "this should be cleared",
              title: "Bash",
              metadata: {},
              time: { start: 0, end: 1, compacted: 1 },
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "[Old tool result content cleared]" },
          },
        ],
      },
    ])
  })

  test("omits legacy automatic recall prompts and their generated reply", async () => {
    const legacyID = "m-legacy-recall"
    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(legacyID),
        parts: [
          {
            ...basePart(legacyID, "p-legacy"),
            type: "text",
            synthetic: true,
            text: "<system-reminder>\nThis session may already have recorded state.\nBefore asking the user to repeat prior context, check the existing session/task state.\n</system-reminder>",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo("m-legacy-reply", legacyID),
        parts: [
          {
            ...basePart("m-legacy-reply", "p-legacy-reply"),
            type: "text",
            text: "I will inspect state before continuing.",
          },
        ] as MessageV2.Part[],
      },
      {
        info: userInfo("m-current"),
        parts: [
          {
            ...basePart("m-current", "p-current"),
            type: "text",
            text: "Continue the actual task.",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Continue the actual task." }],
      },
    ])
  })

  test("omits completed tool output during compaction summaries", async () => {
    const userID = "m-user-summary"
    const assistantID = "m-assistant-summary"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1-summary"),
            type: "text",
            text: "summarize this",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1-summary"),
            type: "tool",
            callID: "call-summary-1",
            tool: "read",
            state: {
              status: "completed",
              input: { path: "/tmp/huge.log" },
              output: "very large tool output that should not be sent into compaction",
              title: "Read",
              metadata: {},
              time: { start: 0, end: 1 },
              attachments: [
                {
                  ...basePart(assistantID, "file-summary-1"),
                  type: "file",
                  mime: "application/pdf",
                  filename: "debug.pdf",
                  url: "data:application/pdf;base64,Zm9v",
                },
              ],
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(
      await MessageV2.toModelMessages(input, model, {
        stripMedia: true,
        compactToolResults: true,
      }),
    ).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "summarize this" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-summary-1",
            toolName: "read",
            input: { path: "/tmp/huge.log" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-summary-1",
            toolName: "read",
            output: { type: "text", value: "[Tool result omitted during compaction]" },
          },
        ],
      },
    ])
  })

  test("expands metadata-backed selected text into user-visible model content", async () => {
    const messageID = "m-user"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(messageID),
        parts: [
          {
            ...basePart(messageID, "p1"),
            type: "text",
            text: "",
            metadata: {
              lfcodeSelectedText: [
                {
                  text: "const answer = 42",
                  messageID: "m-source",
                  selection: { startLine: 12, endLine: 12 },
                },
              ],
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "" },
          {
            type: "text",
            text: ["[User selected text]", "Source message: m-source", "Lines: 12", "Excerpt:", "const answer = 42"].join(
              "\n",
            ),
          },
        ],
      },
    ])
  })

  test("converts assistant tool error into error-text tool result", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "error",
              input: { cmd: "ls" },
              error: "nope",
              time: { start: 0, end: 1 },
              metadata: {},
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "error-text", value: "nope" },
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
    ])
  })

  test("forwards partial bash output for aborted tool calls", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"
    const output = [
      "31403",
      "12179",
      "4575",
      "",
      "<bash_metadata>",
      "User aborted the command",
      "</bash_metadata>",
    ].join("\n")

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "error",
              input: { command: "for i in {1..20}; do print -- $RANDOM; sleep 1; done" },
              error: "Tool execution aborted",
              metadata: { interrupted: true, output },
              time: { start: 0, end: 1 },
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { command: "for i in {1..20}; do print -- $RANDOM; sleep 1; done" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: output },
          },
        ],
      },
    ])
  })

  test("filters assistant messages with non-abort errors", async () => {
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(
          assistantID,
          "m-parent",
          new MessageV2.APIError({ message: "boom", isRetryable: true }).toObject() as MessageV2.APIError,
        ),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "text",
            text: "should not render",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([])
  })

  test("includes aborted assistant messages only when they have non-step-start/reasoning content", async () => {
    const assistantID1 = "m-assistant-1"
    const assistantID2 = "m-assistant-2"

    const aborted = new MessageV2.AbortedError({ message: "aborted" }).toObject() as MessageV2.Assistant["error"]

    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID1, "m-parent", aborted),
        parts: [
          {
            ...basePart(assistantID1, "a1"),
            type: "reasoning",
            text: "thinking",
            time: { start: 0 },
          },
          {
            ...basePart(assistantID1, "a2"),
            type: "text",
            text: "partial answer",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID2, "m-parent", aborted),
        parts: [
          {
            ...basePart(assistantID2, "b1"),
            type: "step-start",
          },
          {
            ...basePart(assistantID2, "b2"),
            type: "reasoning",
            text: "thinking",
            time: { start: 0 },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking", providerOptions: undefined },
          { type: "text", text: "partial answer" },
        ],
      },
    ])
  })

  test("splits assistant messages on step-start boundaries", async () => {
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-parent"),
        parts: [
          {
            ...basePart(assistantID, "p1"),
            type: "text",
            text: "first",
          },
          {
            ...basePart(assistantID, "p2"),
            type: "step-start",
          },
          {
            ...basePart(assistantID, "p3"),
            type: "text",
            text: "second",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "first" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "second" }],
      },
    ])
  })

  test("drops messages that only contain step-start parts", async () => {
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: assistantInfo(assistantID, "m-parent"),
        parts: [
          {
            ...basePart(assistantID, "p1"),
            type: "step-start",
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([])
  })

  test("converts pending/running tool calls to error results to prevent dangling tool_use", async () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-pending",
            tool: "bash",
            state: {
              status: "pending",
              input: { cmd: "ls" },
              raw: "",
            },
          },
          {
            ...basePart(assistantID, "a2"),
            type: "tool",
            callID: "call-running",
            tool: "read",
            state: {
              status: "running",
              input: { path: "/tmp" },
              time: { start: 0 },
            },
          },
        ] as MessageV2.Part[],
      },
    ]

    const result = await MessageV2.toModelMessages(input, model)

    expect(result).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-pending",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
          },
          {
            type: "tool-call",
            toolCallId: "call-running",
            toolName: "read",
            input: { path: "/tmp" },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-pending",
            toolName: "bash",
            output: { type: "error-text", value: "[Tool execution was interrupted]" },
          },
          {
            type: "tool-result",
            toolCallId: "call-running",
            toolName: "read",
            output: { type: "error-text", value: "[Tool execution was interrupted]" },
          },
        ],
      },
    ])
  })
})

describe("session.message-v2.activeContext", () => {
  test("projects only old media, reasoning, and tool output without changing stored history", () => {
    const history: MessageV2.WithParts[] = [
      userMessage("m-1", [
        {
          ...basePart("m-1", "p-file"),
          type: "file",
          mime: "image/png",
          filename: "old.png",
          url: "data:image/png;base64,old",
        },
      ] as MessageV2.Part[]),
      assistantMessage("m-2", [
        {
          ...basePart("m-2", "p-reasoning"),
          type: "reasoning",
          text: "hidden reasoning",
          time: { start: 0 },
        },
        {
          ...basePart("m-2", "p-tool"),
          type: "tool",
          callID: "call-old",
          tool: "read",
          state: {
            status: "completed",
            input: { path: "old.txt" },
            output: "full old tool output",
            title: "Read old.txt",
            metadata: {},
            time: { start: 0, end: 1 },
          },
        },
      ] as MessageV2.Part[]),
      userMessage("m-3", [{ ...basePart("m-3", "p3"), type: "text", text: "recent one" }] as MessageV2.Part[]),
      userMessage("m-4", [{ ...basePart("m-4", "p4"), type: "text", text: "current input" }] as MessageV2.Part[]),
    ]

    const projection = MessageV2.projectActiveContext(history, { tailTurns: 2 })
    const oldAttachment = projection.messages[0].parts[0]
    const oldTool = projection.messages[1].parts.find((part) => part.type === "tool")

    expect(oldAttachment).toMatchObject({ type: "text", text: "[Earlier attachment omitted: image/png (old.png)]" })
    expect(projection.messages[1].parts.some((part) => part.type === "reasoning")).toBe(false)
    expect(oldTool).toMatchObject({
      callID: "call-old",
      tool: "read",
      state: { status: "completed", input: { path: "old.txt" }, output: "[Earlier read result omitted from active context]" },
    })
    expect(projection.messages[2]).toBe(history[2])
    expect(projection.messages[3]).toBe(history[3])
    expect(history[0].parts[0]).toMatchObject({ type: "file", url: "data:image/png;base64,old" })
    expect((history[1].parts.find((part) => part.type === "tool") as MessageV2.ToolPart).state).toMatchObject({
      output: "full old tool output",
    })
    expect(projection.stats).toEqual({ media: 1, reasoning: 1, toolResults: 1 })
  })

  test("keeps the current user input intact when no historical tail is configured", () => {
    const history: MessageV2.WithParts[] = [
      userMessage("m-old", [{ ...basePart("m-old", "p-old"), type: "text", text: "old" }] as MessageV2.Part[]),
      userMessage("m-current", [
        {
          ...basePart("m-current", "p-current"),
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,current",
        },
      ] as MessageV2.Part[]),
    ]

    const projection = MessageV2.projectActiveContext(history, { tailTurns: 0 })

    expect(projection.messages[1]).toBe(history[1])
    expect(projection.messages[1].parts[0]).toMatchObject({ type: "file", url: "data:image/png;base64,current" })
  })

  test("clips oversized recent text and tool output within the tail budget", () => {
    const history: MessageV2.WithParts[] = [
      userMessage("m-old", [{ ...basePart("m-old", "p-old"), type: "text", text: "old" }] as MessageV2.Part[]),
      userMessage("m-current", [
        { ...basePart("m-current", "p-text"), type: "text", text: "x".repeat(20_000) },
        {
          ...basePart("m-current", "p-tool"),
          type: "tool",
          callID: "call-current",
          tool: "read",
          state: {
            status: "completed",
            input: { path: "large.txt" },
            output: "y".repeat(20_000),
            title: "Read large.txt",
            metadata: {},
            time: { start: 0, end: 1 },
          },
        },
      ] as MessageV2.Part[]),
    ]

    const projection = MessageV2.projectActiveContext(history, { tailTurns: 2, maxTailTokens: 2_000 })
    const current = projection.messages[1]
    expect(JSON.stringify(current.parts).length).toBeLessThan(JSON.stringify(history[1].parts).length)
    expect(current.parts.some((part) => part.type === "text" && part.text.includes("context clipped"))).toBe(true)
    expect(current.parts.some((part) => part.type === "tool" && part.state.status === "completed" && part.state.output.includes("tool result clipped"))).toBe(true)
  })

  test("does not treat an unattached ordinary assistant as a compaction summary", () => {
    const boundary = userMessage("m-boundary", [{ ...basePart("m-boundary", "p-boundary"), type: "compaction", auto: true }])
    const ordinary = assistantMessage("m-ordinary", [{ ...basePart("m-ordinary", "p-ordinary"), type: "text", text: "normal response" }])
    const followup = userMessage("m-followup", [{ ...basePart("m-followup", "p-followup"), type: "text", text: "continue" }])
    expect(selectContinuationMessages([userMessage("m-old", []), boundary, ordinary, followup]).source).toBe("raw")
  })
})

describe("session.message-v2.fromError", () => {
  test("serializes context_length_exceeded as ContextOverflowError", () => {
    const input = {
      type: "error",
      error: {
        code: "context_length_exceeded",
      },
    }
    const result = MessageV2.fromError(input, { providerID })

    expect(result).toStrictEqual({
      name: "ContextOverflowError",
      data: {
        message: "Input exceeds context window of this model",
        responseBody: JSON.stringify(input),
      },
    })
  })

  test("serializes response error codes", () => {
    const cases = [
      {
        code: "insufficient_quota",
        message: "Quota exceeded. Check your plan and billing details.",
      },
      {
        code: "usage_not_included",
        message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
      },
      {
        code: "invalid_prompt",
        message: "Invalid prompt from test",
      },
    ]

    cases.forEach((item) => {
      const input = {
        type: "error",
        error: {
          code: item.code,
          message: item.code === "invalid_prompt" ? item.message : undefined,
        },
      }
      const result = MessageV2.fromError(input, { providerID })

      expect(result).toStrictEqual({
        name: "APIError",
        data: {
          message: item.message,
          isRetryable: false,
          responseBody: JSON.stringify(input),
        },
      })
    })
  })

  test("detects context overflow from APICallError provider messages", () => {
    const cases = [
      "prompt is too long: 213462 tokens > 200000 maximum",
      "Your input exceeds the context window of this model",
      "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
      "Please reduce the length of the messages or completion",
      "400 status code (no body)",
      "413 status code (no body)",
    ]

    cases.forEach((message) => {
      const error = new APICallError({
        message,
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "content-type": "application/json" },
        isRetryable: false,
      })
      const result = MessageV2.fromError(error, { providerID })
      expect(MessageV2.ContextOverflowError.isInstance(result)).toBe(true)
    })
  })

  test("detects context overflow from context_length_exceeded code in response body", () => {
    const error = new APICallError({
      message: "Request failed",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 422,
      responseHeaders: { "content-type": "application/json" },
      responseBody: JSON.stringify({
        error: {
          message: "Some message",
          type: "invalid_request_error",
          code: "context_length_exceeded",
        },
      }),
      isRetryable: false,
    })
    const result = MessageV2.fromError(error, { providerID })
    expect(MessageV2.ContextOverflowError.isInstance(result)).toBe(true)
  })

  test("does not classify 429 no body as context overflow", () => {
    const result = MessageV2.fromError(
      new APICallError({
        message: "429 status code (no body)",
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "content-type": "application/json" },
        isRetryable: false,
      }),
      { providerID },
    )
    expect(MessageV2.ContextOverflowError.isInstance(result)).toBe(false)
    expect(MessageV2.APIError.isInstance(result)).toBe(true)
  })

  test("serializes unknown inputs", () => {
    const result = MessageV2.fromError(123, { providerID })

    expect(result).toStrictEqual({
      name: "UnknownError",
      data: {
        message: "123",
      },
    })
  })

  test("serializes tagged errors with their message", () => {
    const result = MessageV2.fromError(new Question.RejectedError(), { providerID })

    expect(result).toStrictEqual({
      name: "UnknownError",
      data: {
        message: "The user dismissed this question",
      },
    })
  })

  test("classifies ZlibError from fetch as retryable APIError", () => {
    const zlibError = new Error(
      'ZlibError fetching "https://lfcode.ai/anthropic/messages". For more information, pass `verbose: true` in the second argument to fetch()',
    )
    ;(zlibError as any).code = "ZlibError"
    ;(zlibError as any).errno = 0
    ;(zlibError as any).path = ""

    const result = MessageV2.fromError(zlibError, { providerID })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    expect((result as MessageV2.APIError).data.isRetryable).toBe(true)
    expect((result as MessageV2.APIError).data.message).toInclude("decompression")
  })

  test("classifies ZlibError as AbortedError when abort context is provided", () => {
    const zlibError = new Error(
      'ZlibError fetching "https://lfcode.ai/anthropic/messages". For more information, pass `verbose: true` in the second argument to fetch()',
    )
    ;(zlibError as any).code = "ZlibError"
    ;(zlibError as any).errno = 0

    const result = MessageV2.fromError(zlibError, { providerID, aborted: true })

    expect(result.name).toBe("MessageAbortedError")
  })
})
