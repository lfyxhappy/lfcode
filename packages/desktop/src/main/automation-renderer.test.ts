import { createContext, runInContext } from "node:vm"
import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"

mock.module("electron", () => ({
  app: { getPath: () => "" },
  clipboard: { readText: () => "", writeText: () => undefined },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  BrowserWindow: {
    fromId: () => undefined,
    getAllWindows: () => [],
    getFocusedWindow: () => undefined,
  },
  session: {},
  webContents: {},
}))

const { actAutomationDom, snapshotAutomationDom } = await import("./automation-renderer")

describe("renderer DOM automation protocol", () => {
  test("versions segmented snapshots and performs idempotent target-state actions", async () => {
    const page = new Window()
    Object.assign(page, { SyntaxError })
    page.document.body.innerHTML = `
      <section id="panel">
        <button id="first">First</button>
        <input id="enabled" type="checkbox" />
        <details id="details"><summary>Details</summary><p>Body</p></details>
        <select id="choice"><option value="one">One</option><option value="two">Two</option></select>
        <button id="aria-switch" role="switch" aria-checked="false">Automation switch</button>
      </section>
    `
    const win = automationWindow(page).win

    const segment = await snapshotAutomationDom(win, {
      region: "#panel",
      selector: "button, input, details, select",
      offset: 1,
      limit: 1,
    })
    expect(segment).toMatchObject({
      snapshotID: expect.stringMatching(/^s[a-z0-9]+-[a-z0-9]+$/),
      revision: 0,
      region: "#panel",
      offset: 1,
      limit: 1,
      total: 5,
      nextOffset: 2,
    })
    expect(segment.children).toHaveLength(1)
    expect(segment.children[0]?.id).toBe("enabled")

    const checkbox = segment.children[0]
    if (!checkbox) throw new Error("Expected checkbox snapshot node")
    const checked = await actAutomationDom(win, {
      action: "setChecked",
      ref: checkbox.ref,
      fingerprint: checkbox.fingerprint,
      snapshotID: segment.snapshotID,
      checked: true,
    })
    expect(checked).toMatchObject({ action: "setChecked", changed: true, target: true, revision: 1 })
    expect(page.document.querySelector<HTMLInputElement>("#enabled")?.checked).toBe(true)

    const current = await snapshotAutomationDom(win, { region: "#panel", selector: "details", limit: 1 })
    const details = current.children[0]
    if (!details) throw new Error("Expected details snapshot node")
    const expanded = await actAutomationDom(win, {
      action: "setExpanded",
      ref: details.ref,
      fingerprint: details.fingerprint,
      snapshotID: current.snapshotID,
      expanded: true,
    })
    expect(expanded).toMatchObject({ action: "setExpanded", changed: true, target: true })
    expect(page.document.querySelector<HTMLDetailsElement>("#details")?.open).toBe(true)

    const optionSnapshot = await snapshotAutomationDom(win, { region: "#panel", selector: "option", limit: 1 })
    const option = optionSnapshot.children[0]
    if (!option) throw new Error("Expected option snapshot node")
    const selected = await actAutomationDom(win, {
      action: "setSelected",
      ref: option.ref,
      fingerprint: option.fingerprint,
      snapshotID: optionSnapshot.snapshotID,
      selected: true,
    })
    expect(selected).toMatchObject({ action: "setSelected", changed: false, target: true })

    const stale = await snapshotAutomationDom(win, { region: "#panel", selector: "select", limit: 1 })
    const select = stale.children[0]
    if (!select) throw new Error("Expected select snapshot node")
    await expect(
      actAutomationDom(win, {
        action: "setSelected",
        ref: select.ref,
        fingerprint: select.fingerprint,
        snapshotID: "s-missing",
        selected: true,
      }),
    ).rejects.toMatchObject({ code: "stale_dom_snapshot" })

    const legacy = await actAutomationDom(win, {
      action: "select",
      ref: select.ref,
      fingerprint: select.fingerprint,
      value: "two",
    })
    expect(legacy).toMatchObject({ action: "select", changed: true, selected: "two" })
    expect(page.document.querySelector<HTMLSelectElement>("#choice")?.value).toBe("two")

    const ariaSwitch = page.document.querySelector<HTMLButtonElement>("#aria-switch")
    ariaSwitch?.addEventListener("click", () => ariaSwitch.setAttribute("aria-checked", "true"))
    const ariaSnapshot = await snapshotAutomationDom(win, { region: "#panel", selector: "#aria-switch", limit: 1 })
    const ariaNode = ariaSnapshot.children[0]
    if (!ariaNode) throw new Error("Expected ARIA switch snapshot node")
    const ariaChecked = await actAutomationDom(win, {
      action: "setChecked",
      ref: ariaNode.ref,
      fingerprint: ariaNode.fingerprint,
      snapshotID: ariaSnapshot.snapshotID,
      checked: true,
    })
    expect(ariaChecked).toMatchObject({ action: "setChecked", changed: true, target: true })
    expect(ariaSwitch?.getAttribute("aria-checked")).toBe("true")

    page.close()
  })

  test("rejects an old snapshot after navigation when the new page has the same structure", async () => {
    const first = fixturePage()
    const browser = automationWindow(first)
    const snapshot = await snapshotAutomationDom(browser.win, { region: "#panel", selector: "button", limit: 1 })
    const button = snapshot.children[0]
    if (!button) throw new Error("Expected button snapshot node")

    const second = fixturePage()
    browser.navigate(second)
    const replacement = await snapshotAutomationDom(browser.win, { region: "#panel", selector: "button", limit: 1 })
    expect(replacement.snapshotID).not.toBe(snapshot.snapshotID)
    expect(replacement.children[0]).toMatchObject({ ref: button.ref, fingerprint: button.fingerprint })

    await expect(
      actAutomationDom(browser.win, {
        action: "click",
        ref: button.ref,
        fingerprint: button.fingerprint,
        snapshotID: snapshot.snapshotID,
      }),
    ).rejects.toMatchObject({ code: "stale_dom_snapshot" })
    expect(second.document.querySelector<HTMLButtonElement>("#run")?.textContent).toBe("Run")

    first.close()
    second.close()
  })
})

function fixturePage() {
  const page = new Window()
  Object.assign(page, { SyntaxError })
  page.document.body.innerHTML = `<section id="panel"><button id="run">Run</button></section>`
  return page
}

function automationWindow(page: Window) {
  let context = automationContext(page)
  return {
    win: {
      webContents: {
        executeJavaScript: async (script: string) => runInContext(script, context),
      },
    } as never,
    navigate: (next: Window) => {
      context = automationContext(next)
    },
  }
}

function automationContext(page: Window) {
  return createContext({
    window: page,
    document: page.document,
    Element: page.Element,
    Event: page.Event,
    HTMLButtonElement: page.HTMLButtonElement,
    HTMLDetailsElement: page.HTMLDetailsElement,
    HTMLElement: page.HTMLElement,
    HTMLInputElement: page.HTMLInputElement,
    HTMLOptionElement: page.HTMLOptionElement,
    HTMLSelectElement: page.HTMLSelectElement,
    HTMLTextAreaElement: page.HTMLTextAreaElement,
    InputEvent: page.InputEvent,
    MutationObserver: page.MutationObserver,
    getComputedStyle: page.getComputedStyle.bind(page),
  })
}
