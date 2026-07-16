import { randomUUID } from "node:crypto"
import { createServer, type ServerResponse } from "node:http"
import { URL } from "node:url"
import { getDesktopBrowserAutomationBridge } from "@lfcode-ai/shared/desktop-browser-automation"
import {
  automationErrorResponse,
  automationRequestNeedsAuth,
  AutomationHttpError,
  createAutomationToken,
  isAutomationRequestAuthorized,
  isLoopbackAutomationHost,
  readAutomationRequestBody,
  requireAutomationCapability,
  validateAutomationRequestSource,
  type AutomationCapability,
} from "../automation-security"
import type { createAutomationEventBuffer } from "./automation-events"
import {
  callRendererAutomation,
  captureAutomationWindow,
  getAutomationWindow,
  listAutomationWindows,
  readRendererAutomationState,
  serializeWindow,
} from "./automation-renderer"
import { clearBrowserCache, getBrowserCacheOverview } from "./browser-runtime"

type Logger = {
  log: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
  warn?: (message: string, data?: unknown) => void
}

type AutomationEventBuffer = ReturnType<typeof createAutomationEventBuffer>

type Options = {
  enabled: boolean
  host?: string
  port?: number
  token?: string
  capability?: AutomationCapability
  logger: Logger
  events: AutomationEventBuffer
}

export async function startAutomationServer(input: Options) {
  if (!input.enabled) return
  const host = input.host ?? "127.0.0.1"
  if (!isLoopbackAutomationHost(host)) throw new Error("Desktop automation must bind to a loopback host")
  const token = input.token ?? createAutomationToken()
  const capability = input.capability ?? "full_app_control"
  const server = createServer(async (request, response) => {
    const requestID = randomUUID()
    const requestStartedAt = Date.now()
    const method = request.method ?? "GET"
    const requestPath = safeAutomationRequestPath(request.url)
    response.once("finish", () => {
      input.events.push({
        scope: "server",
        type: response.statusCode >= 400 ? "response.error" : "response",
        data: {
          requestID,
          method,
          path: requestPath,
          status: response.statusCode,
          durationMs: Date.now() - requestStartedAt,
        },
      })
    })
    input.events.push({
      scope: "server",
      type: "request",
      data: { requestID, method, path: requestPath },
    })
    try {
      const url = parseAutomationRequestURL(request.url)
      validateAutomationRequestSource(request.headers, automationServerPort(server, input.port))
      if (automationRequestNeedsAuth(method, url.pathname) && !isAutomationRequestAuthorized(request.headers, token)) {
        send(response, 401, requestID, { ok: false, error: "Unauthorized" })
        return
      }
      if (automationRequestNeedsAuth(method, url.pathname)) {
        requireAutomationCapability(capability, method, url.pathname)
      }
      const body = method === "POST" ? await readAutomationRequestBody(request) : undefined

      if (method === "GET" && url.pathname === "/health") {
        send(response, 200, requestID, {
          ok: true,
          data: {
            status: "ok",
          },
        })
        return
      }

      if (method === "GET" && url.pathname === "/windows") {
        send(response, 200, requestID, { ok: true, data: listAutomationWindows() })
        return
      }

      if (method === "GET" && url.pathname === "/diagnostics/events") {
        const limit = numberParam(url.searchParams.get("limit")) ?? 200
        send(response, 200, requestID, {
          ok: true,
          data: input.events.list({
            scope: stringParam(url.searchParams.get("scope")) as "main" | "renderer" | "server" | undefined,
            type: stringParam(url.searchParams.get("type")) ?? undefined,
            limit,
          }),
        })
        return
      }

      if (method === "GET" && url.pathname === "/diagnostics/ui-state") {
        const win = requireWindow(numberParam(url.searchParams.get("windowID")))
        const state = await readRendererAutomationState(win)
        send(response, 200, requestID, {
          ok: true,
          data: {
            window: serializeWindow(win),
            state,
          },
        })
        return
      }

      if (method === "POST" && url.pathname === "/capture/window") {
        const win = requireWindow(numberInput(body?.windowID))
        const path = await captureAutomationWindow(win, stringInput(body?.label) ?? "window")
        send(response, 200, requestID, {
          ok: true,
          data: {
            window: serializeWindow(win),
            path,
            state: await readRendererAutomationState(win),
          },
        })
        return
      }

      if (method === "POST" && url.pathname === "/window/focus") {
        const win = requireWindow(numberInput(body?.windowID))
        win.show()
        win.focus()
        send(response, 200, requestID, {
          ok: true,
          data: {
            window: serializeWindow(win),
          },
        })
        return
      }

      if (method === "POST" && url.pathname === "/window/type") {
        const win = requireWindow(numberInput(body?.windowID))
        const text = requiredString(body?.text, "text")
        win.show()
        win.focus()
        for (const character of text) {
          sendAutomationKey(win, character === "\n" ? "Enter" : character === "\t" ? "Tab" : character)
        }
        send(response, 200, requestID, {
          ok: true,
          data: {
            window: serializeWindow(win),
            length: text.length,
          },
        })
        return
      }

      if (method === "POST" && url.pathname === "/window/click") {
        const win = requireWindow(numberInput(body?.windowID))
        const x = requiredNumber(body?.x, "x")
        const y = requiredNumber(body?.y, "y")
        win.show()
        win.focus()
        win.webContents.focus()
        win.webContents.sendInputEvent({ type: "mouseMove", x, y })
        win.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 })
        win.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 })
        send(response, 200, requestID, {
          ok: true,
          data: {
            window: serializeWindow(win),
            x,
            y,
          },
        })
        return
      }

      if (method === "POST" && url.pathname === "/route/navigate") {
        const win = requireWindow(numberInput(body?.windowID))
        const route = requiredString(body?.route, "route")
        const result = await callRendererAutomation(win, "route.navigate", { route })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/session/open") {
        const win = requireWindow(numberInput(body?.windowID))
        const directory = requiredString(body?.directory, "directory")
        const sessionID = requiredString(body?.sessionID, "sessionID")
        const result = await callRendererAutomation(win, "session.open", { directory, sessionID })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/session/create") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "session.create", {
          title: stringInput(body?.title),
          open: body?.open !== false,
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/sidechat/create") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "sidechat.create", {
          text: stringInput(body?.text) ?? "",
          messageID: stringInput(body?.messageID),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/sidechat/open") {
        const win = requireWindow(numberInput(body?.windowID))
        const sessionID = requiredString(body?.sessionID, "sessionID")
        const result = await callRendererAutomation(win, "sidechat.open", { sessionID })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/sidechat/close") {
        const win = requireWindow(numberInput(body?.windowID))
        const sessionID = requiredString(body?.sessionID, "sessionID")
        const result = await callRendererAutomation(win, "sidechat.close", { sessionID })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/composer/set-text") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "composer.setText", {
          text: requiredString(body?.text, "text"),
          target: stringInput(body?.target) ?? "main",
          sessionID: stringInput(body?.sessionID),
          append: body?.append === true,
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/composer/submit") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "composer.submit", {
          target: stringInput(body?.target) ?? "main",
          sessionID: stringInput(body?.sessionID),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "GET" && url.pathname === "/timeline/state") {
        const win = requireWindow(numberParam(url.searchParams.get("windowID")))
        const result = await callRendererAutomation(win, "timeline.inspect")
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/timeline/scroll") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "timeline.scroll", {
          position: stringInput(body?.position),
          top: numberInput(body?.top),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/ui/query") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "ui.query", body)
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/ui/click") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "ui.click", body)
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/ui/type") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "ui.type", body)
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/ui/read-text") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "ui.readText", body)
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/ui/wait") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "ui.wait", body)
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/ui/editor") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "ui.editor", body)
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/open") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "browser.open", {
          url: requiredString(body?.url, "url"),
          title: stringInput(body?.title),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/focus-tab") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "browser.focusTab", {
          tabID: requiredString(body?.tabID, "tabID"),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/filetab/focus") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "filetab.focus", {
          tab: stringInput(body?.tab),
          path: stringInput(body?.path),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/filetab/mode") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "filetab.setMode", {
          mode: requiredString(body?.mode, "mode"),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/filetab/open-path") {
        const win = requireWindow(numberInput(body?.windowID))
        const selectionBody = objectInput(body?.selection)
        const result = await callRendererAutomation(win, "filetab.openPath", {
          path: requiredString(body?.path, "path"),
          selection: selectionBody
            ? {
                startLineNumber: numberInput(selectionBody.startLineNumber),
                startColumn: numberInput(selectionBody.startColumn),
                endLineNumber: numberInput(selectionBody.endLineNumber),
                endColumn: numberInput(selectionBody.endColumn),
              }
            : undefined,
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/filetab/text") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "filetab.setText", {
          text: requiredString(body?.text, "text"),
          append: body?.append === true,
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/filetab/save") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "filetab.save")
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "GET" && url.pathname === "/browser/target") {
        const sessionKey = requiredString(url.searchParams.get("sessionKey"), "sessionKey")
        const result = getDesktopBrowserAutomationBridge()?.getTarget({ sessionKey }) ?? null
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/snapshot") {
        const sessionKey = requiredString(body?.sessionKey, "sessionKey")
        const result = await requireBrowserBridge().snapshot({ sessionKey })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/screenshot") {
        const sessionKey = requiredString(body?.sessionKey, "sessionKey")
        const result = await requireBrowserBridge().screenshot({ sessionKey })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/read-page") {
        const sessionKey = requiredString(body?.sessionKey, "sessionKey")
        const result = await requireBrowserBridge().readPage({ sessionKey })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/extract-resource") {
        const result = await requireBrowserBridge().extractResource({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/capture-element") {
        const result = await requireBrowserBridge().captureElement({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/console") {
        const result = await requireBrowserBridge().getConsole({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          limit: numberInput(body?.limit),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/network") {
        const result = await requireBrowserBridge().getNetwork({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          limit: numberInput(body?.limit),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/list-cached-resources") {
        const result = await requireBrowserBridge().listCachedResources({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          query: stringInput(body?.query),
          url: stringInput(body?.url),
          limit: numberInput(body?.limit),
          resourceTypes: stringArrayInput(body?.resourceTypes),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "GET" && url.pathname === "/browser/cache-overview") {
        send(response, 200, requestID, { ok: true, data: await getBrowserCacheOverview() })
        return
      }

      if (method === "POST" && url.pathname === "/browser/clear-cache") {
        send(response, 200, requestID, { ok: true, data: await clearBrowserCache() })
        return
      }

      if (method === "POST" && url.pathname === "/browser/download-resource") {
        const result = await requireBrowserBridge().downloadResource({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          url: stringInput(body?.url),
          filename: stringInput(body?.filename),
          resourceID: stringInput(body?.resourceID),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
          cachePolicy: parseBrowserCachePolicy(stringInput(body?.cachePolicy)),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/click") {
        const result = await requireBrowserBridge().click({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: requiredString(body?.ref, "ref"),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/type") {
        const result = await requireBrowserBridge().type({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: requiredString(body?.ref, "ref"),
          text: requiredString(body?.text, "text"),
          submit: body?.submit === true,
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/scroll") {
        const direction = parseScrollDirection(stringInput(body?.direction))
        const result = await requireBrowserBridge().scroll({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
          direction,
          amount: numberInput(body?.amount),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/hover") {
        const result = await requireBrowserBridge().hover({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/focus") {
        const result = await requireBrowserBridge().focus({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/clear") {
        const result = await requireBrowserBridge().clear({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/select-option") {
        const result = await requireBrowserBridge().selectOption({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
          value: stringInput(body?.value),
          label: stringInput(body?.label),
          text: stringInput(body?.text),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/upload-file") {
        const files = Array.isArray(body?.files) ? body.files.filter((item): item is string => typeof item === "string" && item.length > 0) : []
        const result = await requireBrowserBridge().uploadFile({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
          files,
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/press-key") {
        const result = await requireBrowserBridge().pressKey({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          key: requiredString(body?.key, "key"),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/back") {
        const result = await requireBrowserBridge().back({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/forward") {
        const result = await requireBrowserBridge().forward({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/reload") {
        const result = await requireBrowserBridge().reload({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/close") {
        const result = await requireBrowserBridge().close({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/wait-selector") {
        const result = await requireBrowserBridge().waitForSelector({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          selector: requiredString(body?.selector, "selector"),
          visible: body?.visible === true,
          timeoutMs: numberInput(body?.timeoutMs),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/wait-url") {
        const match = stringInput(body?.match)
        const result = await requireBrowserBridge().waitForUrl({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          url: requiredString(body?.url, "url"),
          match: match === "includes" ? "includes" : "equals",
          timeoutMs: numberInput(body?.timeoutMs),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/wait-load-state") {
        const state = parseLoadState(requiredString(body?.state, "state"))
        const result = await requireBrowserBridge().waitForLoadState({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          state,
          timeoutMs: numberInput(body?.timeoutMs),
          stableMs: numberInput(body?.stableMs),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/wait-navigation") {
        const match = stringInput(body?.match)
        const result = await requireBrowserBridge().waitForNavigation({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          url: stringInput(body?.url),
          match: match === "includes" ? "includes" : "equals",
          timeoutMs: numberInput(body?.timeoutMs),
          stableMs: numberInput(body?.stableMs),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/wait") {
        const result = await requireBrowserBridge().waitFor({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          text: stringInput(body?.text),
          textGone: stringInput(body?.textGone),
          timeMs: numberInput(body?.timeMs),
          timeoutMs: numberInput(body?.timeoutMs),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/wait") {
        const win = requireWindow(numberInput(body?.windowID))
        const matched = await waitForState(win, body ?? {})
        send(response, 200, requestID, { ok: true, data: matched })
        return
      }

      send(response, 404, requestID, { ok: false, error: `Unknown route: ${method} ${url.pathname}` })
    } catch (error) {
      const failure = automationErrorResponse(error)
      input.logger.error("automation server request failed", {
        method,
        path: requestPath,
        error: failure.logCode,
      })
      send(response, failure.status, requestID, {
        ok: false,
        error: failure.error,
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(input.port ?? 0, host, () => {
      server.off("error", reject)
      resolve()
    })
  })

  const port = automationServerPort(server, input.port)
  input.logger.log("desktop automation server listening", { host, port, capability })
  input.events.push({
    scope: "main",
    type: "automation.server.started",
    data: { host, port },
  })

  return {
    host,
    port,
    token,
    close() {
      server.close()
    },
  }
}

function send(response: ServerResponse, status: number, requestID: string, payload: Record<string, unknown>) {
  response.writeHead(status, {
    "cache-control": "no-store",
    ...(status >= 400 ? { connection: "close" } : {}),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
  response.end(
    JSON.stringify({
      ...payload,
      requestID,
      timestamp: new Date().toISOString(),
    }),
  )
}

function requireWindow(windowID?: number) {
  const win = getAutomationWindow(windowID)
  if (win) return win
  throw new Error(windowID ? `Window ${windowID} was not found` : "No desktop window is available")
}

function requiredString(value: unknown, key: string) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Missing ${key}`)
}

function stringInput(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function numberInput(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringArrayInput(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

function objectInput(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function requiredNumber(value: unknown, key: string) {
  const parsed = numberInput(value)
  if (parsed !== undefined) return parsed
  throw new Error(`Missing ${key}`)
}

function sendAutomationKey(win: ReturnType<typeof requireWindow>, key: string) {
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: key })
  if (key.length === 1) win.webContents.sendInputEvent({ type: "char", keyCode: key })
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: key })
}

function numberParam(value: string | null) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringParam(value: string | null) {
  return value && value.length > 0 ? value : undefined
}

function requireBrowserBridge() {
  const bridge = getDesktopBrowserAutomationBridge()
  if (bridge) return bridge
  throw new Error("Desktop browser automation bridge is not available")
}

function parseLoadState(value: string) {
  if (value === "domcontentloaded" || value === "load" || value === "networkidle") return value
  throw new Error(`Unsupported load state: ${value}`)
}

function parseScrollDirection(value: string | undefined) {
  if (!value) return undefined
  if (value === "up" || value === "down" || value === "left" || value === "right") return value
  throw new Error(`Unsupported scroll direction: ${value}`)
}

function parseBrowserCachePolicy(value: string | undefined) {
  if (!value) return undefined
  if (value === "prefer-cache" || value === "cache-only" || value === "bypass-cache") return value
  throw new Error(`Unsupported browser cache policy: ${value}`)
}

async function waitForState(win: ReturnType<typeof requireWindow>, input: Record<string, unknown>) {
  const timeoutMs = numberInput(input.timeoutMs) ?? 10_000
  const intervalMs = numberInput(input.intervalMs) ?? 150
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const state = await readRendererAutomationState(win)
    if (matchesWaitState(state, input.match)) {
      return {
        matched: true,
        state,
        window: serializeWindow(win),
      }
    }
    await delay(intervalMs)
  }
  return {
    matched: false,
    state: await readRendererAutomationState(win),
    window: serializeWindow(win),
  }
}

function matchesWaitState(state: any, match: unknown) {
  if (!match || typeof match !== "object") return !!state
  if (!state || typeof state !== "object") return false
  const rule = match as Record<string, unknown>
  if (typeof rule.route === "string" && state.route !== rule.route) return false
  if (typeof rule.sessionID === "string" && state.session?.sessionID !== rule.sessionID) return false
  if (typeof rule.activeTab === "string" && state.session?.tabs?.active !== rule.activeTab) return false
  if (typeof rule.loading === "boolean" && !!state.session?.loading !== rule.loading) return false
  if (typeof rule.sideChatCount === "number" && (state.session?.sideChat?.items?.length ?? 0) !== rule.sideChatCount) return false
  if (typeof rule.browserTabCount === "number" && (state.session?.browser?.items?.length ?? 0) !== rule.browserTabCount) return false
  if (typeof rule.composerTarget === "string" && state.session?.composer?.activeTarget !== rule.composerTarget) return false
  return true
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseAutomationRequestURL(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    throw new AutomationHttpError(400, "invalid_request_target", "Invalid request target")
  }
  const base = "http://127.0.0.1"
  if (!URL.canParse(value, base)) throw new AutomationHttpError(400, "invalid_request_target", "Invalid request target")
  return new URL(value, base)
}

function safeAutomationRequestPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "<invalid>"
  const base = "http://127.0.0.1"
  if (!URL.canParse(value, base)) return "<invalid>"
  return new URL(value, base).pathname
}

function automationServerPort(server: ReturnType<typeof createServer>, configuredPort: number | undefined) {
  const address = server.address()
  if (address && typeof address === "object") return address.port
  return configuredPort ?? 0
}
