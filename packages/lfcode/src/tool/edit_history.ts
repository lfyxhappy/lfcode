import z from "zod"
import { Effect } from "effect"
import { Vcs } from "../project"
import { Session } from "../session"
import * as MessageV2 from "../session/message-v2"
import * as Tool from "./tool"
import DESCRIPTION from "./edit_history.txt"
import { collectMessageFileDiffs } from "../session/file-diff"

const Parameters = z.object({
  scope: z
    .enum(["tool", "session"])
    .optional()
    .describe("tool: list individual write steps; session: summarize the whole session's net diff."),
  limit: z.coerce.number().int().min(1).max(20).optional().describe("Maximum number of tool-level edit entries to return. Defaults to 10."),
})

type Entry = {
  assistantMessageID: string
  userMessageID?: string
  partID: string
  agentID: string
  time?: number
  files: string[]
  diffs: Vcs.FileDiff[]
}

type EditHistoryMetadata = {
  scope: "tool" | "session"
  count: number
  entries: Entry[]
  diffs?: Vcs.FileDiff[]
}

export const EditHistoryTool = Tool.define(
  "edit_history",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const definition: Tool.DefWithoutID<typeof Parameters, EditHistoryMetadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const scope = params.scope ?? "tool"
          const messages = yield* session.messages({ sessionID: ctx.sessionID, agentID: "*" })

          if (scope === "session") {
            const diffs = collectMessageFileDiffs(messages)
            if (diffs.length === 0) {
              return {
                title: "Session edit history",
                output: "No file edits recorded for this session.",
                metadata: {
                  scope,
                  count: 0,
                  entries: [] as Entry[],
                },
              }
            }

            return {
              title: "Session edit history",
              output: renderSessionOutput(diffs),
              metadata: {
                scope,
                count: 1,
                entries: [] as Entry[],
                diffs,
              },
            }
          }

          const entries = collectToolEntries(messages)
          const limited = entries.slice(0, params.limit ?? 10)
          if (limited.length === 0) {
            return {
              title: "Tool edit history",
              output: "No tool-level file edits recorded for this session.",
              metadata: {
                scope,
                count: 0,
                entries: [] as Entry[],
              },
            }
          }

          return {
            title: "Tool edit history",
            output: renderToolOutput(limited),
            metadata: {
              scope,
              count: limited.length,
              entries: limited,
            },
          }
        }),
    }
    return definition
  }),
)

function collectToolEntries(messages: MessageV2.WithParts[]) {
  const entries: Entry[] = []

  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue

    const diffs = collectMessageFileDiffs([msg])
    if (diffs.length === 0) continue

    const part = msg.parts.find(
      (item): item is MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted } =>
        item.type === "tool" && item.state.status === "completed",
    )
    if (!part) continue

    entries.push({
      assistantMessageID: msg.info.id,
      userMessageID: msg.info.parentID,
      partID: part.id,
      agentID: msg.info.agentID ?? "unknown",
      time: part.state.time.end ?? msg.info.time.completed ?? msg.info.time.created,
      files: diffs.map((item) => item.file),
      diffs,
    })
  }

  return entries.toReversed()
}

function renderSessionOutput(diffs: Vcs.FileDiff[]) {
  const lines = [
    `Recorded ${diffs.length} changed file${diffs.length === 1 ? "" : "s"} across this session.`,
    "",
    ...renderDiffs(diffs),
  ]
  return lines.join("\n")
}

function renderToolOutput(entries: Entry[]) {
  const lines = [`Recorded ${entries.length} recent tool edit entr${entries.length === 1 ? "y" : "ies"}.`, ""]

  for (const [index, entry] of entries.entries()) {
    lines.push(`### ${index + 1}. ${entry.agentID} · ${entry.assistantMessageID}`)
    if (entry.userMessageID) lines.push(`Parent user message: ${entry.userMessageID}`)
    if (entry.time) lines.push(`Time: ${new Date(entry.time).toISOString()}`)
    lines.push(`Touched files: ${entry.files.length}`)
    lines.push(...entry.files.map((file) => `- ${file}`))
    if (entry.diffs.length > 0) {
      lines.push("")
      lines.push(...renderDiffs(entry.diffs))
    }
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

function renderDiffs(diffs: Vcs.FileDiff[]) {
  return diffs.flatMap((item) => {
    const header = `${statusLetter(item.status)} ${item.file} (+${item.additions} -${item.deletions})`
    if (!item.patch.trim()) return [header]
    return [header, "```diff", item.patch.trimEnd(), "```"]
  })
}

function statusLetter(status?: Vcs.FileDiff["status"]) {
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  return "M"
}
