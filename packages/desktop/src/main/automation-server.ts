import { randomUUID } from "node:crypto"
import { createServer, type ServerResponse } from "node:http"
import { URL } from "node:url"
import { clipboard, dialog } from "electron"
import { getDesktopBrowserAutomationBridge } from "@lfcode-ai/shared/desktop-browser-automation"
import { AUTOMATION_PROTOCOL_VERSION } from "@lfcode-ai/shared/automation-protocol"
import {
  automationErrorResponse,
  automationRequestNeedsAuth,
  AutomationHttpError,
  browserAutomationError,
  createAutomationToken,
  inputInjectionDisabled,
  isAutomationRequestAuthorized,
  isLoopbackAutomationHost,
  readAutomationRequestBody,
  requireAutomationCapability,
  validateAutomationRequestSource,
  type AutomationCapability,
} from "../automation-security"
import type { AutomationEventScope, createAutomationEventBuffer } from "./automation-events"
import {
  AutomationDomError,
  actAutomationDom,
  callRendererAutomation,
  captureAutomationWindow,
  clickAutomationDom,
  getAutomationWindow,
  listAutomationWindows,
  queryAutomationDom,
  readRendererAutomationState,
  scrollAutomationDom,
  serializeWindow,
  snapshotAutomationDom,
  typeAutomationDom,
  waitForAutomationDom,
} from "./automation-renderer"
import { clearBrowserCache, getBrowserCacheOverview } from "./browser-runtime"
import { getGpuDiagnostics } from "./gpu-diagnostics"

type Logger = {
  log: (message: string, data?: unknown) => void
  error: (message: string, data?: unknown) => void
  warn?: (message: string, data?: unknown) => void
}

type AutomationEventBuffer = ReturnType<typeof createAutomationEventBuffer>

const AUTOMATION_EVENT_LIMIT = 200
const AUTOMATION_EVENT_WAIT_MAX_MS = 30_000
const AUTOMATION_FEATURES = [
  "diagnostics.events.cursor",
  "diagnostics.events.long_poll",
  "diagnostics.gpu",
  "desktop.non_preemptive",
  "dom.semantic_refs",
  "dom.snapshot_revisions",
  "dom.segmented_snapshots",
  "dom.idempotent_actions",
  "dom.explicit_write_window",
  "ui.global_registry",
]

type Options = {
  enabled: boolean
  host?: string
  port?: number
  token?: string
  capability?: AutomationCapability
  version?: string
  startedAt?: number
  instanceID?: string
  logger: Logger
  events: AutomationEventBuffer
}

export async function startAutomationServer(input: Options) {
  if (!input.enabled) return
  const host = input.host ?? "127.0.0.1"
  if (!isLoopbackAutomationHost(host)) throw new Error("Desktop automation must bind to a loopback host")
  const token = input.token ?? createAutomationToken()
  const capability = input.capability ?? "full_app_control"
  const startedAt = input.startedAt ?? Date.now()
  const instanceID = input.instanceID ?? randomUUID()
  const version = input.version ?? "unknown"
  const eventPolls = new Set<AbortController>()
  const server = createServer(async (request, response) => {
    const requestID = randomUUID()
    const requestStartedAt = Date.now()
    const method = request.method ?? "GET"
    const requestPath = safeAutomationRequestPath(request.url)
    const isEventPoll = requestPath === "/diagnostics/events/next"
    let errorCode: string | undefined
    let errorSessionKey: string | undefined
    let errorTabID: string | undefined
    if (!isEventPoll) {
      response.once("finish", () => {
        input.events.push({
          scope: "server",
          type: response.statusCode >= 400 ? "response.error" : "response",
          data: {
            requestID,
            method,
            path: requestPath,
            status: response.statusCode,
            ...(errorCode ? { code: errorCode } : {}),
            durationMs: Date.now() - requestStartedAt,
          },
        })
      })
      input.events.push({
        scope: "server",
        type: "request",
        data: { requestID, method, path: requestPath },
      })
    }
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
      errorSessionKey = stringInput(objectInput(body)?.sessionKey) ?? stringInput(url.searchParams.get("sessionKey"))
      errorTabID = stringInput(objectInput(body)?.tabID) ?? stringInput(url.searchParams.get("tabID"))

      if (method === "GET" && url.pathname === "/health") {
        send(response, 200, requestID, {
          ok: true,
          data: {
            status: "ok",
          },
        })
        return
      }

      if (method === "GET" && url.pathname === "/meta") {
        send(response, 200, requestID, {
          ok: true,
          data: {
            protocolVersion: AUTOMATION_PROTOCOL_VERSION,
            instanceID,
            pid: process.pid,
            startedAt,
            version,
            capability,
            features: AUTOMATION_FEATURES,
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

      if (method === "GET" && url.pathname === "/diagnostics/events/next") {
        const abort = new AbortController()
        const cancel = () => abort.abort()
        eventPolls.add(abort)
        request.once("aborted", cancel)
        response.once("close", cancel)
        try {
          if (request.aborted || response.destroyed) cancel()
          const result = await input.events.wait({
            after: eventCursorParam(url.searchParams.get("after")),
            limit: eventLimitParam(url.searchParams.get("limit")),
            waitMs: eventWaitMsParam(url.searchParams.get("waitMs")),
            scope: eventScopeParam(url.searchParams.get("scope")),
            type: stringParam(url.searchParams.get("type")),
            signal: abort.signal,
          })
          if (!response.destroyed) send(response, 200, requestID, { ok: true, data: result })
        } finally {
          eventPolls.delete(abort)
          request.off("aborted", cancel)
          response.off("close", cancel)
        }
        return
      }

      if (method === "GET" && url.pathname === "/diagnostics/gpu") {
        send(response, 200, requestID, { ok: true, data: await getGpuDiagnostics() })
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

      if (method === "POST" && url.pathname === "/diagnostics/desktop-fetch") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "diagnostics.desktopFetch")
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "GET" && url.pathname === "/dom/snapshot") {
        const win = requireWindow(numberParam(url.searchParams.get("windowID")))
        const result = await snapshotAutomationDom(win, {
          selector: stringParam(url.searchParams.get("selector")),
          region: stringParam(url.searchParams.get("region")),
          offset: snapshotOffsetParam(url.searchParams.get("offset")),
          limit: snapshotLimitParam(url.searchParams.get("limit")),
        })
        send(response, 200, requestID, { ok: true, data: withAutomationDomWindow(win, result) })
        return
      }

      if (method === "POST" && url.pathname === "/dom/query") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await queryAutomationDom(win, requiredString(body?.selector, "selector"))
        send(response, 200, requestID, { ok: true, data: withAutomationDomWindow(win, result) })
        return
      }

      if (method === "POST" && url.pathname === "/dom/click") {
        const win = requireDomWriteWindow(body?.windowID)
        const result = await clickAutomationDom(win, requiredString(body?.selector, "selector"))
        send(response, 200, requestID, { ok: true, data: withAutomationDomWindow(win, result) })
        return
      }

      if (method === "POST" && url.pathname === "/dom/type") {
        const win = requireDomWriteWindow(body?.windowID)
        const result = await typeAutomationDom(
          win,
          requiredString(body?.selector, "selector"),
          requiredString(body?.text, "text"),
          body?.append === true,
        )
        send(response, 200, requestID, { ok: true, data: withAutomationDomWindow(win, result) })
        return
      }

      if (method === "POST" && url.pathname === "/dom/press") {
        throw inputInjectionDisabled("/dom/press")
      }

      if (method === "POST" && url.pathname === "/dom/act") {
        const win = requireDomWriteWindow(body?.windowID)
        const action = parseDomAction(requiredString(body?.action, "action"))
        const result = await actAutomationDom(win, {
          action,
          ref: stringInput(body?.ref),
          fingerprint: stringInput(body?.fingerprint),
          snapshotID: stringInput(body?.snapshotID),
          selector: stringInput(body?.selector),
          text: optionalStringInput(body?.text),
          value: optionalStringInput(body?.value),
          ...domTargetStateInput(action, body),
          top: numberInput(body?.top),
          left: numberInput(body?.left),
          deltaX: numberInput(body?.deltaX),
          deltaY: numberInput(body?.deltaY),
        })
        send(response, 200, requestID, { ok: true, data: withAutomationDomWindow(win, result) })
        return
      }

      if (method === "POST" && url.pathname === "/dom/wait") {
        const win = requireWindow(numberInput(body?.windowID))
        const result = await waitForAutomationDom(win, {
          ref: stringInput(body?.ref),
          fingerprint: stringInput(body?.fingerprint),
          selector: stringInput(body?.selector),
          visible: booleanInput(body?.visible),
          text: stringInput(body?.text),
          attribute: attributeInput(body?.attribute),
          disabled: booleanInput(body?.disabled),
          checked: booleanInput(body?.checked),
          selected: booleanInput(body?.selected),
          timeoutMs: numberInput(body?.timeoutMs),
          intervalMs: numberInput(body?.intervalMs),
        })
        send(response, 200, requestID, { ok: true, data: withAutomationDomWindow(win, result) })
        return
      }

      if (method === "POST" && url.pathname === "/dom/scroll") {
        const win = requireDomWriteWindow(body?.windowID)
        const result = await scrollAutomationDom(win, {
          selector: stringInput(body?.selector),
          top: numberInput(body?.top),
          left: numberInput(body?.left),
        })
        send(response, 200, requestID, { ok: true, data: withAutomationDomWindow(win, result) })
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

      if (method === "POST" && ["/window/focus", "/window/type", "/window/click"].includes(url.pathname)) {
        throw inputInjectionDisabled(url.pathname)
      }

      if (method === "POST" && url.pathname === "/window/manage") {
        const win = requireWindow(numberInput(body?.windowID))
        const action = parseWindowAction(requiredString(body?.action, "action"))
        if (action === "show") {
          if (win.isMinimized()) win.restore()
          if (!win.isVisible()) win.showInactive()
        }
        if (action === "hide") win.hide()
        if (action === "minimize") win.minimize()
        if (action === "maximize") win.maximize()
        if (action === "restore") win.restore()
        if (action === "setBounds") win.setBounds(parseBounds(body?.bounds))
        if (action === "close") win.close()
        send(response, 200, requestID, {
          ok: true,
          data: {
            action,
            window: win.isDestroyed() ? { id: win.id, destroyed: true } : serializeWindow(win),
          },
        })
        return
      }

      if (method === "GET" && url.pathname === "/clipboard") {
        send(response, 200, requestID, { ok: true, data: { text: clipboard.readText() } })
        return
      }

      if (method === "POST" && url.pathname === "/clipboard/set") {
        const text = optionalStringInput(body?.text)
        if (text === undefined) throw new AutomationHttpError(400, "invalid_clipboard_text", "Missing text")
        clipboard.writeText(text)
        send(response, 200, requestID, { ok: true, data: { length: text.length } })
        return
      }

      if (method === "POST" && url.pathname === "/dialog/open") {
        const result = await dialog.showOpenDialog(requireWindow(numberInput(body?.windowID)), {
          title: stringInput(body?.title),
          defaultPath: stringInput(body?.defaultPath),
          buttonLabel: stringInput(body?.buttonLabel),
          properties: openDialogProperties(body?.properties),
          filters: dialogFilters(body?.filters),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/dialog/save") {
        const result = await dialog.showSaveDialog(requireWindow(numberInput(body?.windowID)), {
          title: stringInput(body?.title),
          defaultPath: stringInput(body?.defaultPath),
          buttonLabel: stringInput(body?.buttonLabel),
          nameFieldLabel: stringInput(body?.nameFieldLabel),
          filters: dialogFilters(body?.filters),
        })
        send(response, 200, requestID, { ok: true, data: result })
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
          temporary: body?.temporary === true,
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

      if (method === "GET" && url.pathname === "/ui/catalog") {
        const win = requireWindow(numberParam(url.searchParams.get("windowID")))
        const catalog = await callRendererAutomation(win, "ui.catalog")
        send(response, 200, requestID, {
          ok: true,
          data: {
            windowID: win.id,
            window: serializeWindow(win),
            catalog,
          },
        })
        return
      }

      if (method === "POST" && url.pathname === "/ui/click") {
        const win = requireUiWriteWindow(body?.windowID)
        const result = await callRendererAutomation(win, "ui.click", body)
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/ui/type") {
        const win = requireUiWriteWindow(body?.windowID)
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
        const sessionKey = stringInput(body?.sessionKey)
        if (sessionKey) {
          const result = await requireBrowserBridge().navigate({
            sessionKey,
            tabID: stringInput(body?.tabID),
            sessionID: stringInput(body?.sessionID),
            url: requiredString(body?.url, "url"),
            title: stringInput(body?.title),
            presentation: parseBrowserPresentation(stringInput(body?.presentation)),
            newTab: body?.newTab === true,
          })
          send(response, 200, requestID, { ok: true, data: result })
          return
        }
        const win = requireWindow(numberInput(body?.windowID))
        const result = await callRendererAutomation(win, "browser.open", {
          url: requiredString(body?.url, "url"),
          title: stringInput(body?.title),
          presentation: stringInput(body?.presentation),
          newTab: body?.newTab === true,
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
        const result = getDesktopBrowserAutomationBridge()?.getTarget({
          sessionKey,
          tabID: stringInput(url.searchParams.get("tabID")),
        }) ?? null
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/snapshot") {
        const sessionKey = requiredString(body?.sessionKey, "sessionKey")
        const result = await requireBrowserBridge().snapshot({ sessionKey, tabID: stringInput(body?.tabID) })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/screenshot") {
        const sessionKey = requiredString(body?.sessionKey, "sessionKey")
        const result = await requireBrowserBridge().screenshot({ sessionKey, tabID: stringInput(body?.tabID) })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/read-page") {
        const sessionKey = requiredString(body?.sessionKey, "sessionKey")
        const result = await requireBrowserBridge().readPage({ sessionKey, tabID: stringInput(body?.tabID) })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/extract-resource") {
        const result = await requireBrowserBridge().extractResource({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/capture-element") {
        const result = await requireBrowserBridge().captureElement({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/console") {
        const result = await requireBrowserBridge().getConsole({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
          limit: numberInput(body?.limit),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/network") {
        const result = await requireBrowserBridge().getNetwork({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
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
          tabID: stringInput(body?.tabID),
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
          tabID: stringInput(body?.tabID),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/type") {
        const result = await requireBrowserBridge().type({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
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
          tabID: stringInput(body?.tabID),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
          direction,
          amount: numberInput(body?.amount),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/hover") {
        throw inputInjectionDisabled("/browser/hover")
      }

      if (method === "POST" && url.pathname === "/browser/focus") {
        throw inputInjectionDisabled("/browser/focus")
      }

      if (method === "POST" && url.pathname === "/browser/press-key") {
        throw inputInjectionDisabled("/browser/press-key")
      }

      if (method === "POST" && url.pathname === "/browser/clear") {
        const result = await requireBrowserBridge().clear({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/select-option") {
        const result = await requireBrowserBridge().selectOption({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
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
          tabID: stringInput(body?.tabID),
          ref: stringInput(body?.ref),
          selector: stringInput(body?.selector),
          files,
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/back") {
        const result = await requireBrowserBridge().back({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/forward") {
        const result = await requireBrowserBridge().forward({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/reload") {
        const result = await requireBrowserBridge().reload({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/close") {
        const result = await requireBrowserBridge().close({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/wait-selector") {
        const result = await requireBrowserBridge().waitForSelector({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
          selector: requiredString(body?.selector, "selector"),
          visible: body?.visible === true,
          timeoutMs: numberInput(body?.timeoutMs),
          stableMs: numberInput(body?.stableMs),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/wait-url") {
        const match = stringInput(body?.match)
        const result = await requireBrowserBridge().waitForUrl({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
          url: requiredString(body?.url, "url"),
          match: match === "includes" ? "includes" : "equals",
          timeoutMs: numberInput(body?.timeoutMs),
          stableMs: numberInput(body?.stableMs),
        })
        send(response, 200, requestID, { ok: true, data: result })
        return
      }

      if (method === "POST" && url.pathname === "/browser/wait-load-state") {
        const state = parseLoadState(requiredString(body?.state, "state"))
        const result = await requireBrowserBridge().waitForLoadState({
          sessionKey: requiredString(body?.sessionKey, "sessionKey"),
          tabID: stringInput(body?.tabID),
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
          tabID: stringInput(body?.tabID),
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
          tabID: stringInput(body?.tabID),
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
      const failure = automationErrorResponse(domAutomationHttpError(error, requestPath))
      errorCode = failure.code
      input.logger.error("automation server request failed", {
        method,
        path: requestPath,
        error: failure.logCode,
      })
      send(response, failure.status, requestID, {
        ok: false,
        error: failure.error,
        code: failure.code,
        retryable: failure.retryable,
        ...(errorSessionKey ? { session_key: errorSessionKey } : {}),
        ...(errorTabID ? { tab_id: errorTabID } : {}),
        ...(failure.recovery ? { recovery: failure.recovery } : {}),
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
    protocolVersion: AUTOMATION_PROTOCOL_VERSION,
    instanceID,
    startedAt,
    version,
    capability,
    features: AUTOMATION_FEATURES,
    close() {
      for (const poll of eventPolls) poll.abort()
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
  if (windowID !== undefined) {
    throw new AutomationHttpError(404, "window_not_found", `Window ${windowID} was not found`)
  }
  throw new AutomationHttpError(503, "window_unavailable", "No desktop window is available", {
    retryable: true,
    recovery: "Keep the desktop application open and retry after its main window has loaded.",
  })
}

function requireDomWriteWindow(value: unknown) {
  return requireWriteWindow(value, "DOM write actions")
}

function requireUiWriteWindow(value: unknown) {
  return requireWriteWindow(value, "UI write actions")
}

function requireWriteWindow(value: unknown, subject: string) {
  const windowID = numberInput(value)
  if (windowID === undefined) {
    throw new AutomationHttpError(
      400,
      "window_id_required",
      `${subject} require an explicit windowID.`,
      {
        retryable: false,
        recovery: "Read /windows or a UI snapshot, then pass its windowID with the write action.",
      },
    )
  }
  return requireWindow(windowID)
}

function withAutomationDomWindow(win: ReturnType<typeof requireWindow>, result: unknown) {
  return {
    ...(objectInput(result) ?? { result }),
    windowID: win.id,
    window: serializeWindow(win),
  }
}

function domAutomationHttpError(error: unknown, requestPath?: string) {
  if (error instanceof AutomationHttpError) return error
  if (error instanceof AutomationDomError) {
    const recovery = "Take a fresh DOM snapshot and pass its snapshotID, ref, and fingerprint to the action."
    return new AutomationHttpError(409, error.code, error.message, { retryable: true, recovery })
  }
  if (!requestPath?.startsWith("/browser/") || !(error instanceof Error)) return error
  if (/renderer automation bridge is not ready/i.test(error.message)) return browserAutomationError("browser_renderer_unavailable")
  if (/render frame|render process|webcontents.*destroy|object has been destroyed|frame.*disposed|renderer.*gone/i.test(error.message)) {
    const mapped = browserAutomationError("browser_renderer_unavailable")
    if (["/browser/click", "/browser/type", "/browser/clear", "/browser/select-option", "/browser/upload-file", "/browser/scroll"].includes(requestPath ?? "")) {
      return new AutomationHttpError(mapped.status, mapped.code, mapped.message, {
        retryable: mapped.options?.retryable,
        recovery: "状态可能已部分改变。先执行 browser.read 或 browser.snapshot 确认当前页面状态，再决定是否重试该操作。",
      })
    }
    return mapped
  }
  if (/browser tab was not found|no active browser tab/i.test(error.message)) {
    return browserAutomationError("browser_tab_not_found")
  }
  if (["/browser/open", "/browser/back", "/browser/forward", "/browser/reload"].includes(requestPath)) {
    return browserAutomationError("browser_navigation_failed")
  }
  // Preserve semantic browser errors (invalid selectors, missing elements,
  // failed resource extraction) as a non-retryable structured observation so
  // the model can correct its request instead of repeating the same action.
  return new AutomationHttpError(400, "browser_action_failed", error.message, {
    retryable: false,
    recovery: "检查 selector、ref 或页面状态后修正请求；不要重复发送完全相同的操作。",
  })
}

function requiredString(value: unknown, key: string) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Missing ${key}`)
}

function stringInput(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function optionalStringInput(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberInput(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function booleanInput(value: unknown) {
  return typeof value === "boolean" ? value : undefined
}

function domTargetStateInput(action: Parameters<typeof actAutomationDom>[1]["action"], body: Record<string, unknown> | undefined) {
  if (action === "setChecked") return { checked: requiredBoolean(body?.checked, "checked") }
  if (action === "setExpanded") return { expanded: requiredBoolean(body?.expanded, "expanded") }
  if (action === "setSelected") return { selected: requiredBoolean(body?.selected, "selected") }
  return {}
}

function requiredBoolean(value: unknown, key: string) {
  const parsed = booleanInput(value)
  if (parsed !== undefined) return parsed
  throw new AutomationHttpError(400, "invalid_dom_action_target", `Missing boolean ${key}`)
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

function parseDomAction(value: string) {
  if (
    [
      "click",
      "setText",
      "appendText",
      "toggle",
      "setChecked",
      "setExpanded",
      "setSelected",
      "select",
      "scroll",
    ].includes(value)
  ) {
    return value as Parameters<typeof actAutomationDom>[1]["action"]
  }
  throw new AutomationHttpError(400, "invalid_dom_action", "Unsupported semantic DOM action")
}

function attributeInput(value: unknown) {
  const input = objectInput(value)
  if (!input) return undefined
  const name = stringInput(input.name)
  if (!name) throw new AutomationHttpError(400, "invalid_dom_attribute", "DOM attribute name is invalid")
  const attributeValue = optionalStringInput(input.value)
  return attributeValue === undefined ? { name } : { name, value: attributeValue }
}

function parseWindowAction(value: string) {
  if (["show", "hide", "minimize", "maximize", "restore", "setBounds", "close"].includes(value)) {
    return value as "show" | "hide" | "minimize" | "maximize" | "restore" | "setBounds" | "close"
  }
  throw new AutomationHttpError(400, "invalid_window_action", "Unsupported non-preemptive window action")
}

function parseBounds(value: unknown): Electron.Rectangle {
  const input = objectInput(value)
  if (!input) throw new AutomationHttpError(400, "invalid_window_bounds", "Missing bounds")
  const x = requiredNumber(input.x, "bounds.x")
  const y = requiredNumber(input.y, "bounds.y")
  const width = requiredNumber(input.width, "bounds.width")
  const height = requiredNumber(input.height, "bounds.height")
  if (width < 1 || height < 1) {
    throw new AutomationHttpError(400, "invalid_window_bounds", "Window bounds must have a positive width and height")
  }
  return { x, y, width, height }
}

function openDialogProperties(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new AutomationHttpError(400, "invalid_dialog_properties", "Dialog properties must be an array")
  const allowed = [
    "openFile",
    "openDirectory",
    "multiSelections",
    "showHiddenFiles",
    "createDirectory",
    "promptToCreate",
    "noResolveAliases",
    "treatPackageAsDirectory",
    "dontAddToRecent",
  ] as const
  return value.map((item) => {
    if (typeof item === "string" && allowed.includes(item as (typeof allowed)[number])) {
      return item as (typeof allowed)[number]
    }
    throw new AutomationHttpError(400, "invalid_dialog_properties", "Dialog property is invalid")
  })
}

function dialogFilters(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new AutomationHttpError(400, "invalid_dialog_filters", "Dialog filters must be an array")
  return value.map((item) => {
    const filter = objectInput(item)
    if (!filter) throw new AutomationHttpError(400, "invalid_dialog_filters", "Dialog filter is invalid")
    const name = requiredString(filter.name, "filter.name")
    if (!Array.isArray(filter.extensions) || filter.extensions.some((extension) => typeof extension !== "string" || !extension)) {
      throw new AutomationHttpError(400, "invalid_dialog_filters", "Dialog filter extensions are invalid")
    }
    return { name, extensions: filter.extensions }
  })
}

function numberParam(value: string | null) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function snapshotOffsetParam(value: string | null) {
  if (value === null || value === "") return undefined
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  throw new AutomationHttpError(400, "invalid_dom_snapshot_offset", "DOM snapshot offset must be a non-negative integer")
}

function snapshotLimitParam(value: string | null) {
  if (value === null || value === "") return undefined
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 500) return parsed
  throw new AutomationHttpError(400, "invalid_dom_snapshot_limit", "DOM snapshot limit must be an integer from 1 to 500")
}

function stringParam(value: string | null) {
  return value && value.length > 0 ? value : undefined
}

function eventCursorParam(value: string | null) {
  if (value === null || value === "") return undefined
  return eventIntegerParam(value, "after", Number.MAX_SAFE_INTEGER)
}

function eventLimitParam(value: string | null) {
  if (value === null || value === "") return undefined
  const limit = eventIntegerParam(value, "limit", AUTOMATION_EVENT_LIMIT)
  if (limit > 0) return limit
  throw new AutomationHttpError(400, "invalid_event_limit", "Invalid diagnostics event limit")
}

function eventWaitMsParam(value: string | null) {
  if (value === null || value === "") return undefined
  return eventIntegerParam(value, "waitMs", AUTOMATION_EVENT_WAIT_MAX_MS)
}

function eventIntegerParam(value: string, name: string, maximum: number) {
  if (!/^\d+$/.test(value)) {
    throw new AutomationHttpError(400, `invalid_event_${name}`, `Invalid diagnostics event ${name}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new AutomationHttpError(400, `invalid_event_${name}`, `Invalid diagnostics event ${name}`)
  }
  return Math.min(parsed, maximum)
}

function eventScopeParam(value: string | null): AutomationEventScope | undefined {
  if (value === null || value === "") return undefined
  if (value === "main" || value === "renderer" || value === "server") return value
  throw new AutomationHttpError(400, "invalid_event_scope", "Invalid diagnostics event scope")
}

function requireBrowserBridge() {
  const bridge = getDesktopBrowserAutomationBridge()
  if (bridge) return bridge
  throw browserAutomationError("browser_bridge_unavailable")
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

function parseBrowserPresentation(value: string | undefined) {
  if (!value) return undefined
  if (value === "headless" || value === "detached" || value === "sidebar") return value
  throw new AutomationHttpError(400, "invalid_browser_presentation", "Invalid browser presentation")
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
