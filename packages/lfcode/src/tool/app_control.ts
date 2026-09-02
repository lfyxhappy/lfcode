import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"

export const AppControlToolID = "app_control"

const operation = z.enum([
  "get_state",
  "editor_action",
  "editor_query",
  "filetab_query",
  "filetab_action",
  "ui_action",
  "ui_query",
  "dom",
  "list_windows",
  "get_events",
  "get_automation_status",
  "wait_for_event",
  "capture_window",
  "capture_diagnostics_bundle",
  "open_route",
  "open_session",
  "open_side_chat",
  "focus_side_chat",
  "close_side_chat",
  "set_input",
  "append_input",
  "send",
  "wait_for_state",
])

const parameters = z.object({
  operation: operation.describe("Stable App Control operation to run."),
  input: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Operation-specific arguments. Use the fields documented for the selected operation."),
})

type Operation = z.infer<typeof operation>
type Targets = Record<Operation, Tool.Def>

export function AppControlTool(targets: Targets) {
  return Tool.defineStatic(AppControlToolID, parameters, {
    description: [
      "Control the local Lfcode desktop app through one App Control entrypoint. This does not use mouse, keyboard, focus, or screen-coordinate injection.",
      "Choose operation, then put that operation's exact arguments in input. App Control permissions are evaluated by the same underlying operation used before consolidation.",
      "State and diagnostics: get_state, list_windows, get_events, get_automation_status, wait_for_event, capture_window, capture_diagnostics_bundle, wait_for_state.",
      "Application and editor UI is accessed through app_control operations: editor_action, editor_query, filetab_query, filetab_action, ui_action, ui_query, and dom. These are operation values, not separate tools.",
      "Session and composer: open_route, open_session, open_side_chat, focus_side_chat, close_side_chat, set_input, append_input, send.",
      "Use browser for built-in browser pages and browser-specific diagnostics or interactions.",
    ].join("\n"),
    execute: (args, ctx) => targets[args.operation].execute(args.input, ctx),
  })
}
