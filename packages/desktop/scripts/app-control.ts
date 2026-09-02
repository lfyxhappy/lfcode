#!/usr/bin/env bun

import { createAutomationClient } from "./automation-client"
import { resolveAppControlTarget } from "./app-control-target"
import { readAutomationDiscovery } from "../src/automation-discovery"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"

const target = resolveAppControlTarget(process.argv.slice(2))
const args = target.args
const command = args[0] ?? "health"
const client = command === "launch" ? undefined : await createAutomationClient(undefined, target.env)

if (command === "launch") {
  if (target.channel !== "pre") throw new Error("launch is only available with --pre")
  const discovery = await readAutomationDiscovery(target.env).catch(() => undefined)
  if (discovery) {
    const response = await fetch(`http://${discovery.host}:${discovery.port}/health`).catch(() => undefined)
    if (response?.ok) {
      print({ status: "already-running", pid: discovery.pid, port: discovery.port })
      process.exit(0)
    }
  }

  const executable = process.env.LFCODE_PRE_EXECUTABLE ?? "C:/算法/小应用/Lfcodepre/LfcodePre.exe"
  if (!existsSync(executable)) throw new Error(`Pre-release executable not found: ${executable}`)
  spawn(executable, [], { cwd: "C:/算法/小应用/Lfcodepre", detached: true, stdio: "ignore" }).unref()

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const next = await readAutomationDiscovery(target.env).catch(() => undefined)
    if (next) {
      const response = await fetch(`http://${next.host}:${next.port}/health`).catch(() => undefined)
      if (response?.ok) {
        print({ status: "started", pid: next.pid, port: next.port })
        process.exit(0)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Pre-release app did not become automation-ready within 20 seconds")
}

if (!client) throw new Error("Automation client is unavailable")

if (command === "health") {
  print(await client.get("/health"))
  process.exit(0)
}

if (command === "meta") {
  print(await client.getMetadata())
  process.exit(0)
}

if (command === "events-next") {
  const query = new URLSearchParams()
  appendQueryArg(query, "after", args[1])
  appendQueryArg(query, "limit", args[2])
  appendQueryArg(query, "waitMs", args[3])
  appendQueryArg(query, "scope", args[4])
  appendQueryArg(query, "type", args[5])
  print(await client.get(`/diagnostics/events/next${query.size > 0 ? `?${query}` : ""}`))
  process.exit(0)
}

if (command === "windows") {
  print(await client.get("/windows"))
  process.exit(0)
}

if (command === "state") {
  const windowID = numberArg(args[1])
  const query = windowID ? `?windowID=${windowID}` : ""
  print(await client.get(`/diagnostics/ui-state${query}`))
  process.exit(0)
}

if (command === "gpu") {
  print(await client.get("/diagnostics/gpu"))
  process.exit(0)
}

if (command === "window-manage") {
  const action = requiredArg(args[1], "action")
  const bounds = args[3] ? JSON.parse(args[3]) : undefined
  print(
    await client.post("/window/manage", {
      windowID: numberArg(args[2]),
      action,
      ...(bounds === undefined ? {} : { bounds }),
    }),
  )
  process.exit(0)
}

if (command === "clipboard-get") {
  print(await client.get("/clipboard"))
  process.exit(0)
}

if (command === "clipboard-set") {
  print(await client.post("/clipboard/set", { text: args[1] ?? "" }))
  process.exit(0)
}

if (command === "open-session") {
  const directory = requiredArg(args[1], "directory")
  const sessionID = requiredArg(args[2], "sessionID")
  print(
    await client.post("/session/open", {
      windowID: numberArg(args[3]),
      directory,
      sessionID,
    }),
  )
  process.exit(0)
}

if (command === "sidechat-create") {
  print(
    await client.post("/sidechat/create", {
      windowID: numberArg(args[2]),
      text: args[1] ?? "",
    }),
  )
  process.exit(0)
}

if (command === "set-text") {
  print(
    await client.post("/composer/set-text", {
      windowID: numberArg(args[3]),
      text: requiredArg(args[1], "text"),
      target: args[2] || "main",
    }),
  )
  process.exit(0)
}

if (command === "submit") {
  print(
    await client.post("/composer/submit", {
      windowID: numberArg(args[2]),
      target: args[1] || "main",
    }),
  )
  process.exit(0)
}

if (command === "timeline-state") {
  const windowID = numberArg(args[1])
  const query = windowID ? `?windowID=${windowID}` : ""
  print(await client.get(`/timeline/state${query}`))
  process.exit(0)
}

if (command === "timeline-scroll") {
  const position = requiredArg(args[1], "position")
  const top = position === "top" || position === "middle" || position === "bottom" ? undefined : Number(position)
  if (top !== undefined && !Number.isFinite(top)) throw new Error(`Invalid timeline position: ${position}`)
  print(
    await client.post("/timeline/scroll", {
      windowID: numberArg(args[2]),
      ...(top === undefined ? { position } : { top }),
    }),
  )
  process.exit(0)
}

if (command === "browser-open") {
  print(
    await client.post("/browser/open", {
      windowID: numberArg(args[3]),
      url: requiredArg(args[1], "url"),
      title: args[2],
    }),
  )
  process.exit(0)
}

if (command === "browser-cache-overview") {
  print(await client.get("/browser/cache-overview"))
  process.exit(0)
}

if (command === "browser-cache-clear") {
  print(await client.post("/browser/clear-cache"))
  process.exit(0)
}

if (command === "browser-cache-list") {
  print(
    await client.post("/browser/list-cached-resources", {
      sessionKey: requiredArg(args[1], "sessionKey"),
      query: args[2] || undefined,
      url: args[3] || undefined,
      limit: numberArg(args[4]),
      resourceTypes: parseCsvArg(args[5]),
    }),
  )
  process.exit(0)
}

if (command === "browser-download") {
  const sessionKey = requiredArg(args[1], "sessionKey")
  const url = args[2]
  const selector = args[3]
  const filename = args[4]
  const cachePolicy = parseCachePolicyArg(args[5])
  print(
    await client.post("/browser/download-resource", {
      sessionKey,
      url: url || undefined,
      selector: selector || undefined,
      filename: filename || undefined,
      cachePolicy,
    }),
  )
  process.exit(0)
}

if (command === "filetab-focus") {
  print(
    await client.post("/filetab/focus", {
      windowID: numberArg(args[2]),
      path: requiredArg(args[1], "path"),
    }),
  )
  process.exit(0)
}

if (command === "filetab-open") {
  const path = requiredArg(args[1], "path")
  const line = numberArg(args[2])
  const column = numberArg(args[3])
  print(
    await client.post("/filetab/open-path", {
      windowID: numberArg(args[4]),
      path,
      selection:
        typeof line === "number" && typeof column === "number"
          ? {
              startLineNumber: line,
              startColumn: column,
            }
          : undefined,
    }),
  )
  process.exit(0)
}

if (command === "filetab-state") {
  const windowID = numberArg(args[1])
  const query = windowID ? `?windowID=${windowID}` : ""
  const result = await client.get<{ window?: unknown; state?: { session?: Record<string, unknown> } }>(`/diagnostics/ui-state${query}`)
  const session = result?.state?.session ?? {}
  print({
    window: result?.window ?? null,
    sessionID: session.sessionID ?? null,
    directory: session.directory ?? null,
    fileTabSummary: session.fileTabSummary ?? null,
    fileTab: sanitizeFileTab(session.fileTab, args[2] === "with-value"),
    ...(args[2] === "full" || args[3] === "full" ? { tabs: session.tabs ?? null } : {}),
  })
  process.exit(0)
}

if (command === "filetab-mode") {
  print(
    await client.post("/filetab/mode", {
      windowID: numberArg(args[2]),
      mode: requiredArg(args[1], "mode"),
    }),
  )
  process.exit(0)
}

if (command === "filetab-text") {
  print(
    await client.post("/filetab/text", {
      windowID: numberArg(args[3]),
      text: requiredArg(args[1], "text"),
      append: args[2] === "append",
    }),
  )
  process.exit(0)
}

if (command === "filetab-save") {
  print(
    await client.post("/filetab/save", {
      windowID: numberArg(args[1]),
    }),
  )
  process.exit(0)
}

if (command === "editor-state") {
  const token = requiredArg(args[1], "token")
  print(
    await client.post("/ui/editor", {
      windowID: numberArg(args[2]),
      blockKey: args[3],
      token,
      action: "getState",
    }),
  )
  process.exit(0)
}

if (command === "editor-reveal") {
  const token = requiredArg(args[1], "token")
  print(
    await client.post("/ui/editor", {
      windowID: numberArg(args[2]),
      blockKey: args[3],
      token,
      action: "reveal",
    }),
  )
  process.exit(0)
}

if (command === "editor-run") {
  const token = requiredArg(args[1], "token")
  const editorCommand = requiredArg(args[2], "editorCommand")
  print(
    await client.post("/ui/editor", {
      windowID: numberArg(args[3]),
      blockKey: args[4],
      token,
      action: editorCommand,
    }),
  )
  process.exit(0)
}

if (command === "editor-query") {
  const token = requiredArg(args[1], "token")
  const action = requiredArg(args[2], "action")
  const arg = args[3]
  print(
    await client.post("/ui/editor", {
      windowID: numberArg(args[4]),
      blockKey: args[5],
      token,
      action,
      ...(action === "getWorkspaceSymbols" ? { query: requiredArg(arg, "query") } : {}),
    }),
  )
  process.exit(0)
}

if (command === "editor-set") {
  const token = requiredArg(args[1], "token")
  print(
    await client.post("/ui/type", {
      windowID: numberArg(args[4]),
      blockKey: args[5],
      token,
      text: requiredArg(args[2], "text"),
      append: args[3] === "append",
    }),
  )
  process.exit(0)
}

if (command === "ui-query") {
  const token = requiredArg(args[1], "token")
  print(
    await client.post("/ui/query", {
      token,
      windowID: numberArg(args[2]),
      blockKey: args[3],
    }),
  )
  process.exit(0)
}

if (command === "ui-click") {
  const token = requiredArg(args[1], "token")
  print(
    await client.post("/ui/click", {
      token,
      windowID: numberArg(args[2]),
      blockKey: args[3],
    }),
  )
  process.exit(0)
}

if (command === "ui-read-text") {
  const token = requiredArg(args[1], "token")
  print(
    await client.post("/ui/read-text", {
      token,
      windowID: numberArg(args[2]),
      blockKey: args[3],
    }),
  )
  process.exit(0)
}

if (command === "ui-type") {
  const token = requiredArg(args[1], "token")
  print(
    await client.post("/ui/type", {
      token,
      text: requiredArg(args[2], "text"),
      append: args[3] === "append",
      windowID: numberArg(args[4]),
      blockKey: args[5],
    }),
  )
  process.exit(0)
}

if (command === "ui-wait") {
  const token = requiredArg(args[1], "token")
  const visible = parseVisibleArg(args[2])
  print(
    await client.post("/ui/wait", {
      token,
      visible,
      timeoutMs: numberArg(args[3]),
      intervalMs: numberArg(args[4]),
      windowID: numberArg(args[5]),
      blockKey: args[6],
    }),
  )
  process.exit(0)
}

if (command === "request") {
  const method = (args[1] ?? "GET").toUpperCase()
  const path = args[2] ?? "/health"
  const body = args[3] ? JSON.parse(args[3]) : undefined
  print(method === "POST" ? await client.post(path, body) : await client.get(path))
  process.exit(0)
}

throw new Error(`Unsupported app control command: ${command}`)

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2))
}

function appendQueryArg(query: URLSearchParams, key: string, value: string | undefined) {
  if (value === undefined || value === "") return
  query.set(key, value)
}

function requiredArg(value: string | undefined, key: string) {
  if (value) return value
  throw new Error(`Missing ${key}`)
}

function numberArg(value: string | undefined) {
  if (!value) return
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseVisibleArg(value: string | undefined) {
  if (!value || value === "any") return undefined
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`Invalid visible value: ${value}`)
}

function parseCsvArg(value: string | undefined) {
  if (!value) return undefined
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseCachePolicyArg(value: string | undefined) {
  if (!value) return undefined
  if (value === "prefer-cache" || value === "cache-only" || value === "bypass-cache") return value
  throw new Error(`Invalid cache policy: ${value}`)
}

function sanitizeFileTab(input: unknown, includeEditorValue: boolean) {
  if (!input || typeof input !== "object") return null
  const fileTab = input as Record<string, unknown>
  const editor = fileTab.editor
  if (includeEditorValue || !editor || typeof editor !== "object") return fileTab
  const editorRecord = { ...(editor as Record<string, unknown>) }
  if (typeof editorRecord.value === "string") {
    const value = editorRecord.value
    delete editorRecord.value
    editorRecord.hasValue = true
    editorRecord.valueLength = value.length
    editorRecord.lineCount = countLines(value)
  }
  return {
    ...fileTab,
    editor: editorRecord,
  }
}

function countLines(value: string) {
  if (!value) return 0
  return value.split(/\r\n|\r|\n/).length
}
