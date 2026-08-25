import z from "zod"

export const appUiToken = z.enum([
  "settings.toggle",
  "settings.dialog",
  "settings.tab.editor",
  "settings.tab.plugins",
  "settings.tab.app-control",
  "settings.tab.automation",
  "settings.app-control.save",
  "settings.app-control.enabled",
  "settings.app-control.permission",
  "settings.app-control.browser.enabled",
  "settings.app-control.browser.permission",
  "settings.app-control.metadata",
  "settings.app-control.refresh-events",
  "settings.app-control.events",
  "settings.app-control.capture-diagnostics",
  "settings.app-control.diagnostics",
  "settings.app-control.copy-diagnostics",
  "settings.automation.create",
  "settings.automation.refresh",
  "settings.automation.list",
  "automation.dialog",
  "automation.dialog.save",
  "automation.dialog.target-kind",
  "automation.dialog.target-id",
  "automation.dialog.name",
  "automation.dialog.timezone",
  "automation.dialog.message",
  "automation.dialog.schedule-kind",
  "automation.dialog.once-at",
  "automation.dialog.interval-minutes",
  "automation.dialog.hourly-minute",
  "automation.dialog.daily-hour",
  "automation.dialog.daily-minute",
  "automation.dialog.weekly-day",
  "automation.dialog.weekly-hour",
  "automation.dialog.weekly-minute",
  "automation.dialog.cron",
  "automation.dialog.agent",
  "automation.dialog.model-provider",
  "automation.dialog.model-id",
  "automation.dialog.permission",
  "automation.dialog.notifications",
  "automation.dialog.preview",
  "project.sidebar.menu",
  "project.sidebar.new-automation",
  "project.sidebar.new-temporary-session",
  "session.summary.toggle",
  "composer.main.input",
  "composer.main.submit",
  "prompt.schedule-automation",
  "sidechat.active.input",
  "sidechat.active.submit",
  "filetab.active.panel",
  "filetab.active.editor",
  "filetab.active.mode.edit",
  "filetab.active.mode.preview",
  "filetab.active.mode.save",
  "filetab.active.command-menu",
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

export const appUiWriteShared = appUiShared.extend({
  window_id: z.number().describe("Explicit desktop window ID for this write action. Read app_list_windows or app_ui_query first."),
})

export function buildAppUiBody(args: { token: z.infer<typeof appUiToken>; block_key?: string; window_id?: number }) {
  return {
    token: args.token,
    blockKey: args.block_key,
    windowID: args.window_id,
  }
}
