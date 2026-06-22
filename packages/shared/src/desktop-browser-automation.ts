const desktopBrowserAutomationKey = Symbol.for("lfcode.desktop-browser-automation")

export type DesktopBrowserAutomationTarget = {
  sourceWindowID: number
  tabID: string
  url: string
  title: string
}

export type DesktopBrowserAutomationElement = {
  ref: string
  selector: string
  tag: string
  role?: string
  text?: string
  placeholder?: string
  value?: string
  href?: string
  disabled: boolean
  checked: boolean
  focused: boolean
}

export type DesktopBrowserAutomationSnapshot = {
  target: DesktopBrowserAutomationTarget
  elements: DesktopBrowserAutomationElement[]
  text: string
}

export type DesktopBrowserAutomationWaitResult = {
  matched: boolean
  target: DesktopBrowserAutomationTarget
}

export interface DesktopBrowserAutomationBridge {
  getActiveTarget(): DesktopBrowserAutomationTarget | undefined
  navigate(input: { url: string }): Promise<DesktopBrowserAutomationTarget>
  snapshot(): Promise<DesktopBrowserAutomationSnapshot>
  click(input: { ref: string }): Promise<DesktopBrowserAutomationTarget>
  type(input: { ref: string; text: string; submit?: boolean }): Promise<DesktopBrowserAutomationTarget>
  pressKey(input: { key: string }): Promise<DesktopBrowserAutomationTarget>
  waitFor(input: { text?: string; textGone?: string; timeMs?: number; timeoutMs?: number }): Promise<DesktopBrowserAutomationWaitResult>
}

type GlobalState = typeof globalThis & {
  [desktopBrowserAutomationKey]?: DesktopBrowserAutomationBridge
}

export function registerDesktopBrowserAutomationBridge(bridge: DesktopBrowserAutomationBridge) {
  ;(globalThis as GlobalState)[desktopBrowserAutomationKey] = bridge
}

export function getDesktopBrowserAutomationBridge() {
  return (globalThis as GlobalState)[desktopBrowserAutomationKey]
}
