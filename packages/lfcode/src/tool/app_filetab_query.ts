import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const parameters = z.object({
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
  include_tabs: z
    .boolean()
    .optional()
    .describe("Include the current session tab list. Off by default to keep output compact."),
  include_editor_value: z
    .boolean()
    .optional()
    .describe("Include the full active editor text. Off by default to avoid large payloads."),
})

export const AppFiletabQueryTool = Tool.define(
  "app_filetab_query",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Read the current active file tab state from the local desktop app, including path, load state, mode, and editor metadata. Optionally include the tab list or full editor text.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "read_only")
          const client = yield* Effect.promise(() => createAppControlClient())
          const query = args.window_id ? `?windowID=${args.window_id}` : ""
          const result = yield* Effect.promise(() => client.get(`/diagnostics/ui-state${query}`))
          const state = result && typeof result === "object" && "state" in result ? (result as Record<string, unknown>).state : undefined
          const session = state && typeof state === "object" && "session" in state ? (state as Record<string, unknown>).session : undefined
          const sessionRecord = session && typeof session === "object" ? (session as Record<string, unknown>) : {}
          const output = {
            window: result && typeof result === "object" && "window" in result ? (result as Record<string, unknown>).window : null,
            sessionID: sessionRecord.sessionID ?? null,
            directory: sessionRecord.directory ?? null,
            fileTabSummary: sessionRecord.fileTabSummary ?? null,
            fileTab: sanitizeFileTab(sessionRecord.fileTab, args.include_editor_value === true),
            ...(args.include_tabs === true ? { tabs: sessionRecord.tabs ?? null } : {}),
          }
          return {
            title: "Read active file tab state",
            output: JSON.stringify(output, null, 2),
            metadata: {
              windowID: args.window_id,
              includeTabs: args.include_tabs ?? false,
              includeEditorValue: args.include_editor_value ?? false,
            },
          }
        }),
    }
  }),
)

function sanitizeFileTab(input: unknown, includeEditorValue: boolean) {
  if (!input || typeof input !== "object") return null
  const fileTab = input as Record<string, unknown>
  const editor = fileTab.editor
  if (includeEditorValue || !editor || typeof editor !== "object") return fileTab
  const editorRecord = { ...(editor as Record<string, unknown>) }
  if (typeof editorRecord.value === "string") {
    const value = editorRecord.value
    delete editorRecord.value
    editorRecord.hasValue = true
    editorRecord.valueLength = value.length
    editorRecord.lineCount = countLines(value)
  }
  return {
    ...fileTab,
    editor: editorRecord,
  }
}

function countLines(value: string) {
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).length
}
