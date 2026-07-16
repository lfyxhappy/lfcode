import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app, BrowserWindow } from "electron"

export type DesktopAutomationWindow = {
  id: number
  title: string
  url: string
  focused: boolean
  visible: boolean
  minimized: boolean
  destroyed: boolean
  detached: boolean
  bounds: Electron.Rectangle
}

export function listAutomationWindows() {
  return BrowserWindow.getAllWindows()
    .filter((win) => !win.isDestroyed())
    .map(serializeWindow)
}

export function getAutomationWindow(windowID?: number) {
  if (windowID) {
    const exact = BrowserWindow.fromId(windowID)
    if (exact && !exact.isDestroyed()) return exact
  }
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  return BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && !isDetachedWindow(item))
}

export function serializeWindow(win: BrowserWindow): DesktopAutomationWindow {
  return {
    id: win.id,
    title: safe(() => win.getTitle()) ?? "",
    url: safe(() => win.webContents.getURL()) ?? "",
    focused: safe(() => win.isFocused()) ?? false,
    visible: safe(() => win.isVisible()) ?? false,
    minimized: safe(() => win.isMinimized()) ?? false,
    destroyed: win.isDestroyed(),
    detached: isDetachedWindow(win),
    bounds: safe(() => win.getBounds()) ?? { x: 0, y: 0, width: 0, height: 0 },
  }
}

export async function readRendererAutomationState(win: BrowserWindow) {
  return win.webContents.executeJavaScript(
    `(() => {
      const bridge = window.__LFCODE__?.automation
      if (!bridge?.getState) return null
      return bridge.getState()
    })()`,
    true,
  )
}

export async function callRendererAutomation<T>(win: BrowserWindow, action: string, input?: unknown) {
  return win.webContents.executeJavaScript(
    `(() => {
      const bridge = window.__LFCODE__?.automation
      if (!bridge?.call) throw new Error("Renderer automation bridge is not ready")
      const sanitize = (value) => {
        if (value === undefined) return null
        return JSON.parse(JSON.stringify(value))
      }
      return Promise.resolve(bridge.call(${JSON.stringify(action)}, ${JSON.stringify(input ?? null)})).then(sanitize)
    })()`,
    true,
  ) as Promise<T>
}

export async function captureAutomationWindow(win: BrowserWindow, label = "window") {
  const image = await win.webContents.capturePage()
  const outputDir = join(app.getPath("userData"), "output", "automation")
  await mkdir(outputDir, { recursive: true })
  const filename = `${label}-${Date.now()}-${win.id}.png`
  const path = join(outputDir, filename)
  await writeFile(path, image.toPNG())
  return path
}

function isDetachedWindow(win: BrowserWindow) {
  return safe(() => win.webContents.getURL())?.includes("detachedWindowID=") ?? false
}

function safe<T>(fn: () => T) {
  try {
    return fn()
  } catch {
    return undefined
  }
}
