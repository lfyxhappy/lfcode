import z from "zod"

export const appUiToken = z.enum([
  "composer.main.input",
  "composer.main.submit",
  "sidechat.active.input",
  "sidechat.active.submit",
  "filetab.active.panel",
  "filetab.active.editor",
  "filetab.active.mode.edit",
  "filetab.active.mode.preview",
  "filetab.active.mode.save",
  "messageblock.root",
  "messageblock.editor",
  "messageblock.mode.edit",
  "messageblock.mode.preview",
  "messageblock.mode.save",
  "messageblock.mode.reload",
  "messageblock.mode.open-sidebar",
  "messageblock.mode.bind-file",
])

export const appUiShared = z.object({
  token: appUiToken.describe("Stable UI token exposed by the desktop app automation driver."),
  block_key: z
    .string()
    .optional()
    .describe("Required when token points at a specific message code block and you want a stable target."),
  window_id: z.number().optional().describe("Optional desktop window ID. Defaults to the active window."),
})

export function buildAppUiBody(args: { token: z.infer<typeof appUiToken>; block_key?: string; window_id?: number }) {
  return {
    token: args.token,
    blockKey: args.block_key,
    windowID: args.window_id,
  }
}
