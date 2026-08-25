import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID, PartID } from "./schema"
import z from "zod"
import { NamedError } from "@lfcode-ai/shared/util/error"
import { APICallError, convertToModelMessages, LoadAPIKeyError, RetryError, type ModelMessage, type UIMessage } from "ai"
import { LSP } from "../lsp"
import { SyncEvent } from "../sync"
import { Database, NotFoundError, and, asc, desc, eq, gt, gte, inArray, like, lt, lte, not, or, sql } from "@/storage"
import { Vcs } from "../project"
import { MessageTable, PartTable, SessionTable } from "./session.sql"
import { ProviderError } from "@/provider"
import { iife } from "@/util/iife"
import { errorMessage } from "@/util/error"
import { isMedia } from "@/util/media"
import { Log, Token } from "@/util"
import type { SystemError } from "bun"
import type { Provider } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect } from "effect"
import { EffectLogger } from "@/effect"
import { hydrateStoredPart } from "./part-blob"
import { Snapshot as ResearchDispatchSnapshot } from "@/research/dispatch"
import { isUserHiddenSystemActorID } from "@/actor/visibility"

/** Error shape thrown by Bun's fetch() when gzip/br decompression fails mid-stream */
interface FetchDecompressionError extends Error {
  code: "ZlibError"
  errno: number
  path: string
}

export const SYNTHETIC_ATTACHMENT_PROMPT = "Attached image(s) from tool result:"
export { isMedia }
const log = Log.create({ service: "session.message-v2" })

export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
export const AbortedError = NamedError.create("MessageAbortedError", z.object({ message: z.string() }))
export const StructuredOutputError = NamedError.create(
  "StructuredOutputError",
  z.object({
    message: z.string(),
    retries: z.number(),
  }),
)
export const AuthError = NamedError.create(
  "ProviderAuthError",
  z.object({
    providerID: z.string(),
    message: z.string(),
  }),
)
export const APIError = NamedError.create(
  "APIError",
  z.object({
    message: z.string(),
    statusCode: z.number().optional(),
    isRetryable: z.boolean(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    responseBody: z.string().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  }),
)
export type APIError = z.infer<typeof APIError.Schema>
export const ContextOverflowError = NamedError.create(
  "ContextOverflowError",
  z.object({ message: z.string(), responseBody: z.string().optional() }),
)
export const InvalidOutputError = NamedError.create("InvalidOutputError", z.object({ message: z.string() }))
export const ContentFilterError = NamedError.create("ContentFilterError", z.object({ message: z.string() }))
export const ModelError = NamedError.create("ModelError", z.object({ message: z.string() }))

export const OutputFormatText = z
  .object({
    type: z.literal("text"),
  })
  .meta({
    ref: "OutputFormatText",
  })

export const OutputFormatJsonSchema = z
  .object({
    type: z.literal("json_schema"),
    schema: z.record(z.string(), z.any()).meta({ ref: "JSONSchema" }),
    retryCount: z.number().int().min(0).default(2),
  })
  .meta({
    ref: "OutputFormatJsonSchema",
  })

export const Format = z.discriminatedUnion("type", [OutputFormatText, OutputFormatJsonSchema]).meta({
  ref: "OutputFormat",
})
export type OutputFormat = z.infer<typeof Format>

const PartBase = z.object({
  id: PartID.zod,
  sessionID: SessionID.zod,
  messageID: MessageID.zod,
})

export const SnapshotPart = PartBase.extend({
  type: z.literal("snapshot"),
  snapshot: z.string(),
}).meta({
  ref: "SnapshotPart",
})
export type SnapshotPart = z.infer<typeof SnapshotPart>

export const PatchPart = PartBase.extend({
  type: z.literal("patch"),
  hash: z.string(),
  files: z.string().array(),
}).meta({
  ref: "PatchPart",
})
export type PatchPart = z.infer<typeof PatchPart>

export const TextPart = PartBase.extend({
  type: z.literal("text"),
  text: z.string(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
  time: z
    .object({
      start: z.number(),
      end: z.number().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.any()).optional(),
}).meta({
  ref: "TextPart",
})
export type TextPart = z.infer<typeof TextPart>

export const ReasoningPart = PartBase.extend({
  type: z.literal("reasoning"),
  text: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    start: z.number(),
    end: z.number().optional(),
  }),
}).meta({
  ref: "ReasoningPart",
})
export type ReasoningPart = z.infer<typeof ReasoningPart>

const FilePartSourceBase = z.object({
  text: z
    .object({
      value: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    })
    .meta({
      ref: "FilePartSourceText",
    }),
})

export const FileSource = FilePartSourceBase.extend({
  type: z.literal("file"),
  path: z.string(),
}).meta({
  ref: "FileSource",
})

export const SymbolSource = FilePartSourceBase.extend({
  type: z.literal("symbol"),
  path: z.string(),
  range: LSP.Range,
  name: z.string(),
  kind: z.number().int(),
}).meta({
  ref: "SymbolSource",
})

export const ResourceSource = FilePartSourceBase.extend({
  type: z.literal("resource"),
  clientName: z.string(),
  uri: z.string(),
}).meta({
  ref: "ResourceSource",
})

export const FilePartSource = z.discriminatedUnion("type", [FileSource, SymbolSource, ResourceSource]).meta({
  ref: "FilePartSource",
})

export const FilePart = PartBase.extend({
  type: z.literal("file"),
  mime: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  blob: z
    .object({
      mode: z.literal("blob"),
      sha256: z.string(),
      bytes: z.number().int().nonnegative(),
      path: z.string(),
      mime: z.string(),
    })
    .optional(),
  source: FilePartSource.optional(),
}).meta({
  ref: "FilePart",
})
export type FilePart = z.infer<typeof FilePart>

export const AgentPart = PartBase.extend({
  type: z.literal("agent"),
  name: z.string(),
  source: z
    .object({
      value: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    })
    .optional(),
}).meta({
  ref: "AgentPart",
})
export type AgentPart = z.infer<typeof AgentPart>

export const CheckpointPart = PartBase.extend({
  type: z.literal("checkpoint"),
  checkpointDir: z.string(),
  checkpointNumber: z.number(),
  coveredUpTo: MessageID.zod,
}).meta({
  ref: "CheckpointPart",
})
export type CheckpointPart = z.infer<typeof CheckpointPart>

export const SubtaskPart = PartBase.extend({
  type: z.literal("subtask"),
  prompt: z.string(),
  description: z.string(),
  agent: z.string(),
  execution: z.enum(["wait", "background"]).default("wait"),
  context: z.enum(["none", "state", "full"]).default("state"),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  contextRefs: z.array(z.string().min(1).max(4096)).max(128).default([]),
  declaredFiles: z.array(z.string().min(1).max(4096)).max(128).default([]),
  command: z.string().optional(),
  research: ResearchDispatchSnapshot.optional(),
}).meta({
  ref: "SubtaskPart",
})
export type SubtaskPart = z.infer<typeof SubtaskPart>

export const CompactionPart = PartBase.extend({
  type: z.literal("compaction"),
  auto: z.boolean(),
  overflow: z.boolean().optional(),
  // ID of the user message marking the start of the preserved-tail (verbatim
  // recent-turns kept after summarization). Optional: when undefined, no tail
  // was preserved (entire history was summarized).
  tail_start_id: MessageID.zod.optional(),
}).meta({
  ref: "CompactionPart",
})
export type CompactionPart = z.infer<typeof CompactionPart>

export const RetryPart = PartBase.extend({
  type: z.literal("retry"),
  attempt: z.number(),
  error: APIError.Schema,
  time: z.object({
    created: z.number(),
  }),
}).meta({
  ref: "RetryPart",
})
export type RetryPart = z.infer<typeof RetryPart>

export const StepStartPart = PartBase.extend({
  type: z.literal("step-start"),
  snapshot: z.string().optional(),
}).meta({
  ref: "StepStartPart",
})
export type StepStartPart = z.infer<typeof StepStartPart>

const MessageTokens = z.object({
  total: z.number().optional(),
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  cache: z.object({
    read: z.number(),
    write: z.number(),
  }),
})

export const StepFinishPart = PartBase.extend({
  type: z.literal("step-finish"),
  reason: z.string(),
  snapshot: z.string().optional(),
  status: z.enum(["completed", "error", "aborted"]).optional(),
  time: z
    .object({
      start: z.number(),
      end: z.number(),
      ttft: z.number().nullable(),
      submit_to_first_delta: z.number().nullable().optional(),
      pre_stream: z.number().nullable().optional(),
    })
    .optional(),
  cost: z.number(),
  tokens: MessageTokens,
  overhead: z
    .object({
      cost: z.number(),
      tokens: MessageTokens,
    })
    .optional(),
}).meta({
  ref: "StepFinishPart",
})
export type StepFinishPart = z.infer<typeof StepFinishPart>

export const ToolStatePending = z
  .object({
    status: z.literal("pending"),
    input: z.record(z.string(), z.any()),
    raw: z.string(),
  })
  .meta({
    ref: "ToolStatePending",
  })

export type ToolStatePending = z.infer<typeof ToolStatePending>

export const ToolStateRunning = z
  .object({
    status: z.literal("running"),
    input: z.record(z.string(), z.any()),
    title: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
    }),
  })
  .meta({
    ref: "ToolStateRunning",
  })
export type ToolStateRunning = z.infer<typeof ToolStateRunning>

export const ToolStateCompleted = z
  .object({
    status: z.literal("completed"),
    input: z.record(z.string(), z.any()),
    output: z.string(),
    title: z.string(),
    metadata: z.record(z.string(), z.any()),
    time: z.object({
      start: z.number(),
      end: z.number(),
      compacted: z.number().optional(),
    }),
    attachments: FilePart.array().optional(),
  })
  .meta({
    ref: "ToolStateCompleted",
  })
export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>

export const ToolStateError = z
  .object({
    status: z.literal("error"),
    input: z.record(z.string(), z.any()),
    error: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number(),
    }),
  })
  .meta({
    ref: "ToolStateError",
  })
export type ToolStateError = z.infer<typeof ToolStateError>

export const ToolState = z
  .discriminatedUnion("status", [ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
  .meta({
    ref: "ToolState",
  })

export const ToolPart = PartBase.extend({
  type: z.literal("tool"),
  callID: z.string(),
  tool: z.string(),
  state: ToolState,
  metadata: z.record(z.string(), z.any()).optional(),
}).meta({
  ref: "ToolPart",
})
export type ToolPart = z.infer<typeof ToolPart>

const Base = z.object({
  id: MessageID.zod,
  sessionID: SessionID.zod,
  agentID: z.string().optional(),
})

export const HookProvenance = z
  .object({
    hookPhase: z.enum(["pre", "post"]),
    hookIteration: z.number().int().nonnegative(),
    pluginNames: z.array(z.string()),
    hookIDs: z.array(z.string()),
  })
  .strict()
  .meta({ ref: "HookProvenance" })

export const AutomationProvenance = z
  .object({
    taskID: z.string().min(1),
    runID: z.string().min(1),
  })
  .strict()
  .meta({ ref: "AutomationProvenance" })

export const Provenance = z
  .union([HookProvenance, AutomationProvenance])
  .meta({ ref: "Provenance" })
export type Provenance = z.infer<typeof Provenance>

export const TavernContext = z.object({
  depth: z.array(z.object({
    content: z.string().min(1).max(16_000),
    depth: z.number().int().min(0).max(100),
  })).max(32),
}).meta({ ref: "TavernContext" })
export type TavernContext = z.infer<typeof TavernContext>
export const User = Base.extend({
  role: z.literal("user"),
  time: z.object({
    created: z.number(),
  }),
  format: Format.optional(),
  summary: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      diffs: Vcs.FileDiff.array(),
    })
    .optional(),
  agent: z.string(),
  model: z.object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
    variant: z.string().optional(),
  }),
  system: z.string().optional(),
  tavernContext: TavernContext.optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  source: z.enum(["user", "spawn", "hook", "automation"]).optional(),
  provenance: Provenance.optional(),
}).meta({
  ref: "UserMessage",
})
export type User = z.infer<typeof User>

export const Part = z
  .discriminatedUnion("type", [
    TextPart,
    SubtaskPart,
    ReasoningPart,
    FilePart,
    ToolPart,
    StepStartPart,
    StepFinishPart,
    SnapshotPart,
    PatchPart,
    AgentPart,
    RetryPart,
    CheckpointPart,
    CompactionPart,
  ])
  .meta({
    ref: "Part",
  })
export type Part = z.infer<typeof Part>

export const Assistant = Base.extend({
  role: z.literal("assistant"),
  time: z.object({
    created: z.number(),
    completed: z.number().optional(),
  }),
  error: z
    .discriminatedUnion("name", [
      AuthError.Schema,
      NamedError.Unknown.Schema,
      OutputLengthError.Schema,
      AbortedError.Schema,
      StructuredOutputError.Schema,
      ContextOverflowError.Schema,
      InvalidOutputError.Schema,
      ContentFilterError.Schema,
      ModelError.Schema,
      APIError.Schema,
    ])
    .optional(),
  parentID: MessageID.zod,
  modelID: ModelID.zod,
  providerID: ProviderID.zod,
  /**
   * @deprecated
   */
  mode: z.string(),
  agent: z.string(),
  path: z.object({
    cwd: z.string(),
    root: z.string(),
  }),
  summary: z.boolean().optional(),
  cost: z.number(),
  tokens: MessageTokens,
  responseMetrics: z
    .object({
      firstTokenAt: z.number(),
      tokens: MessageTokens,
    })
    .optional(),
  structured: z.any().optional(),
  variant: z.string().optional(),
  finish: z.string().optional(),
}).meta({
  ref: "AssistantMessage",
})
export type Assistant = z.infer<typeof Assistant>

export const Info = z.discriminatedUnion("role", [User, Assistant]).meta({
  ref: "Message",
})
export type Info = z.infer<typeof Info>

export const Event = {
  Updated: SyncEvent.define({
    type: "message.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      info: Info,
    }),
  }),
  Removed: SyncEvent.define({
    type: "message.removed",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
  }),
  PartUpdated: SyncEvent.define({
    type: "message.part.updated",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      part: Part,
      time: z.number(),
    }),
  }),
  PartDelta: BusEvent.define(
    "message.part.delta",
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
  ),
  PartRemoved: SyncEvent.define({
    type: "message.part.removed",
    version: 1,
    aggregate: "sessionID",
    schema: z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
  }),
}

export const WithParts = z.object({
  info: Info,
  parts: z.array(Part),
})
export type WithParts = z.infer<typeof WithParts>

/**
 * User-hidden actor IDs are durable message metadata. Keep this predicate at
 * the message boundary so API, sync, export, sharing, and forks cannot
 * accidentally rely on a live ActorRegistry row that may no longer exist.
 */
export function isUserVisible(info: Pick<Info, "agentID">) {
  return !isUserHiddenSystemActorID(info.agentID)
}

export function isUserVisibleMessage(input: { sessionID: SessionID; messageID: MessageID }) {
  try {
    return isUserVisible(get(input).info)
  } catch {
    // Event filtering must fail closed: an unavailable owner must never turn an
    // internal message/part event into a user-visible payload.
    return false
  }
}

const Cursor = z.object({
  id: MessageID.zod,
  time: z.number(),
})
type Cursor = z.infer<typeof Cursor>

export const cursor = {
  encode(input: Cursor) {
    return Buffer.from(JSON.stringify(input)).toString("base64url")
  },
  decode(input: string) {
    return Cursor.parse(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

const info = (row: typeof MessageTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    agentID: row.agent_id,
  }) as Info

const part = (row: typeof PartTable.$inferSelect) =>
  hydrateStoredPart({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  } as Part)

const older = (row: Cursor) =>
  or(lt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), lt(MessageTable.id, row.id)))

const olderOrEqual = (row: Cursor) =>
  or(lt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), lte(MessageTable.id, row.id)))

const newer = (row: Cursor) =>
  or(gt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), gt(MessageTable.id, row.id)))

const atOrAfter = (row: Cursor) =>
  or(gt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), gte(MessageTable.id, row.id)))

const userRole = () => sql`json_extract(${MessageTable.data}, '$.role') = 'user'`

const agentClause = (agentID?: string) => (agentID === "*" ? undefined : eq(MessageTable.agent_id, agentID ?? "main"))

function hydrate(rows: (typeof MessageTable.$inferSelect)[]) {
  const ids = rows.map((row) => row.id)
  const partByMessage = new Map<string, Part[]>()
  if (ids.length > 0) {
    const partRows = Database.use((db) =>
      db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.message_id, ids))
        .orderBy(PartTable.message_id, PartTable.id)
        .all(),
    )
    for (const row of partRows) {
      const next = part(row)
      const list = partByMessage.get(row.message_id)
      if (list) list.push(next)
      else partByMessage.set(row.message_id, [next])
    }
  }

  return rows.map((row) => ({
    info: info(row),
    parts: partByMessage.get(row.id) ?? [],
  }))
}

function providerMeta(metadata: Record<string, any> | undefined) {
  if (!metadata) return undefined
  const { providerExecuted: _, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

function selectedTextMetadata(metadata: Record<string, any> | undefined) {
  if (!metadata || !("lfcodeSelectedText" in metadata)) return []
  const raw = metadata.lfcodeSelectedText
  const values = Array.isArray(raw) ? raw : [raw]
  return values.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const text = "text" in item && typeof item.text === "string" ? item.text.trim() : ""
    if (!text) return []
    const messageID = "messageID" in item && typeof item.messageID === "string" ? item.messageID : undefined
    const selection =
      "selection" in item && item.selection && typeof item.selection === "object"
        ? {
            startLine:
              "startLine" in item.selection && typeof item.selection.startLine === "number"
                ? item.selection.startLine
                : undefined,
            endLine:
              "endLine" in item.selection && typeof item.selection.endLine === "number"
                ? item.selection.endLine
                : undefined,
          }
        : undefined
    return [{ text, messageID, selection }]
  })
}

function formatSelectedTextPrompt(
  item: ReturnType<typeof selectedTextMetadata>[number],
  index: number,
  total: number,
) {
  const lines = [
    total > 1 ? `[User selected text ${index + 1}]` : "[User selected text]",
    item.messageID ? `Source message: ${item.messageID}` : undefined,
    item.selection?.startLine && item.selection?.endLine
      ? item.selection.startLine === item.selection.endLine
        ? `Lines: ${item.selection.startLine}`
        : `Lines: ${item.selection.startLine}-${item.selection.endLine}`
      : undefined,
    "Excerpt:",
    item.text,
  ]
  return lines.filter((line) => line && line.trim().length > 0).join("\n")
}

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; compactToolResults?: boolean },
) {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  const excludedLegacyRecallMessages = new Set<string>()
  for (const message of input) {
    if (isLegacyAutomaticRecallReminder(message)) {
      excludedLegacyRecallMessages.add(message.info.id)
      continue
    }
    if (message.info.role === "assistant" && excludedLegacyRecallMessages.has(message.info.parentID)) {
      excludedLegacyRecallMessages.add(message.info.id)
    }
  }
  // Track media from tool results that need to be injected as user messages
  // for providers that don't support media in tool results.
  //
  // OpenAI-compatible APIs only support string content in tool results, so media
  // must be extracted and injected as a user message. Anthropic/Bedrock can keep
  // media nested in tool results; Gemini 3 supports it, but earlier Gemini models
  // need the extracted-user-message path.
  const supportsMediaInToolResults = (() => {
    if (model.api.npm === "@ai-sdk/anthropic") return true
    if (model.api.npm === "@ai-sdk/amazon-bedrock") return true
    if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
    if (model.api.npm === "@ai-sdk/google") {
      const id = model.api.id.toLowerCase()
      return id.includes("gemini-3") && !id.includes("gemini-2")
    }
    return false
  })()

  const toModelOutput = (options: { toolCallId: string; input: unknown; output: unknown }) => {
    const output = options.output
    if (typeof output === "string") {
      return { type: "text", value: output }
    }

    if (typeof output === "object") {
      const outputObject = output as {
        text: string
        attachments?: Array<{ mime: string; url: string; filename?: string }>
      }
      const attachments = (outputObject.attachments ?? []).filter((attachment) => {
        return attachment.url.startsWith("data:") && attachment.url.includes(",")
      })

      return {
        type: "content",
        value: [
          { type: "text", text: outputObject.text },
          ...attachments.map((attachment) => ({
            type: "media",
            mediaType: attachment.mime,
            data: iife(() => {
              const commaIndex = attachment.url.indexOf(",")
              return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
            }),
          })),
        ],
      }
    }

    return { type: "json", value: output as never }
  }

  for (const msg of input) {
    if (msg.parts.length === 0) continue
    if (excludedLegacyRecallMessages.has(msg.info.id)) continue

    if (msg.info.role === "user") {
      const userMessage: UIMessage = {
        id: msg.info.id,
        role: "user",
        parts: [],
      }
      result.push(userMessage)
      for (const part of msg.parts) {
        if (part.type === "text" && !part.ignored)
          userMessage.parts.push({
            type: "text",
            text: part.text,
          })
        if (part.type === "text" && !part.ignored) {
          const selectedTexts = selectedTextMetadata(part.metadata)
          selectedTexts.forEach((item, index) => {
            userMessage.parts.push({
              type: "text",
              text: formatSelectedTextPrompt(item, index, selectedTexts.length),
            })
          })
        }
        // text/plain and directory files are converted into text parts, ignore them
        if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory") {
          if (options?.stripMedia && isMedia(part.mime)) {
            userMessage.parts.push({
              type: "text",
              text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
            })
          } else {
            userMessage.parts.push({
              type: "file",
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            })
          }
        }

        if (part.type === "checkpoint") {
          userMessage.parts.push({
            type: "text" as const,
            text: "Summary of previous conversation from checkpoint files:",
          })
        }
        if (part.type === "compaction") {
          userMessage.parts.push({
            type: "text" as const,
            text: "Summary of previous conversation:",
          })
        }
        if (part.type === "subtask") {
          userMessage.parts.push({
            type: "text",
            text: "The following tool was executed by the user",
          })
        }
      }
    }

    if (msg.info.role === "assistant") {
      const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
      const media: Array<{ mime: string; url: string; filename?: string }> = []

      if (
        msg.info.error &&
        !(
          AbortedError.isInstance(msg.info.error) &&
          msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
        )
      ) {
        continue
      }
      const assistantMessage: UIMessage = {
        id: msg.info.id,
        role: "assistant",
        parts: [],
      }
      for (const part of msg.parts) {
        if (part.type === "text")
          assistantMessage.parts.push({
            type: "text",
            text: part.text,
            ...(differentModel ? {} : { providerMetadata: part.metadata }),
          })
        if (part.type === "step-start")
          assistantMessage.parts.push({
            type: "step-start",
          })
        if (part.type === "tool") {
          toolNames.add(part.tool)
          if (part.state.status === "completed") {
            const outputText = part.state.time.compacted
              ? "[Old tool result content cleared]"
              : options?.compactToolResults
                ? "[Tool result omitted during compaction]"
                : part.state.output
            const attachments =
              part.state.time.compacted || options?.stripMedia || options?.compactToolResults
                ? []
                : (part.state.attachments ?? [])

            // For providers that don't support media in tool results, extract media files
            // (images, PDFs) to be sent as a separate user message
            const mediaAttachments = attachments.filter((a) => isMedia(a.mime))
            const nonMediaAttachments = attachments.filter((a) => !isMedia(a.mime))
            if (!supportsMediaInToolResults && mediaAttachments.length > 0) {
              media.push(...mediaAttachments)
            }
            const finalAttachments = supportsMediaInToolResults ? attachments : nonMediaAttachments

            const output =
              finalAttachments.length > 0
                ? {
                    text: outputText,
                    attachments: finalAttachments,
                  }
                : outputText

            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-available",
              toolCallId: part.callID,
              input: part.state.input,
              output,
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
          }
          if (part.state.status === "error") {
            const output = part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined
            if (typeof output === "string") {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-available",
                toolCallId: part.callID,
                input: part.state.input,
                output,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            } else {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            }
          }
          // Handle pending/running tool calls to prevent dangling tool_use blocks
          // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
          if (part.state.status === "pending" || part.state.status === "running")
            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-error",
              toolCallId: part.callID,
              input: part.state.input,
              errorText: "[Tool execution was interrupted]",
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
        }
        if (part.type === "reasoning") {
          assistantMessage.parts.push({
            type: "reasoning",
            text: part.text,
            ...(differentModel ? {} : { providerMetadata: part.metadata }),
          })
        }
      }
      if (assistantMessage.parts.length > 0) {
        result.push(assistantMessage)
        // Inject pending media as a user message for providers that don't support
        // media (images, PDFs) in tool results
        if (media.length > 0) {
          result.push({
            id: MessageID.ascending(),
            role: "user",
            parts: [
              {
                type: "text" as const,
                text: SYNTHETIC_ATTACHMENT_PROMPT,
              },
              ...media.map((attachment) => ({
                type: "file" as const,
                url: attachment.url,
                mediaType: attachment.mime,
                filename: attachment.filename,
              })),
            ],
          })
        }
      }
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return yield* Effect.promise(() =>
    convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        //@ts-expect-error (convertToModelMessages expects a ToolSet but only actually needs tools[name]?.toModelOutput)
        tools,
      },
    ),
  )
})

export function toModelMessages(
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; compactToolResults?: boolean },
): Promise<ModelMessage[]> {
  return Effect.runPromise(toModelMessagesEffect(input, model, options).pipe(Effect.provide(EffectLogger.layer)))
}

export function page(input: {
  sessionID: SessionID
  limit: number
  before?: string
  agentID?: string
  /**
   * Apply the durable user-visibility boundary before calculating the page
   * cursor. Filtering a completed page afterwards can otherwise produce an
   * empty page and a cursor whose decoded ID belongs to an internal actor.
   */
  userVisible?: boolean
}) {
  const before = input.before ? cursor.decode(input.before) : undefined
  // Slice contract: agentID `undefined` (default) ⇒ main slice only;
  // `"*"` ⇒ every slice (full-stream opt-out for export/stats/share/etc.);
  // any other string ⇒ that subagent's actorID slice.
  const agent = agentClause(input.agentID)
  const where = and(
    eq(MessageTable.session_id, input.sessionID),
    ...(before ? [older(before)] : []),
    ...(agent ? [agent] : []),
    ...(input.userVisible
      ? [not(or(eq(MessageTable.agent_id, "context-reviewer"), like(MessageTable.agent_id, "context-reviewer-%"))!)]
      : []),
  )
  const rows = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(where)
      .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
      .limit(input.limit + 1)
      .all(),
  )
  if (rows.length === 0) {
    const row = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
    )
    if (!row) throw new NotFoundError({ message: `Session not found: ${input.sessionID}` })
    return {
      items: [] as WithParts[],
      more: false,
    }
  }

  const more = rows.length > input.limit
  const slice = more ? rows.slice(0, input.limit) : rows
  const items = hydrate(slice)
  items.reverse()
  const tail = slice.at(-1)
  return {
    items,
    more,
    cursor: more && tail ? cursor.encode({ id: tail.id, time: tail.time_created }) : undefined,
  }
}

export function turnWindow(input: { sessionID: SessionID; messageID?: MessageID; turns?: number; agentID?: string }) {
  const agent = agentClause(input.agentID)
  const base = [eq(MessageTable.session_id, input.sessionID), ...(agent ? [agent] : [])]
  const target = Database.use((db) =>
    db
      .select({ id: MessageTable.id, time: MessageTable.time_created })
      .from(MessageTable)
      .where(
        and(
          ...base,
          userRole(),
          ...(input.messageID ? [eq(MessageTable.id, input.messageID)] : []),
        ),
      )
      .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
      .limit(1)
      .get(),
  )
  if (!target) return [] as WithParts[]

  const starts = Database.use((db) =>
    db
      .select({ id: MessageTable.id, time: MessageTable.time_created })
      .from(MessageTable)
      .where(and(...base, userRole(), olderOrEqual(target)))
      .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
      .limit(Math.max(1, Math.floor(input.turns ?? 1)))
      .all(),
  )
  const start = starts.at(-1) ?? target
  const next = Database.use((db) =>
    db
      .select({ id: MessageTable.id, time: MessageTable.time_created })
      .from(MessageTable)
      .where(and(...base, userRole(), newer(target)))
      .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
      .limit(1)
      .get(),
  )

  return hydrate(
    Database.use((db) =>
      db
        .select()
        .from(MessageTable)
        .where(and(...base, atOrAfter(start), ...(next ? [older(next)] : [])))
        .orderBy(asc(MessageTable.time_created), asc(MessageTable.id))
        .all(),
    ),
  )
}

/**
 * Iterate session messages oldest-last (caller usually reverses).
 *
 * Slice contract (forwarded to `page`):
 *   options.agentID === undefined  → main slice only (default)
 *   options.agentID === "*"        → every slice (full-stream opt-out)
 *   any other string               → that actor's slice
 */
export function* stream(sessionID: SessionID, options?: { agentID?: string }) {
  const size = 50
  let before: string | undefined
  while (true) {
    const next = page({ sessionID, limit: size, before, agentID: options?.agentID })
    if (next.items.length === 0) break
    for (let i = next.items.length - 1; i >= 0; i--) {
      yield next.items[i]
    }
    if (!next.more || !next.cursor) break
    before = next.cursor
  }
}

export function parts(message_id: MessageID) {
  const rows = Database.use((db) =>
    db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all(),
  )
  return rows.map((row) =>
    hydrateStoredPart({
      ...row.data,
      id: row.id,
      sessionID: row.session_id,
      messageID: row.message_id,
    } as Part),
  )
}

export function get(input: { sessionID: SessionID; messageID: MessageID }): WithParts {
  const row = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
      .get(),
  )
  if (!row) throw new NotFoundError({ message: `Message not found: ${input.messageID}` })
  return {
    info: info(row),
    parts: parts(input.messageID),
  }
}

export function filterCompacted(msgs: Iterable<WithParts>) {
  const result = [] as WithParts[]
  for (const msg of msgs) {
    result.push(msg)
    if (msg.info.role === "user" && msg.parts.some((part) => part.type === "checkpoint" || part.type === "compaction")) break
  }
  result.reverse()
  return result
}

export type ContinuationBoundaryKind = "checkpoint" | "compaction"

export type ContinuationContext = {
  messages: WithParts[]
  source: "raw" | ContinuationBoundaryKind
  fallbackReason?: string
  boundary?: {
    messageID: MessageID
    kind: ContinuationBoundaryKind
    valid: boolean
    reason?: string
  }
}

export type ActiveContextProjection = {
  messages: WithParts[]
  stats: {
    media: number
    reasoning: number
    toolResults: number
  }
}

/**
 * Produces the model-only hot context. Stored messages remain untouched so
 * timeline replay, export, and future recovery always retain the source data.
 */
export function projectActiveContext(input: WithParts[], options?: { tailTurns?: number; maxTailTokens?: number }): ActiveContextProjection {
  const tailTurns = options?.tailTurns ?? 2
  const maxTailTokens = options?.maxTailTokens ?? Number.POSITIVE_INFINITY
  const userIndexes = input.flatMap((message, index) => (message.info.role === "user" ? [index] : []))
  const tailStart =
    userIndexes.length === 0 ? 0 : tailTurns <= 0 ? userIndexes.at(-1)! : (userIndexes.at(-tailTurns) ?? 0)
  const stats = { media: 0, reasoning: 0, toolResults: 0 }

  const projected = input.map((message, index) => {
      if (index >= tailStart) return message
      let changed = false
      const parts = message.parts.flatMap((part): Part[] => {
        if (part.type === "reasoning") {
          changed = true
          stats.reasoning += 1
          return []
        }
        if (part.type === "file" && isMedia(part.mime)) {
          changed = true
          stats.media += 1
          return [
            {
              id: part.id,
              sessionID: part.sessionID,
              messageID: part.messageID,
              type: "text",
              text: `[Earlier attachment omitted: ${part.mime}${part.filename ? ` (${part.filename})` : ""}]`,
              synthetic: true,
            },
          ]
        }
        if (part.type === "tool" && part.state.status === "completed") {
          changed = true
          stats.toolResults += 1
          return [
            {
              ...part,
              state: {
                ...part.state,
                output: `[Earlier ${part.tool} result omitted from active context]`,
                attachments: undefined,
              },
            },
          ]
        }
        return [part]
      })
      return changed ? { ...message, parts } : message
    })

  let remaining = maxTailTokens
  const messages = projected.map((message, index) => {
    if (index < tailStart) return message
    const estimated = Token.estimate(JSON.stringify(message.parts))
    if (estimated <= remaining) {
      remaining -= estimated
      return message
    }
    const parts = message.parts.map((part) => {
      if (part.type === "text" && part.text.length > 2048) {
        const keep = Math.max(512, Math.floor((remaining * 4) / Math.max(1, message.parts.length)))
        const head = Math.floor(keep * 0.65)
        return { ...part, text: `${part.text.slice(0, head)}\n...[context clipped]...\n${part.text.slice(-Math.max(128, keep - head))}` }
      }
      if (part.type === "tool" && part.state.status === "completed" && part.state.output.length > 2048) {
        const keep = Math.max(512, Math.floor((remaining * 4) / Math.max(1, message.parts.length)))
        const head = Math.floor(keep * 0.65)
        return { ...part, state: { ...part.state, output: `${part.state.output.slice(0, head)}\n...[tool result clipped]...\n${part.state.output.slice(-Math.max(128, keep - head))}` } }
      }
      return part
    })
    remaining = Math.max(0, remaining - Token.estimate(JSON.stringify(parts)))
    return { ...message, parts }
  })

  return {
    messages,
    stats,
  }
}

function isLaterMessage(a: WithParts, b: WithParts) {
  if (a.info.time.created !== b.info.time.created) return a.info.time.created > b.info.time.created
  return a.info.id > b.info.id
}

function chronologicalMessages(messages: WithParts[]) {
  if (messages.length < 2) return [...messages]
  return isLaterMessage(messages[0], messages.at(-1)!) ? [...messages].reverse() : [...messages]
}

function hasVisibleText(parts: Part[]) {
  return parts.some((part) => part.type === "text" && !!part.text.trim())
}

function hasCheckpointBody(msg: WithParts) {
  const checkpointIndex = msg.parts.findIndex((part) => part.type === "checkpoint")
  if (checkpointIndex < 0) return false
  const checkpoint = msg.parts[checkpointIndex]
  if (checkpoint.type !== "checkpoint") return false
  return msg.parts.slice(checkpointIndex + 1).some((part) => part.type === "text" && !!part.text.trim())
}

function checkpointCoverageIsValid(messages: WithParts[], boundary: WithParts) {
  const checkpoint = boundary.parts.find((part): part is CheckpointPart => part.type === "checkpoint")
  if (!checkpoint) return false
  const coveredIndex = messages.findIndex((message) => message.info.id === checkpoint.coveredUpTo)
  const boundaryIndex = messages.findIndex((message) => message.info.id === boundary.info.id)
  if (coveredIndex < 0 || boundaryIndex < 0 || coveredIndex >= boundaryIndex) return false
  const covered = messages[coveredIndex]
  return (
    covered.info.sessionID === boundary.info.sessionID &&
    (covered.info.agentID ?? "main") === (boundary.info.agentID ?? "main")
  )
}

function hasCompactionSummary(messages: WithParts[], boundaryIndex: number) {
  const summary = messages[boundaryIndex + 1]
  if (!summary || summary.info.role !== "assistant" || !hasVisibleText(summary.parts)) return false
  return summary.info.summary === true || summary.info.mode === "compaction"
}

function describeBoundaryFallback(boundary: NonNullable<ContinuationContext["boundary"]>) {
  return `${boundary.kind}: ${boundary.reason ?? "invalid continuation boundary"}`
}

function compactionContext(
  messages: WithParts[],
  boundaryIndex: number,
  boundary: WithParts,
): { messages?: WithParts[]; reason?: string } {
  const part = boundary.parts.find((item): item is CompactionPart => item.type === "compaction")
  if (!part?.tail_start_id) return { messages: messages.slice(boundaryIndex) }
  const tailStart = messages.findIndex((item) => item.info.id === part.tail_start_id)
  if (tailStart < 0) return { reason: "tail start not found" }
  if (tailStart >= boundaryIndex) return { reason: "tail does not precede compaction boundary" }

  const tail = messages[tailStart]
  if (tail.info.role !== "user") return { reason: "tail start is not a user message" }
  if (tail.info.sessionID !== boundary.info.sessionID) return { reason: "tail belongs to another session" }
  if ((tail.info.agentID ?? "main") !== (boundary.info.agentID ?? "main")) {
    return { reason: "tail belongs to another actor" }
  }

  const summaryIndex = boundaryIndex + 1
  const summary = messages[summaryIndex]
  if (!summary || summary.info.role !== "assistant" || !hasVisibleText(summary.parts)) {
    return { reason: "missing summary assistant after compaction boundary" }
  }
  if (summary.info.summary !== true && summary.info.mode !== "compaction") {
    return { reason: "summary assistant is not attached to compaction boundary" }
  }
  return {
    messages: [
      ...messages.slice(boundaryIndex, summaryIndex + 1),
      ...messages.slice(tailStart, boundaryIndex),
      ...messages.slice(summaryIndex + 1),
    ],
  }
}

export function selectContinuationMessages(messages: WithParts[]): ContinuationContext {
  const ordered = chronologicalMessages(messages)
  let latestInvalidBoundary: ContinuationContext["boundary"] | undefined

  for (let i = ordered.length - 1; i >= 0; i--) {
    const msg = ordered[i]
    if (msg.info.role !== "user") continue

    if (msg.parts.some((part) => part.type === "checkpoint")) {
      if (!hasCheckpointBody(msg) || !checkpointCoverageIsValid(ordered, msg)) {
        log.info("continuation_boundary_invalid", {
          sessionID: msg.info.sessionID,
          messageID: msg.info.id,
          kind: "checkpoint",
          reason: "missing checkpoint rebuild body",
        })
        latestInvalidBoundary ??= {
          messageID: msg.info.id,
          kind: "checkpoint",
          valid: false,
          reason: "missing checkpoint rebuild body",
        }
        continue
      }
      return {
        messages: ordered.slice(i),
        source: "checkpoint",
        fallbackReason: latestInvalidBoundary ? describeBoundaryFallback(latestInvalidBoundary) : undefined,
        boundary: {
          messageID: msg.info.id,
          kind: "checkpoint",
          valid: true,
        },
      }
    }

    if (msg.parts.some((part) => part.type === "compaction")) {
      const hasSummary = hasCompactionSummary(ordered, i)
      if (!hasSummary) {
        log.info("continuation_boundary_invalid", {
          sessionID: msg.info.sessionID,
          messageID: msg.info.id,
          kind: "compaction",
          reason: "missing summary assistant after compaction boundary",
        })
        latestInvalidBoundary ??= {
          messageID: msg.info.id,
          kind: "compaction",
          valid: false,
          reason: "missing summary assistant after compaction boundary",
        }
        continue
      }
      const context = compactionContext(ordered, i, msg)
      if (!context.messages) {
        log.info("continuation_boundary_invalid", {
          sessionID: msg.info.sessionID,
          messageID: msg.info.id,
          kind: "compaction",
          reason: context.reason,
        })
        latestInvalidBoundary ??= {
          messageID: msg.info.id,
          kind: "compaction",
          valid: false,
          reason: context.reason,
        }
        continue
      }
      return {
        messages: context.messages,
        source: "compaction",
        fallbackReason: latestInvalidBoundary ? describeBoundaryFallback(latestInvalidBoundary) : undefined,
        boundary: {
          messageID: msg.info.id,
          kind: "compaction",
          valid: true,
        },
      }
    }
  }

  if (latestInvalidBoundary) {
    return {
      messages: ordered,
      source: "raw",
      fallbackReason: describeBoundaryFallback(latestInvalidBoundary),
      boundary: latestInvalidBoundary,
    }
  }

  return { messages: ordered, source: "raw", fallbackReason: "no continuation boundary" }
}

export const loadContinuationContextEffect = Effect.fnUntraced(function* (
  sessionID: SessionID,
  options?: { contextFrom?: SessionID; contextWatermark?: MessageID; agentID?: string },
) {
  const ownContext = selectContinuationMessages(Array.from(stream(sessionID, { agentID: options?.agentID })))
  const ownMessages = ownContext.messages
  if (!options?.contextFrom) {
    return {
      messages: ownMessages,
      own: ownContext,
    }
  }

  // Load parent messages up to the watermark. Inherited parent context is
  // always scoped to the parent's main thread (agent_id = 'main') — subagent
  // siblings on the parent must not leak into a child session/subagent.
  const parentStream = stream(options.contextFrom, { agentID: "main" })
  const parentContext = selectContinuationMessages(Array.from(parentStream))
  const parentFiltered = parentContext.messages

  // If watermark is set, truncate parent messages at the watermark point
  if (options.contextWatermark) {
    const watermarkIdx = parentFiltered.findIndex((msg) => msg.info.id === options.contextWatermark)
    if (watermarkIdx >= 0) {
      return {
        messages: [...parentFiltered.slice(0, watermarkIdx + 1), ...ownMessages],
        own: ownContext,
        parent: parentContext,
      }
    }
  }

  // Fallback: use all parent messages
  return {
    messages: [...parentFiltered, ...ownMessages],
    own: ownContext,
    parent: parentContext,
  }
})

function isLegacyAutomaticRecallReminder(message: WithParts) {
  if (message.info.role !== "user") return false
  const text = message.parts
    .filter((part): part is TextPart => part.type === "text" && part.synthetic === true)
    .map((part) => part.text)
    .join("\n")
  return (
    text.includes("This session may already have recorded state.") &&
    text.includes("Before asking the user to repeat prior context") &&
    text.includes("<system-reminder>")
  )
}

export const filterCompactedEffect = Effect.fnUntraced(function* (
  sessionID: SessionID,
  options?: { contextFrom?: SessionID; contextWatermark?: MessageID; agentID?: string },
) {
  const loaded = yield* loadContinuationContextEffect(sessionID, options)

  log.info("continuation_context_loaded", {
    sessionID,
    agentID: options?.agentID ?? "main",
    source: loaded.own.source,
    boundaryType: loaded.own.boundary?.kind,
    boundaryValid: loaded.own.boundary?.valid ?? false,
    fallbackReason: loaded.own.fallbackReason,
    messageCount: loaded.own.messages.length,
    inherited: !!options?.contextFrom,
  })

  if (loaded.parent) {
    log.info("continuation_context_loaded", {
      sessionID,
      agentID: "main",
      source: loaded.parent.source,
      boundaryType: loaded.parent.boundary?.kind,
      boundaryValid: loaded.parent.boundary?.valid ?? false,
      fallbackReason: loaded.parent.fallbackReason,
      messageCount: loaded.parent.messages.length,
      inheritedFrom: options?.contextFrom,
      contextWatermark: options?.contextWatermark,
    })
  }

  return loaded.messages
})

export function fromError(
  e: unknown,
  ctx: { providerID: ProviderID; aborted?: boolean },
): NonNullable<Assistant["error"]> {
  switch (true) {
    case e instanceof DOMException && e.name === "AbortError":
      return new AbortedError(
        { message: e.message },
        {
          cause: e,
        },
      ).toObject()
    // The AI SDK wraps the real failure in AI_RetryError after exhausting its
    // own maxRetries. Unwrap to the underlying error (.lastError) so the
    // APICallError branch below can extract statusCode/isRetryable/responseBody.
    // Without this, a wrapped 5xx falls through to the `e instanceof Error`
    // catch-all and collapses to an opaque UnknownError — which SessionRetry
    // can't classify, so the visible retry status never fires and the turn
    // hangs with a dead spinner.
    case RetryError.isInstance(e): {
      const inner = e.lastError ?? e.errors[e.errors.length - 1]
      if (inner !== undefined && inner !== e) return fromError(inner, ctx)
      return new APIError(
        { message: e.message, isRetryable: true },
        { cause: e },
      ).toObject()
    }
    case OutputLengthError.isInstance(e):
      return e
    case LoadAPIKeyError.isInstance(e):
      return new AuthError(
        {
          providerID: ctx.providerID,
          message: e.message,
        },
        { cause: e },
      ).toObject()
    case (e as SystemError)?.code === "ECONNRESET":
      return new APIError(
        {
          message: "Connection reset by server",
          isRetryable: true,
          metadata: {
            code: (e as SystemError).code ?? "",
            syscall: (e as SystemError).syscall ?? "",
            message: (e as SystemError).message ?? "",
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof Error && (e as FetchDecompressionError).code === "ZlibError":
      if (ctx.aborted) {
        return new AbortedError({ message: e.message }, { cause: e }).toObject()
      }
      return new APIError(
        {
          message: "Response decompression failed",
          isRetryable: true,
          metadata: {
            code: (e as FetchDecompressionError).code,
            message: e.message,
          },
        },
        { cause: e },
      ).toObject()
    case APICallError.isInstance(e):
      const parsed = ProviderError.parseAPICallError({
        providerID: ctx.providerID,
        error: e,
      })
      if (parsed.type === "context_overflow") {
        return new ContextOverflowError(
          {
            message: parsed.message,
            responseBody: parsed.responseBody,
          },
          { cause: e },
        ).toObject()
      }

      return new APIError(
        {
          message: parsed.message,
          statusCode: parsed.statusCode,
          isRetryable: parsed.isRetryable,
          responseHeaders: parsed.responseHeaders,
          responseBody: parsed.responseBody,
          metadata: parsed.metadata,
        },
        { cause: e },
      ).toObject()
    case e instanceof Error:
      return new NamedError.Unknown({ message: errorMessage(e) }, { cause: e }).toObject()
    default:
      try {
        const parsed = ProviderError.parseStreamError(e)
        if (parsed) {
          if (parsed.type === "context_overflow") {
            return new ContextOverflowError(
              {
                message: parsed.message,
                responseBody: parsed.responseBody,
              },
              { cause: e },
            ).toObject()
          }
          return new APIError(
            {
              message: parsed.message,
              isRetryable: parsed.isRetryable,
              responseBody: parsed.responseBody,
            },
            {
              cause: e,
            },
          ).toObject()
        }
      } catch {}
      return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
  }
}

export * as MessageV2 from "./message-v2"
