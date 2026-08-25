import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const editorToken = z
  .enum(["filetab.active.editor", "messageblock.editor"])
  .describe("Which visible code editor to query.")

const shared = z.object({
  token: editorToken,
  block_key: z
    .string()
    .optional()
    .describe("Required when token=messageblock.editor and you want a specific message code block."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

const parameters = z.union([
  shared.extend({
    action: z
      .enum([
        "hover",
        "document_symbols",
        "incoming_calls",
        "outgoing_calls",
        "declarations",
        "definitions",
        "type_definitions",
        "implementations",
        "references",
        "document_highlights",
      ])
      .describe("Structured editor query to run against the selected code editor."),
  }),
  shared.extend({
    action: z.literal("workspace_symbols"),
    query: z.string().min(1).describe("Search text for workspace symbol lookup."),
  }),
])

function resolveEditorAction(action: z.infer<typeof parameters>["action"]) {
  if (action === "hover") return "getHover"
  if (action === "document_symbols") return "getDocumentSymbols"
  if (action === "workspace_symbols") return "getWorkspaceSymbols"
  if (action === "incoming_calls") return "getIncomingCalls"
  if (action === "outgoing_calls") return "getOutgoingCalls"
  if (action === "declarations") return "getDeclarations"
  if (action === "definitions") return "getDefinitions"
  if (action === "type_definitions") return "getTypeDefinitions"
  if (action === "implementations") return "getImplementations"
  if (action === "references") return "getReferences"
  return "getDocumentHighlights"
}

export const AppEditorQueryTool = Tool.define(
  "app_editor_query",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Run a structured query against the visible in-app code editor and return normalized hover, symbol, reference, or call-hierarchy results.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.getGlobal()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() =>
            client.post("/ui/editor", {
              windowID: args.window_id,
              token: args.token,
              blockKey: args.block_key,
              action: resolveEditorAction(args.action),
              ...(args.action === "workspace_symbols" ? { query: args.query } : {}),
            }),
          )
          return {
            title: `Queried editor ${args.action}`,
            output: JSON.stringify(result, null, 2),
            metadata: {
              token: args.token,
              blockKey: args.block_key,
              windowID: args.window_id,
              action: args.action,
            },
          }
        }),
    }
  }),
)
