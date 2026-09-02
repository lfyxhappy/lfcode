export const uiDriverTokenValues = [
  "settings.toggle",
  "settings.close",
  "settings.dialog",
  "settings.tab.editor",
  "settings.tab.personalization",
  "settings.tab.plugins",
  "settings.tab.app-control",
  "settings.tab.automation",
  "settings.tab.lan-access",
  "settings.tab.models",
  "settings.tab.usage",
  "settings.provider-quota",
  "settings.provider-quota-config",
  "sidebar.provider-quota",
  "sidebar.provider-quota.card",
  "settings.lan.status",
  "settings.lan.pairing",
  "settings.lan.create-pairing",
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
  "settings.models.add-provider",
  "provider.select.dialog",
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
  "project.sidebar.new-claude-code-session",
  "session.summary.toggle",
  "composer.main.input",
  "composer.main.submit",
  "claudeCode.model.menu",
  "claudeCode.permissions.menu",
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
] as const

export type UiDriverToken = (typeof uiDriverTokenValues)[number]

export const globalUiDriverTokens = [
  "settings.toggle",
  "settings.close",
  "settings.dialog",
  "settings.tab.editor",
  "settings.tab.personalization",
  "settings.tab.plugins",
  "settings.tab.app-control",
  "settings.tab.automation",
  "settings.tab.lan-access",
  "settings.tab.models",
  "settings.tab.usage",
  "settings.provider-quota",
  "settings.provider-quota-config",
  "sidebar.provider-quota",
  "sidebar.provider-quota.card",
  "settings.lan.status",
  "settings.lan.pairing",
  "settings.lan.create-pairing",
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
  "project.sidebar.new-claude-code-session",
] as const satisfies readonly UiDriverToken[]

export const appControlUiDriverTokens = [
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
] as const satisfies readonly UiDriverToken[]

export const automationSettingsUiDriverTokens = [
  "settings.automation.create",
  "settings.automation.refresh",
  "settings.automation.list",
] as const satisfies readonly UiDriverToken[]

export const modelsSettingsUiDriverTokens = [
  "settings.models.add-provider",
  "provider.select.dialog",
] as const satisfies readonly UiDriverToken[]

export const sessionUiDriverTokens = uiDriverTokenValues.filter(
  (token) =>
    !globalUiDriverTokens.includes(token as (typeof globalUiDriverTokens)[number]) &&
    !appControlUiDriverTokens.includes(token as (typeof appControlUiDriverTokens)[number]) &&
    !automationSettingsUiDriverTokens.includes(token as (typeof automationSettingsUiDriverTokens)[number]) &&
    !modelsSettingsUiDriverTokens.includes(token as (typeof modelsSettingsUiDriverTokens)[number]),
) as UiDriverToken[]

export type UiDriverOperation = "query" | "click" | "type" | "readText" | "wait" | "editor"

export type UiDriverCatalogEntry = {
  token: UiDriverToken
  available: boolean
  source?: string
  operations: UiDriverOperation[]
}

export type UiDriverNodeSnapshot = {
  token: UiDriverToken
  found: boolean
  visible: boolean
  focused?: boolean
  text?: string
  value?: string
  draftText?: string
  selectedTextCount?: number
  selectedTexts?: string[]
  dataset?: Record<string, string>
  title?: string
  ariaLabel?: string
  rect?: {
    x: number
    y: number
    width: number
    height: number
  }
  tagName?: string
}

export const SettingsTabUiDriverAction = {
  "settings.tab.editor": "settings-tab-editor",
  "settings.tab.personalization": "settings-tab-personalization",
  "settings.tab.plugins": "settings-tab-plugins",
  "settings.tab.app-control": "settings-tab-appControl",
  "settings.tab.automation": "settings-tab-automation",
  "settings.tab.lan-access": "settings-tab-lanAccess",
  "settings.tab.models": "settings-tab-models",
  "settings.tab.usage": "settings-tab-usage",
} as const

export type SettingsTabUiDriverToken = keyof typeof SettingsTabUiDriverAction

export function isSettingsTabUiDriverToken(token: UiDriverToken): token is SettingsTabUiDriverToken {
  return Object.hasOwn(SettingsTabUiDriverAction, token)
}

export function settingsTabUiDriverSelector(token: SettingsTabUiDriverToken) {
  return `[data-action="${SettingsTabUiDriverAction[token]}"]`
}

export function settingsTabUiDriverSelectors(token: SettingsTabUiDriverToken) {
  if (token === "settings.tab.plugins") return [`[data-action="sidebar-quick-plugins"]`, settingsTabUiDriverSelector(token)]
  if (token === "settings.tab.automation") return [`[data-action="sidebar-quick-scheduled"]`, settingsTabUiDriverSelector(token)]
  return [settingsTabUiDriverSelector(token)]
}

export const LanAccessSettingsUiDriverAction = {
  "settings.lan.status": "settings-lan-status",
  "settings.lan.pairing": "settings-lan-pairing",
  "settings.lan.create-pairing": "settings-lan-create-pairing",
} as const

export type LanAccessSettingsUiDriverToken = keyof typeof LanAccessSettingsUiDriverAction

export function isLanAccessSettingsUiDriverToken(token: UiDriverToken): token is LanAccessSettingsUiDriverToken {
  return Object.hasOwn(LanAccessSettingsUiDriverAction, token)
}

export function lanAccessSettingsUiDriverSelector(token: LanAccessSettingsUiDriverToken) {
  return `[data-action="${LanAccessSettingsUiDriverAction[token]}"]`
}

export function resolveLanAccessSettingsUiDriverElement(token: LanAccessSettingsUiDriverToken, root: ParentNode = document) {
  const element = root.querySelector(lanAccessSettingsUiDriverSelector(token))
  return element instanceof HTMLElement ? element : undefined
}

export const AppControlUiDriverAction = {
  "settings.app-control.save": "settings-app-control-save",
  "settings.app-control.enabled": "settings-app-control-enabled",
  "settings.app-control.permission": "settings-app-control-permission",
  "settings.app-control.browser.enabled": "settings-browser-control-enabled",
  "settings.app-control.browser.permission": "settings-browser-control-permission",
  "settings.app-control.metadata": "settings-app-control-metadata",
  "settings.app-control.refresh-events": "settings-app-control-refresh-events",
  "settings.app-control.events": "settings-app-control-events",
  "settings.app-control.capture-diagnostics": "settings-app-control-export-diagnostics",
  "settings.app-control.diagnostics": "settings-app-control-diagnostics",
  "settings.app-control.copy-diagnostics": "settings-app-control-copy-diagnostics",
} as const

export type AppControlUiDriverToken = keyof typeof AppControlUiDriverAction

export function isAppControlUiDriverToken(token: UiDriverToken): token is AppControlUiDriverToken {
  return Object.hasOwn(AppControlUiDriverAction, token)
}

export function appControlUiDriverSelector(token: AppControlUiDriverToken) {
  return `[data-action="${AppControlUiDriverAction[token]}"]`
}

export function resolveAppControlUiDriverElement(token: AppControlUiDriverToken, root: ParentNode = document) {
  const element = root.querySelector(appControlUiDriverSelector(token))
  return element instanceof HTMLElement ? element : undefined
}

export const AutomationSettingsUiDriverAction = {
  "settings.automation.create": "settings-automation-create",
  "settings.automation.refresh": "settings-automation-refresh",
  "settings.automation.list": "settings-automation-list",
} as const

export type AutomationSettingsUiDriverToken = keyof typeof AutomationSettingsUiDriverAction

export function isAutomationSettingsUiDriverToken(token: UiDriverToken): token is AutomationSettingsUiDriverToken {
  return Object.hasOwn(AutomationSettingsUiDriverAction, token)
}

export function automationSettingsUiDriverSelector(token: AutomationSettingsUiDriverToken) {
  return `[data-action="${AutomationSettingsUiDriverAction[token]}"]`
}

export function resolveAutomationSettingsUiDriverElement(token: AutomationSettingsUiDriverToken, root: ParentNode = document) {
  const element = root.querySelector(automationSettingsUiDriverSelector(token))
  return element instanceof HTMLElement ? element : undefined
}

export const AutomationDialogUiDriverAction = {
  "automation.dialog": "scheduled-automation-dialog",
  "automation.dialog.save": "scheduled-automation-save",
  "automation.dialog.target-kind": "scheduled-automation-target",
  "automation.dialog.target-id": "scheduled-automation-target-id",
  "automation.dialog.name": "scheduled-automation-name",
  "automation.dialog.timezone": "scheduled-automation-timezone",
  "automation.dialog.message": "scheduled-automation-message",
  "automation.dialog.schedule-kind": "scheduled-automation-schedule",
  "automation.dialog.once-at": "scheduled-automation-once-at",
  "automation.dialog.interval-minutes": "scheduled-automation-interval-minutes",
  "automation.dialog.hourly-minute": "scheduled-automation-hourly-minute",
  "automation.dialog.daily-hour": "scheduled-automation-daily-hour",
  "automation.dialog.daily-minute": "scheduled-automation-daily-minute",
  "automation.dialog.weekly-day": "scheduled-automation-weekly-day",
  "automation.dialog.weekly-hour": "scheduled-automation-weekly-hour",
  "automation.dialog.weekly-minute": "scheduled-automation-weekly-minute",
  "automation.dialog.cron": "scheduled-automation-cron",
  "automation.dialog.agent": "scheduled-automation-agent",
  "automation.dialog.model-provider": "scheduled-automation-model-provider",
  "automation.dialog.model-id": "scheduled-automation-model-id",
  "automation.dialog.permission": "scheduled-automation-permission",
  "automation.dialog.notifications": "scheduled-automation-notifications",
  "automation.dialog.preview": "scheduled-automation-preview",
} as const

export type AutomationDialogUiDriverToken = keyof typeof AutomationDialogUiDriverAction

export function isAutomationDialogUiDriverToken(token: UiDriverToken): token is AutomationDialogUiDriverToken {
  return Object.hasOwn(AutomationDialogUiDriverAction, token)
}

export function automationDialogUiDriverSelector(token: AutomationDialogUiDriverToken) {
  return `[data-action="${AutomationDialogUiDriverAction[token]}"]`
}

export function resolveAutomationDialogUiDriverElement(token: AutomationDialogUiDriverToken, root: ParentNode = document) {
  const element = root.querySelector(automationDialogUiDriverSelector(token))
  return element instanceof HTMLElement ? element : undefined
}

export function snapshotUiDriverElement(token: UiDriverToken, element?: HTMLElement): UiDriverNodeSnapshot {
  if (!element) {
    return {
      token,
      found: false,
      visible: false,
    }
  }
  const rect = element.getBoundingClientRect()
  return {
    token,
    found: true,
    visible: !!(element.offsetParent || element.getClientRects().length > 0),
    focused: element === document.activeElement || element.contains(document.activeElement),
    text: element.textContent ?? "",
    value:
      "value" in element && typeof (element as HTMLInputElement | HTMLTextAreaElement).value === "string"
        ? (element as HTMLInputElement | HTMLTextAreaElement).value
        : undefined,
    dataset: Object.fromEntries(
      Object.entries(element.dataset).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    title: element.title || undefined,
    ariaLabel: element.getAttribute("aria-label") ?? undefined,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    tagName: element.tagName,
  }
}

export type UiDriverQueryInput = {
  token: UiDriverToken
  blockKey?: string
}

export type UiDriverTypeInput = UiDriverQueryInput & {
  text: string
  append?: boolean
}

export type UiDriverReadTextInput = UiDriverQueryInput

export type UiDriverWaitInput = UiDriverQueryInput & {
  timeoutMs?: number
  intervalMs?: number
  visible?: boolean
}

export type UiDriverEditorCommandAction =
  | "save"
  | "undo"
  | "redo"
  | "navigateBack"
  | "navigateForward"
  | "openCommandPalette"
  | "openQuickOutline"
  | "openFind"
  | "openReplace"
  | "findPrevious"
  | "findNext"
  | "openGoToLine"
  | "openQuickFix"
  | "renameSymbol"
  | "showHover"
  | "triggerSuggest"
  | "triggerParameterHints"
  | "openProblems"
  | "nextProblem"
  | "previousProblem"
  | "organizeImports"
  | "expandSelection"
  | "shrinkSelection"
  | "moveLineUp"
  | "moveLineDown"
  | "copyLineUp"
  | "copyLineDown"
  | "deleteLine"
  | "addNextMatchToSelection"
  | "duplicateSelection"
  | "insertCursorAbove"
  | "insertCursorBelow"
  | "joinLines"
  | "trimTrailingWhitespace"
  | "toggleWordWrap"
  | "foldCurrent"
  | "unfoldCurrent"
  | "foldAll"
  | "unfoldAll"
  | "peekDeclaration"
  | "peekDefinition"
  | "peekTypeDefinition"
  | "peekImplementation"
  | "peekReferences"
  | "formatDocument"
  | "formatSelection"
  | "toggleLineComment"
  | "toggleBlockComment"

export type UiDriverEditorQueryAction =
  | "getHover"
  | "getDocumentSymbols"
  | "getIncomingCalls"
  | "getOutgoingCalls"
  | "getDeclarations"
  | "getDefinitions"
  | "getTypeDefinitions"
  | "getImplementations"
  | "getReferences"
  | "getDocumentHighlights"

export type UiDriverEditorInput =
  | (UiDriverQueryInput & {
      // `focus` is retained as a non-preemptive alias for `reveal`.
      action: "getState" | "focus" | "reveal" | UiDriverEditorCommandAction | UiDriverEditorQueryAction
    })
  | (UiDriverQueryInput & {
      action: "setSelection"
      selection: LfcodeCodeEditorAutomationSelection
    })
  | (UiDriverQueryInput & {
      action: "getWorkspaceSymbols"
      query: string
    })
  | (UiDriverQueryInput & {
      action: "openNavigationTarget"
      target: LfcodeCodeEditorAutomationNavigationTarget
    })
  | (UiDriverQueryInput & {
      action: "inspectLanguage"
      inspect: {
        kind:
          | "hover"
          | "completion"
          | "signatureHelp"
          | "declaration"
          | "definition"
          | "references"
          | "typeDefinition"
          | "implementation"
          | "documentHighlights"
          | "documentSymbols"
          | "incomingCalls"
          | "outgoingCalls"
        position?: {
          lineNumber: number
          column: number
        }
        triggerCharacter?: string
        maxItems?: number
      }
    })
