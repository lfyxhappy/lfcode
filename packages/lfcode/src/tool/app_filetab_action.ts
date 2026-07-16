import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const selection = z.object({
  startLineNumber: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLineNumber: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
})

const shared = z.object({
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

const parameters = z.union([
  shared.extend({
    action: z.literal("focus"),
    tab: z.string().optional().describe("Existing file tab ID to focus."),
    path: z.string().optional().describe("Path to derive the file tab from when tab is omitted."),
  }),
  shared.extend({
    action: z.literal("open_path"),
    path: z.string().describe("Absolute or workspace-relative file path to open."),
    selection: selection.optional().describe("Optional initial selection to reveal after opening."),
  }),
  shared.extend({
    action: z.literal("set_mode"),
    mode: z.enum(["edit", "preview"]).describe("Target mode for the active file tab."),
  }),
  shared.extend({
    action: z.literal("set_text"),
    text: z.string().describe("Full replacement text or appended text, depending on append."),
    append: z.boolean().optional().describe("Append to the current text instead of replacing it."),
  }),
])

function buildBody(args: z.infer<typeof parameters>) {
  return {
    windowID: args.window_id,
  }
}

export const AppFiletabActionTool = Tool.define(
  "app_filetab_action",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Control file tabs in the local desktop app: focus an existing tab, open a path into the review/editor panel, switch edit/preview mode, or replace the active tab text.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "session_control")
          const client = yield* Effect.promise(() => createAppControlClient())
          const result = yield* Effect.promise(() => {
            if (args.action === "focus") {
              return client.post("/filetab/focus", {
                ...buildBody(args),
                tab: args.tab,
                path: args.path,
              })
            }
            if (args.action === "open_path") {
              return client.post("/filetab/open-path", {
                ...buildBody(args),
                path: args.path,
                selection: args.selection,
              })
            }
            if (args.action === "set_mode") {
              return client.post("/filetab/mode", {
                ...buildBody(args),
                mode: args.mode,
              })
            }
            return client.post("/filetab/text", {
              ...buildBody(args),
              text: args.text,
              append: args.append,
            })
          })
          return {
            title:
              args.action === "focus"
                ? "Focused file tab"
                : args.action === "open_path"
                  ? "Opened file tab path"
                  : args.action === "set_mode"
                    ? `Switched file tab to ${args.mode}`
                    : "Updated file tab text",
            output: JSON.stringify(result, null, 2),
            metadata: {
              windowID: args.window_id,
              action: args.action,
            },
          }
        }),
    }
  }),
)
