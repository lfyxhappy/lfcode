import { Effect } from "effect"
import z from "zod"
import { Memory } from "@/memory"
import * as Session from "@/session/session"
import DESCRIPTION from "./memory.txt"
import * as Tool from "./tool"
import { completeCapabilityOperation, decideCapabilityOperation, requireCapabilityDecision } from "@/capability/gate"

const memoryParameters = z.object({
  operation: z.enum(["search", "write_project_record"]).default("search").describe("Memory operation to perform"),
  query: z.string().optional().describe("Search query (BM25 over markdown bodies)"),
  scope: z.enum(["global", "projects", "sessions", "cc"]).optional().describe("Filter by memory scope"),
  scope_id: z
    .string()
    .optional()
    .describe("Filter by scope id (e.g., session id, task id, project id hash)"),
  type: z
    .string()
    .optional()
    .describe("Filter by memory type (pinned, snapshot, learning, progress, free, ...)"),
  limit: z.number().optional().describe("Max results (default 10)"),
  key: z.string().optional().describe("Dream-only record key: MEMORY or MEMORY-<topic>"),
  body: z.string().optional().describe("Dream-only full Markdown body for the durable record"),
  summary: z.string().optional().describe("Dream-only concise record summary"),
  reason: z.string().min(1).optional().describe("Reason for reading memory; recorded for cross-project access."),
}).superRefine((value, ctx) => {
  if (value.operation === "search" && !value.query?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: "query is required for memory search" })
  }
  if (value.operation !== "write_project_record") return
  if (!value.key?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["key"], message: "key is required for Dream writes" })
  if (!value.body?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["body"], message: "body is required for Dream writes" })
})

const parameters = z.preprocess(normalizeLegacyMemoryArgs, memoryParameters)

type MemoryMetadata = {
  path?: string
  freshness?: string
  count?: number
  status?: "unavailable" | "empty" | "ok"
  reason?: "root-missing" | "index-empty" | "empty-query" | "no-match"
  capability?: Memory.MemoryCapability
}

function normalizeLegacyMemoryArgs(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const root = input as Record<string, unknown>
  const operationRecord = asRecord(root.operation)
  const nestedOperation = asRecord(operationRecord?.operation)
  const normalized = { ...root }
  const operation =
    normalizeOperationValue(root.operation) ??
    normalizeOperationValue(operationRecord?.action) ??
    normalizeOperationValue(operationRecord?.operation) ??
    normalizeOperationValue(nestedOperation?.action)
  if (operation) normalized.operation = operation
  const query =
    stringOrUndefined(root.query) ??
    stringOrUndefined(operationRecord?.query) ??
    stringOrUndefined(nestedOperation?.query)
  if (query) normalized.query = query
  return normalized
}

function normalizeOperationValue(input: unknown) {
  if (input === "search" || input === "write_project_record") return input
  const record = asRecord(input)
  if (!record) return undefined
  if ("search" in record) return "search"
  if ("write_project_record" in record) return "write_project_record"
  return undefined
}

function asRecord(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  return input as Record<string, unknown>
}

function stringOrUndefined(input: unknown) {
  return typeof input === "string" && input.length > 0 ? input : undefined
}

export const MemoryTool = Tool.define(
  "memory",
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const sessions = yield* Session.Service
    const definition: Tool.DefWithoutID<typeof parameters, MemoryMetadata> = {
      description: DESCRIPTION,
      parameters,
      execute: (args: z.infer<typeof memoryParameters>, ctx) =>
        Effect.gen(function* () {
          if (args.operation === "write_project_record") {
            if (ctx.agent !== "dream") throw new Error("Only the Dream consolidator can write durable memory records")
            const session = yield* sessions.get(ctx.sessionID)
            const record = yield* memory.writeProjectMemory({
              projectID: session.projectID,
              key: args.key ?? "",
              body: args.body ?? "",
              summary: args.summary,
            })
            return {
              title: "Dream memory record written",
              output: `Stored the canonical memory record and refreshed its Markdown projection: ${record.path}`,
              metadata: { path: record.path, freshness: record.freshness },
            }
          }
          const gate = decideCapabilityOperation({
            caller: "tool:memory",
            capability: "context_read",
            risk: "read",
            source: "core",
            operation: "read",
            previewed: true,
            reversible: true,
            target: args.scope_id ?? args.scope ?? "global-memory",
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            reason: args.reason ?? "Memory search",
          })
          requireCapabilityDecision(gate.decision)
          const results = yield* memory.search({
            query: args.query ?? "",
            scope: args.scope,
            scope_id: args.scope_id,
            type: args.type,
            limit: args.limit,
          })
          completeCapabilityOperation(gate.auditID, `completed (${results.results.length} matches)`, {
            scope: args.scope ?? "global",
            scopeID: args.scope_id,
            paths: results.results.map((item) => item.path),
          })
          if (results.status === "unavailable") {
            return {
              title: "Memory search unavailable",
              output: [
                `Memory is not currently usable for this instance.`,
                ``,
                results.reason === "root-missing"
                  ? `The memory root does not exist yet, so there is no local memory corpus to search.`
                  : results.reason === "index-empty"
                    ? `The memory root exists, but there are no indexed entries yet.`
                    : `The query was empty after normalization.`,
                `Do not keep retrying alternate keywords here unless you first create or sync actual memory content.`,
                `Use current repo files, logs, config, or conversation history instead.`,
              ].join("\n"),
              metadata: { count: 0, status: results.status, reason: results.reason, capability: results.capability },
            }
          }
          if (results.status === "empty") {
            return {
              title: `Memory search: 0 results`,
              output: [
                `No matches for "${args.query}".`,
                ``,
                `Memory is available, but this query did not hit anything indexed.`,
                `If retrying, use 1-2 distinctive identifiers only. Do not spam many near-duplicate keyword searches.`,
                `If you need exact wording or a literal token/path/URL, prefer the history tool or direct file/log inspection.`,
              ].join("\n"),
              metadata: { count: 0, status: results.status, reason: results.reason, capability: results.capability },
            }
          }
          const lines = [
            `Found ${results.results.length} match${results.results.length === 1 ? "" : "es"} (BM25-ranked, best first).`,
            `A hit here is authoritative — use it even if a parallel/sibling query returned nothing.`,
            `If you need the FULL body (snippets are truncated), Read the path.`,
            `If you need an EXACT literal (a connection string, port, token, full command line, path) and the snippet/body only paraphrases or partially shows it, the curated memory may have dropped the precise form — query the history tool for the original message, which holds it verbatim.`,
            ``,
          ]
          for (const r of results.results) {
            lines.push(`### ${r.path}`)
            lines.push(
              `Scope: ${r.scope}${r.scope_id ? `/${r.scope_id}` : ""}, Type: ${r.type}, Score: ${r.score.toFixed(3)}`,
            )
            lines.push(r.snippet)
            lines.push("")
          }
          return {
            title: `Memory search: ${results.results.length} result${results.results.length === 1 ? "" : "s"}`,
            output: lines.join("\n"),
            metadata: { count: results.results.length, status: results.status, capability: results.capability },
          }
        }),
    }
    return definition
  }),
)
