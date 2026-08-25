import { afterEach, describe, expect, test } from "bun:test"
import {
  AppControlUiDriverAction,
  appControlUiDriverSelector,
  AutomationDialogUiDriverAction,
  automationDialogUiDriverSelector,
  isAutomationDialogUiDriverToken,
  resolveAutomationDialogUiDriverElement,
  isAppControlUiDriverToken,
  isLanAccessSettingsUiDriverToken,
  LanAccessSettingsUiDriverAction,
  lanAccessSettingsUiDriverSelector,
  resolveLanAccessSettingsUiDriverElement,
  resolveAppControlUiDriverElement,
  globalUiDriverTokens,
  sessionUiDriverTokens,
  SettingsTabUiDriverAction,
  settingsTabUiDriverSelector,
  snapshotUiDriverElement,
  uiDriverTokenValues,
  type AppControlUiDriverToken,
  type UiDriverEditorInput,
} from "./ui-driver"

afterEach(() => {
  document.body.replaceChildren()
})

describe("App Control UI driver", () => {
  test("keeps editor reveal available without requiring focus", () => {
    const input = {
      token: "filetab.active.editor",
      action: "reveal",
    } satisfies UiDriverEditorInput

    expect(input.action).toBe("reveal")
  })

  test("keeps renderer automation free of focus and pointer or keyboard injection", async () => {
    const session = await Bun.file(new URL("../pages/session.tsx", import.meta.url)).text()
    const uiClick = session.slice(session.indexOf("const uiClick"), session.indexOf("const uiType"))
    const automation = session.slice(session.indexOf("const submitAutomationPrompt"), session.indexOf("createEffect(() => {\n    window.__LFCODE__"))
    const host = await Bun.file(new URL("../components/code-editor/core/host.tsx", import.meta.url)).text()
    const editorAutomation = host.slice(host.indexOf("const automationHandle"), host.indexOf("const retryEditor"))

    expect(uiClick).not.toContain(".focus(")
    expect(uiClick).not.toContain("KeyboardEvent")
    expect(uiClick).not.toContain("MouseEvent")
    expect(uiClick).not.toContain("PointerEvent")
    expect(automation).not.toContain(".focus(")
    expect(editorAutomation).not.toContain("editor.focus()")
    expect(editorAutomation).toContain("runAction: (actionID) => runEditorAction(actionID, { focus: false })")
  })

  test("maps settings tab tokens to their concrete action names", () => {
    expect(settingsTabUiDriverSelector("settings.tab.editor")).toBe(
      `[data-action="${SettingsTabUiDriverAction["settings.tab.editor"]}"]`,
    )
    expect(settingsTabUiDriverSelector("settings.tab.personalization")).toBe(
      `[data-action="${SettingsTabUiDriverAction["settings.tab.personalization"]}"]`,
    )
    expect(settingsTabUiDriverSelector("settings.tab.plugins")).toBe(
      `[data-action="${SettingsTabUiDriverAction["settings.tab.plugins"]}"]`,
    )
    expect(settingsTabUiDriverSelector("settings.tab.app-control")).toBe(
      '[data-action="settings-tab-appControl"]',
    )
    expect(settingsTabUiDriverSelector("settings.tab.lan-access")).toBe(
      '[data-action="settings-tab-lanAccess"]',
    )
    expect(settingsTabUiDriverSelector("settings.tab.models")).toBe('[data-action="settings-tab-models"]')
    expect(settingsTabUiDriverSelector("settings.tab.usage")).toBe('[data-action="settings-tab-usage"]')
  })

  test("publishes stable automation entry and dialog tokens", () => {
    expect(uiDriverTokenValues).toContain("prompt.schedule-automation")
    expect(globalUiDriverTokens).toEqual(expect.arrayContaining([
      "settings.close",
      "project.sidebar.new-automation",
      "automation.dialog",
      "automation.dialog.save",
      "automation.dialog.name",
      "automation.dialog.once-at",
      "automation.dialog.model-id",
      "settings.tab.models",
      "settings.tab.usage",
      "settings.provider-quota",
      "settings.provider-quota-config",
    ]))
  })

  test("distinguishes provider quota viewing and configuration actions", () => {
    const root = document.createElement("div")
    const view = document.createElement("button")
    view.dataset.action = "settings-provider-quota-minimax"
    const configure = document.createElement("button")
    configure.dataset.action = "settings-provider-quota-config-minimax"
    root.append(view, configure)

    expect(root.querySelector('[data-action^="settings-provider-quota-"]:not([data-action^="settings-provider-quota-config-"])')).toBe(view)
    expect(root.querySelector('[data-action^="settings-provider-quota-config-"]')).toBe(configure)
  })

  test("maps automation dialog fields to stable selectors", () => {
    const root = document.createElement("div")
    for (const [value, action] of Object.entries(AutomationDialogUiDriverAction)) {
      const token = value as keyof typeof AutomationDialogUiDriverAction
      const element = document.createElement(token.endsWith("message") ? "textarea" : "input")
      element.dataset.action = action
      root.append(element)
      expect(isAutomationDialogUiDriverToken(token)).toBe(true)
      expect(automationDialogUiDriverSelector(token)).toBe(`[data-action="${action}"]`)
      expect(resolveAutomationDialogUiDriverElement(token, root)).toBe(element)
    }
  })

  test("maps every App Control token to its stable action selector", () => {
    const root = document.createElement("div")

    for (const [value, action] of Object.entries(AppControlUiDriverAction)) {
      const token = value as AppControlUiDriverToken
      const element = document.createElement("button")
      element.dataset.action = action
      root.append(element)

      expect(appControlUiDriverSelector(token)).toBe(`[data-action="${action}"]`)
      expect(resolveAppControlUiDriverElement(token, root)).toBe(element)
      expect(isAppControlUiDriverToken(token)).toBe(true)
    }
  })

  test("maps LAN access controls to stable action selectors", () => {
    const root = document.createElement("div")

    for (const [value, action] of Object.entries(LanAccessSettingsUiDriverAction)) {
      const token = value as keyof typeof LanAccessSettingsUiDriverAction
      const element = document.createElement("button")
      element.dataset.action = action
      root.append(element)

      expect(lanAccessSettingsUiDriverSelector(token)).toBe(`[data-action="${action}"]`)
      expect(resolveLanAccessSettingsUiDriverElement(token, root)).toBe(element)
      expect(isLanAccessSettingsUiDriverToken(token)).toBe(true)
    }
  })

  test("snapshots the element state and metadata", () => {
    const element = document.createElement("input")
    element.value = "current value"
    element.title = "Save settings"
    element.setAttribute("aria-label", "Save App Control settings")
    element.dataset.action = AppControlUiDriverAction["settings.app-control.save"]
    element.dataset.serviceDetected = "true"
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => ({ x: 4, y: 8, width: 120, height: 32 }),
    })
    Object.defineProperty(element, "getClientRects", {
      value: () => [{ x: 4, y: 8, width: 120, height: 32 }],
    })
    document.body.append(element)
    element.focus()

    expect(snapshotUiDriverElement("settings.app-control.save", element)).toEqual({
      token: "settings.app-control.save",
      found: true,
      visible: true,
      focused: true,
      text: "",
      value: "current value",
      dataset: {
        action: "settings-app-control-save",
        serviceDetected: "true",
      },
      title: "Save settings",
      ariaLabel: "Save App Control settings",
      rect: { x: 4, y: 8, width: 120, height: 32 },
      tagName: "INPUT",
    })
  })

  test("returns an explicit missing snapshot and rejects prototype keys", () => {
    expect(snapshotUiDriverElement("settings.app-control.events")).toEqual({
      token: "settings.app-control.events",
      found: false,
      visible: false,
    })
    expect(isAppControlUiDriverToken("constructor" as AppControlUiDriverToken)).toBe(false)
  })
})
