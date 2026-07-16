import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config"
import { createAppControlClient, ensureAppControlAccess } from "@/app-control/client"

const editorToken = z
  .enum(["filetab.active.editor", "messageblock.editor"])
  .describe("Which visible code editor to control.")

const editorCommandAction = z.enum([
  "save",
  "undo",
  "redo",
  "navigateBack",
  "navigateForward",
  "openCommandPalette",
  "openQuickOutline",
  "openFind",
  "openReplace",
  "findPrevious",
  "findNext",
  "openGoToLine",
  "openQuickFix",
  "renameSymbol",
  "showHover",
  "triggerSuggest",
  "triggerParameterHints",
  "openProblems",
  "nextProblem",
  "previousProblem",
  "organizeImports",
  "expandSelection",
  "shrinkSelection",
  "moveLineUp",
  "moveLineDown",
  "copyLineUp",
  "copyLineDown",
  "deleteLine",
  "addNextMatchToSelection",
  "duplicateSelection",
  "insertCursorAbove",
  "insertCursorBelow",
  "joinLines",
  "trimTrailingWhitespace",
  "toggleWordWrap",
  "foldCurrent",
  "unfoldCurrent",
  "foldAll",
  "unfoldAll",
  "peekDeclaration",
  "peekDefinition",
  "peekTypeDefinition",
  "peekImplementation",
  "peekReferences",
  "formatDocument",
  "formatSelection",
  "toggleLineComment",
  "toggleBlockComment",
])

const selection = z.object({
  startLineNumber: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLineNumber: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
})

const navigationTarget = z.object({
  id: z.string(),
  path: z.string(),
  label: z.string(),
  detail: z.string(),
  selection,
})

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
    action: z.literal("focus"),
  }),
  shared.extend({
    action: z.literal("run"),
    command: editorCommandAction.describe("Editor command to run through the shared ui.editor action surface."),
  }),
  shared.extend({
    action: z.literal("set_selection"),
    selection,
  }),
  shared.extend({
    action: z.literal("set_value"),
    text: z.string().describe("Full replacement text or appended text, depending on append."),
    append: z.boolean().optional().describe("Append to the current value instead of replacing it."),
  }),
  shared.extend({
    action: z.literal("open_navigation_target"),
    target: navigationTarget,
  }),
])

type Metadata = {
  token: z.infer<typeof editorToken>
  blockKey?: string
  windowID?: number
  append?: boolean
  action?: z.infer<typeof parameters>["action"]
  command?: z.infer<typeof editorCommandAction>
}

function buildEditorBody(args: z.infer<typeof parameters>) {
  return {
    windowID: args.window_id,
    token: args.token,
    blockKey: args.block_key,
  }
}

export const AppEditorActionTool = Tool.define<typeof parameters, Metadata, Config.Service>(
  "app_editor_action",
  Effect.gen(function* () {
    const config = yield* Config.Service
    return {
      description:
        "Control the visible in-app code editor: focus it, run shared editor commands, set the selection, write content, or jump to a normalized navigation target.",
      parameters,
      execute: (args: z.infer<typeof parameters>) =>
        Effect.gen(function* () {
          const current = yield* config.get()
          ensureAppControlAccess(current, "session_control")
          const client = yield* Effect.promise(() => createAppControlClient())
          if (args.action === "set_value") {
            yield* Effect.promise(() =>
              client.post("/ui/type", {
                ...buildEditorBody(args),
                text: args.text,
                append: args.append,
              }),
            )
            const result = yield* Effect.promise(() =>
              client.post("/ui/editor", {
                ...buildEditorBody(args),
                action: "getState",
              }),
            )
            return {
              title: "Updated app editor value",
              output: JSON.stringify(result, null, 2),
              metadata: {
                token: args.token,
                blockKey: args.block_key,
                windowID: args.window_id,
                append: args.append ?? false,
              },
            }
          }
          const result = yield* Effect.promise(() =>
            client.post("/ui/editor", {
              ...buildEditorBody(args),
              ...(args.action === "focus"
                ? { action: "focus" }
                : args.action === "run"
                  ? { action: args.command }
                  : args.action === "set_selection"
                    ? { action: "setSelection", selection: args.selection }
                    : { action: "openNavigationTarget", target: args.target }),
            }),
          )
          return {
            title:
              args.action === "focus"
                ? "Focused app editor"
                : args.action === "run"
                  ? `Ran editor command ${args.command}`
                  : args.action === "set_selection"
                    ? "Updated app editor selection"
                    : "Opened app editor navigation target",
            output: JSON.stringify(result, null, 2),
            metadata: {
              token: args.token,
              blockKey: args.block_key,
              windowID: args.window_id,
              action: args.action,
              ...(args.action === "run" ? { command: args.command } : {}),
            },
          }
        }),
    }
  }),
)
