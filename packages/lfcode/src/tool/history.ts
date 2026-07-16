import { Effect } from "effect"
import z from "zod"
import { History } from "@/history"
import DESCRIPTION from "./history.txt"
import * as Tool from "./tool"
import * as Truncate from "./truncate"
import { Agent } from "@/agent/agent"

const KIND = z.enum([
  "user_text",
  "assistant_text",
  "tool_input",
  "tool_error",
  "reasoning",
  "tool_output",
])

// around() output can easily be tens of KB (multi-message contexts with full
// part bodies including reasoning/tool blocks). Capping below the global
// MAX_BYTES nudges agents toward "search → message_id → targeted Read" instead
// of one giant inline dump. Only history.around uses this; other tools keep
// the framework default.
const AROUND_MAX_BYTES = 20 * 1024

const parameters = z.object({
  operation: z.enum(["search", "around", "session"]).describe("search: FTS BM25; around: pull message context; session: read raw session history"),
  // search params
  query: z.string().optional().describe("FTS query (BM25 over text/tool bodies). Required for operation=search."),
  scope: z.enum(["project", "global"]).optional().describe("Default project."),
  session_id: z.string().optional(),
  agent_scope: z.enum(["main", "all"]).optional().describe("For session: whether to include only main slice or all actors."),
  include_boundaries: z.boolean().optional().describe("For session: include checkpoint/compaction boundary rows."),
  kind: z.array(KIND).optional(),
  tool_name: z.string().optional().describe("Filter to a specific tool (e.g. Bash, Read)"),
  time_after: z.number().optional().describe("Unix ms"),
  time_before: z.number().optional(),
  limit: z.number().optional().describe("Max 50, default 10"),
  // around params
  message_id: z.string().optional().describe("Anchor message id. Required for operation=around."),
  before: z.number().optional().describe("Default 5"),
  after: z.number().optional().describe("Default 5"),
})

type HistoryMetadata = {
  count: number
  session_found?: boolean
  checkpoint_found?: boolean
  truncated?: boolean
  outputRef?: string
}

export const HistoryTool = Tool.define(
  "history",
  Effect.gen(function* () {
    const history = yield* History.Service
    const truncate = yield* Truncate.Service
    const agents = yield* Agent.Service
    const definition: Tool.DefWithoutID<typeof parameters, HistoryMetadata> = {
      description: DESCRIPTION,
      parameters,
      execute: (args: z.infer<typeof parameters>, ctx) =>
        Effect.gen(function* () {
          if (args.operation === "search") {
            if (!args.query) {
              return {
                title: "History search: missing query",
                output: "operation=search requires a `query` argument.",
                metadata: { count: 0 },
              }
            }
            const hits = yield* history.search({
              query: args.query,
              scope: args.scope,
              session_id: args.session_id,
              kind: args.kind,
              tool_name: args.tool_name,
              time_after: args.time_after,
              time_before: args.time_before,
              limit: args.limit,
            })
            if (hits.length === 0) {
              return {
                title: "History search: 0 matches",
                output: `0 matches for "${args.query}". Try memory search if you haven't, or broaden the query.`,
                metadata: { count: 0 },
              }
            }
            const lines = [`Found ${hits.length} match${hits.length === 1 ? "" : "es"}:`, ""]
            for (const h of hits) {
              const kindLabel = h.tool_name ? `${h.kind} · ${h.tool_name}` : h.kind
              lines.push(`### ${h.session_id} ${h.message_id}  (${kindLabel})`)
              lines.push(`Time: ${new Date(h.time_created).toISOString()}, Score: ${h.score.toFixed(3)}`)
              lines.push(h.snippet)
              lines.push("")
            }
            return {
              title: `History search: ${hits.length} match${hits.length === 1 ? "" : "es"}`,
              output: lines.join("\n"),
              metadata: { count: hits.length },
            }
          }

          if (args.operation === "session") {
            if (!args.session_id) {
              return {
                title: "History session: missing session_id",
                output: "operation=session requires a `session_id` argument.",
                metadata: { count: 0, session_found: false, checkpoint_found: false },
              }
            }
            const snapshot = yield* history.session({
              session_id: args.session_id,
              agent_scope: args.agent_scope,
              limit: args.limit,
              include_boundaries: args.include_boundaries,
            })
            if (!snapshot.session_found) {
              return {
                title: "History session: session not found",
                output: `No session with id ${args.session_id}.`,
                metadata: { count: 0, session_found: false, checkpoint_found: false },
              }
            }
            const lines = [
              `Session ${snapshot.session_id}:`,
              `- session_found: ${snapshot.session_found}`,
              `- checkpoint_found: ${snapshot.checkpoint_found}`,
              `- messages: ${snapshot.messages.length}`,
              "",
            ]
            for (const m of snapshot.messages) {
              lines.push(`### ${m.message_id} (${m.role})`)
              lines.push(`Time: ${new Date(m.time_created).toISOString()}`)
              for (const p of m.parts) {
                const head = p.tool_name ? `${p.role} · ${p.type} (${p.tool_name})` : `${p.role} · ${p.type}`
                lines.push(`  ${head}:`)
                lines.push(p.text.split("\n").map((l) => `    ${l}`).join("\n"))
              }
              lines.push("")
            }
            return {
              title: `History session: ${snapshot.messages.length} messages`,
              output: lines.join("\n"),
              metadata: {
                count: snapshot.messages.length,
                session_found: snapshot.session_found,
                checkpoint_found: snapshot.checkpoint_found,
              },
            }
          }

          // operation=around
          if (!args.message_id) {
            return {
              title: "History around: missing message_id",
              output: "operation=around requires a `message_id` argument.",
              metadata: { count: 0 },
            }
          }
          const around = yield* history.around({
            message_id: args.message_id,
            before: args.before,
            after: args.after,
          })
          if (around.messages.length === 0) {
            return {
              title: "History around: anchor not found",
              output: `No message with id ${args.message_id}.`,
              metadata: { count: 0 },
            }
          }
          const lines = [
            `Session ${around.session_id}, ${around.messages.length} messages (anchor ${args.message_id}):`,
            "",
          ]
          for (const m of around.messages) {
            const prefix = m.matched ? ">>>" : "---"
            lines.push(`${prefix} ${m.message_id} (${new Date(m.time_created).toISOString()})`)
            for (const p of m.parts) {
              const head = p.tool_name ? `${p.type} (${p.tool_name})` : p.type
              lines.push(`  ${p.role} · ${head}:`)
              lines.push(p.text.split("\n").map((l) => `    ${l}`).join("\n"))
            }
            lines.push("")
          }
          const rawOutput = lines.join("\n")
          // around() output is naturally large; cap below the framework default
          // and let the truncation file fallback handle the overflow. The
          // metadata.truncated set here also opts us out of tool.ts wrap's
          // global truncate call (see tool.ts:110).
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(rawOutput, { maxBytes: AROUND_MAX_BYTES }, agent)
          return {
            title: `History around ${args.message_id}`,
            output: truncated.content,
            metadata: {
              count: around.messages.length,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputRef: truncated.outputRef }),
            },
          }
        }),
    }
    return definition
  }),
)
