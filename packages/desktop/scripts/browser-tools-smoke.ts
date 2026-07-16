#!/usr/bin/env bun

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { createAutomationClient } from "./automation-client"

type AutomationUiState = {
  route?: string
  session?: {
    sessionID?: string
    sessionKey?: string
    directory?: string
    browser?: {
      items?: Array<{
        id: string
        url: string
        input?: string
        title?: string
        loading?: boolean
        error?: string
      }>
    }
    tabs?: {
      active?: string
      all?: string[]
    }
  } | null
}

type SnapshotResult = {
  target: { url: string }
  elements: Array<{
    ref: string
    selector: string
    tag: string
    text?: string
    placeholder?: string
    href?: string
    value?: string
  }>
}

type ExtractResourceResult = {
  resources: Array<{
    kind: string
    selector: string
    downloadable?: boolean
    reason?: string
    limitation?: string
    recommendedAction?: string
    recommendedReason?: string
    primarySource?: {
      kind: string
      url: string
    }
    sources?: Array<{
      kind: string
      url: string
      requested?: boolean
      mimeType?: string
      statusCode?: number
      contentDisposition?: string
    }>
  }>
}

type ConsoleResult = {
  entries: Array<{
    kind?: string
    level: string
    message: string
  }>
}

type NetworkResult = {
  entries: Array<{
    url: string
    method: string
    mimeType?: string
    contentDisposition?: string
    statusCode?: number
  }>
}

type CachedResourceListResult = {
  cacheSizeBytes: number
  indexedEntryCount: number
  entries: Array<{
    url: string
    cacheObserved: boolean
    fromCache?: boolean
    mimeType?: string
    statusCode?: number
    observations: number
  }>
}

type DownloadResult = {
  ok: boolean
  cachePolicy: "prefer-cache" | "cache-only" | "bypass-cache"
  cacheObserved: boolean
  cacheHit: boolean
  fallbackUsed: boolean
  sourceKind: string
  missReason?: string
  path?: string
  filename?: string
  url: string
  resolvedUrl?: string
}

type SpawnedDesktop = {
  stdout: ReadableStream<Uint8Array> | null
  stderr: ReadableStream<Uint8Array> | null
  exited: Promise<number>
  exitCode: number | null
  kill: () => void
}

const repoRoot = resolve(import.meta.dir, "../../..")
const desktopRoot = resolve(import.meta.dir, "..")
const desktopOutSentinel = resolve(desktopRoot, "out/main/index.js")
const electronExecutable = resolve(desktopRoot, "node_modules/electron/dist/electron.exe")
const defaultDirectory = resolve(process.env.LFCODE_AUTOMATION_DIRECTORY || repoRoot)
const automationPort = await resolveAutomationPort()
const automationToken = process.env.LFCODE_AUTOMATION_TOKEN || `browser-tools-smoke-${randomUUID()}`
const shouldSpawnDesktop = !process.env.LFCODE_AUTOMATION_PORT
const fixturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sotkZYAAAAASUVORK5CYII=",
  "base64",
)

let desktop: SpawnedDesktop | undefined
let desktopLogs = ""
const execFileAsync = promisify(execFile)

const fixture = await startFixtureServer()

try {
  if (shouldSpawnDesktop) {
    await ensureBuiltDesktop()
    desktop = spawnDesktop(automationPort, automationToken)
    captureDesktopLogs(desktop)
  }

  const client = await createAutomationClient({
    host: "127.0.0.1",
    port: automationPort,
    token: automationToken,
  })

  await waitForHealth(client)
  const windows = await client.get<Array<{ id: number; title: string; focused: boolean }>>("/windows")
  if (windows.length === 0) throw new Error("No desktop window is available for browser tools smoke")
  const windowID = windows[0].id

  const route = `/${base64Encode(defaultDirectory.replace(/\\/g, "/"))}/session`
  await client.post("/route/navigate", { windowID, route })
  const state = await waitForUiState(client, windowID, (ui) => ui.route === route && !!ui.session?.sessionKey)
  const sessionKey = state.session?.sessionKey
  if (!sessionKey) throw new Error("Session page did not expose sessionKey for browser tools smoke")

  await client.post("/browser/open", {
    windowID,
    url: fixture.pageURL,
    title: "Browser Tools Smoke",
  })
  await waitForUiState(client, windowID, (ui) => (ui.session?.browser?.items?.length ?? 0) >= 1)
  await client.post("/browser/wait-load-state", {
    sessionKey,
    state: "load",
    timeoutMs: 15_000,
    stableMs: 500,
  })
  await client.post("/browser/wait-selector", {
    sessionKey,
    selector: "#ready",
    visible: true,
    timeoutMs: 15_000,
  })
  await delay(700)

  const screenshot = await client.post<{ path: string; width: number; height: number }>("/browser/screenshot", { sessionKey })
  await requireFile(screenshot.path, "browser screenshot")

  const page = await client.post<{
    title: string
    url: string
    headings: Array<{ text: string }>
    media: Array<{ selector: string }>
  }>("/browser/read-page", { sessionKey })
  invariant(page.title === "Browser Tools Smoke", `Unexpected page title: ${page.title}`)
  invariant(page.url === fixture.pageURL, `Unexpected page url: ${page.url}`)
  invariant(page.headings.some((item) => item.text.includes("Browser Tools Smoke")), "Heading was not detected")
  invariant(page.media.length >= 3, "Expected multiple media resources from read_page")

  const snapshot = await client.post<SnapshotResult>("/browser/snapshot", { sessionKey })
  const inputRef = requireRef(snapshot, (item) => item.selector.includes("#text-input"), "text input")
  const nextLinkRef = requireRef(snapshot, (item) => item.selector.includes("#next-link"), "next link")

  await client.post("/browser/clear", { sessionKey, selector: "#text-input" })
  await client.post("/browser/type", { sessionKey, ref: inputRef, text: "browser tools smoke text" })
  await client.post("/browser/focus", { sessionKey, selector: "#text-input" })
  await client.post("/browser/hover", { sessionKey, selector: "#next-link" })
  await client.post("/browser/select-option", { sessionKey, selector: "#picker", value: "b" })
  await client.post("/browser/scroll", { sessionKey, direction: "down", amount: 900 })

  const uploadPath = await createUploadFixture()
  await client.post("/browser/upload-file", {
    sessionKey,
    selector: "#upload-input",
    files: [uploadPath],
  })
  await client.post("/browser/wait", {
    sessionKey,
    text: "Uploaded 1 file",
    timeoutMs: 10_000,
  })

  const updatedSnapshot = await client.post<SnapshotResult>("/browser/snapshot", { sessionKey })
  const inputState = updatedSnapshot.elements.find((item) => item.ref === inputRef)
  invariant(inputState?.value === "browser tools smoke text", "Typed input value did not persist in browser snapshot")

  const directResource = await client.post<ExtractResourceResult>("/browser/extract-resource", {
    sessionKey,
    selector: "#direct-img",
  })
  invariant(directResource.resources[0]?.downloadable === true, "Direct image should be downloadable")
  invariant(!!directResource.resources[0]?.primarySource?.url, "Direct image should expose a primary source")

  const blobResource = await client.post<ExtractResourceResult>("/browser/extract-resource", {
    sessionKey,
    selector: "#blob-img",
  })
  const blob = blobResource.resources[0]
  const blobSources = blob?.sources ?? []
  invariant(blobSources.some((item) => item.kind === "network"), "Blob image should recover a network-backed source")
  invariant(blobSources.some((item) => item.kind === "network" && !!item.mimeType), "Recovered network source should expose mimeType")
  invariant(!!blob?.primarySource?.url, "Blob image should expose a primary source")
  invariant(blob?.downloadable === true, "Blob image should become downloadable after network inference")
  invariant(blob?.recommendedAction === "browser_download_resource", "Blob image should recommend download/export")
  invariant(
    new Set(blobSources.map((item) => item.url)).size === blobSources.length,
    "Blob image sources should be merged instead of duplicated",
  )

  const capture = await client.post<{ path: string }>("/browser/capture-element", {
    sessionKey,
    selector: "#direct-img",
  })
  await requireFile(capture.path, "captured element")

  const consoleLog = await client.post<ConsoleResult>("/browser/console", {
    sessionKey,
    limit: 50,
  })
  invariant(consoleLog.entries.some((item) => item.kind === "pageerror"), "Expected pageerror entry in browser console log")
  invariant(consoleLog.entries.some((item) => item.kind === "unhandledrejection"), "Expected unhandledrejection entry in browser console log")

  const networkLog = await client.post<NetworkResult>("/browser/network", {
    sessionKey,
    limit: 100,
  })
  const assetRequest = networkLog.entries.find((item) => item.url.includes("/asset.png"))
  invariant(!!assetRequest, "Expected asset request in browser network log")
  invariant(!!assetRequest?.mimeType, "Expected mimeType on browser network log entry")
  invariant(!!assetRequest?.contentDisposition, "Expected contentDisposition on browser network log entry")

  const cachedList = await client.post<CachedResourceListResult>("/browser/list-cached-resources", {
    sessionKey,
    url: fixture.assetURL,
    limit: 10,
  })
  invariant(cachedList.indexedEntryCount >= 1, "Expected browser cache index to contain at least one entry")
  const cachedAsset = cachedList.entries.find((item) => item.url === fixture.assetURL)
  invariant(!!cachedAsset, "Expected asset.png in browser cache index")
  invariant(cachedAsset?.cacheObserved === true || cachedAsset?.observations >= 1, "Expected cached asset to carry cache observation metadata")

  const cacheOnlyMiss = await client.post<DownloadResult>("/browser/download-resource", {
    sessionKey,
    url: `${fixture.origin}/never-cached.txt`,
    filename: "never-cached.txt",
    cachePolicy: "cache-only",
  })
  invariant(cacheOnlyMiss.ok === false, "Expected cache-only miss to refuse network fallback")
  invariant(cacheOnlyMiss.sourceKind === "cache-miss", `Expected cache-only miss sourceKind=cache-miss, got ${cacheOnlyMiss.sourceKind}`)

  const preferCacheDownload = await client.post<DownloadResult>("/browser/download-resource", {
    sessionKey,
    url: fixture.assetURL,
    filename: "prefer-cache-asset.png",
    cachePolicy: "prefer-cache",
  })
  invariant(preferCacheDownload.ok === true, "Expected prefer-cache browser download to succeed")
  invariant(!!preferCacheDownload.path, "Expected prefer-cache browser download to produce a file path")
  await requireFile(preferCacheDownload.path!, "prefer-cache browser resource")
  invariant(preferCacheDownload.cacheObserved === true, "Expected prefer-cache download to observe existing cache metadata")
  invariant(preferCacheDownload.sourceKind === "cache" || preferCacheDownload.sourceKind === "network", "Expected prefer-cache download to return cache/network provenance")

  const bypassCacheDownload = await client.post<DownloadResult>("/browser/download-resource", {
    sessionKey,
    url: fixture.assetURL,
    filename: "bypass-cache-asset.png",
    cachePolicy: "bypass-cache",
  })
  invariant(bypassCacheDownload.ok === true, "Expected bypass-cache browser download to succeed")
  invariant(!!bypassCacheDownload.path, "Expected bypass-cache browser download to produce a file path")
  await requireFile(bypassCacheDownload.path!, "bypass-cache browser resource")
  invariant(bypassCacheDownload.sourceKind === "network", `Expected bypass-cache download to report network source, got ${bypassCacheDownload.sourceKind}`)

  const download = await client.post<DownloadResult>("/browser/download-resource", {
    sessionKey,
    selector: "#blob-img",
    filename: "blob-inferred-download.png",
  })
  invariant(download.ok === true, "Expected inferred browser download to succeed")
  invariant(!!download.path, "Expected inferred browser download to produce a file path")
  await requireFile(download.path!, "downloaded browser resource")
  invariant(download.url.includes("/asset.png"), `Expected inferred browser download to resolve original asset url, got ${download.url}`)

  await client.post("/browser/click", { sessionKey, ref: nextLinkRef })
  await client.post("/browser/wait-navigation", {
    sessionKey,
    url: fixture.nextURL,
    match: "equals",
    timeoutMs: 10_000,
  })
  await client.post("/browser/back", { sessionKey })
  await client.post("/browser/wait-url", {
    sessionKey,
    url: fixture.pageURL,
    match: "equals",
    timeoutMs: 10_000,
  })
  await client.post("/browser/forward", { sessionKey })
  await client.post("/browser/wait-url", {
    sessionKey,
    url: fixture.nextURL,
    match: "equals",
    timeoutMs: 10_000,
  })
  await client.post("/browser/reload", { sessionKey })
  await client.post("/browser/wait-load-state", {
    sessionKey,
    state: "load",
    timeoutMs: 10_000,
    stableMs: 500,
  })

  console.log(JSON.stringify({
    ok: true,
    windowID,
    sessionKey,
    pageURL: fixture.pageURL,
    screenshot: screenshot.path,
    capture: capture.path,
    download: download.path,
  }, null, 2))
} catch (error) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (desktopLogs.trim()) {
    console.error("[browser-tools-smoke] desktop logs")
    console.error(desktopLogs.slice(-20_000))
  }
  throw new Error(detail, { cause: error })
} finally {
  fixture.stop()
  if (desktop && desktop.exitCode === null) {
    desktop.kill()
    await desktop.exited.catch(() => undefined)
  }
}

function spawnDesktop(port: number, token: string) {
  return Bun.spawn({
    cmd: [electronExecutable, "."],
    cwd: desktopRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      LFCODE_AUTOMATION: "1",
      LFCODE_AUTOMATION_PORT: String(port),
      LFCODE_AUTOMATION_TOKEN: token,
      LFCODE_DESKTOP_HEADLESS: "1",
      LFCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      LFCODE_HOME: resolve(repoRoot, ".dev-home-browser-tools-smoke"),
    },
  })
}

async function ensureBuiltDesktop() {
  if (await stat(desktopOutSentinel).catch(() => undefined)) return
  await execFileAsync("bun", ["run", "build"], {
    cwd: desktopRoot,
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
    },
  })
}

function captureDesktopLogs(proc: Bun.Subprocess) {
  void streamToString(proc.stdout).then((text) => {
    desktopLogs += text
  })
  void streamToString(proc.stderr).then((text) => {
    desktopLogs += text
  })
}

async function streamToString(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return ""
  return await new Response(stream).text()
}

async function waitForHealth(client: ReturnType<typeof createAutomationClient>) {
  const startedAt = Date.now()
  let lastError = ""
  while (Date.now() - startedAt < 90_000) {
    try {
      return await client.get<{
        status: string
      }>("/health")
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await delay(500)
    }
  }
  throw new Error(`Timed out waiting for desktop automation health endpoint: ${lastError}`)
}

async function resolveAutomationPort() {
  const fromEnv = Number(process.env.LFCODE_AUTOMATION_PORT || "0")
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return await getAvailablePort()
}

async function getAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address !== "object") {
        server.close()
        reject(new Error("Failed to allocate automation port"))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForUiState(
  client: ReturnType<typeof createAutomationClient>,
  windowID: number,
  predicate: (state: AutomationUiState) => boolean,
) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    const payload = await client.get<{ state: AutomationUiState }>(`/diagnostics/ui-state?windowID=${windowID}`)
    if (predicate(payload.state)) return payload.state
    await delay(150)
  }
  throw new Error("Timed out waiting for renderer automation state")
}

function requireRef(snapshot: SnapshotResult, predicate: (item: SnapshotResult["elements"][number]) => boolean, label: string) {
  const match = snapshot.elements.find(predicate)
  if (match?.ref) return match.ref
  throw new Error(`Could not find snapshot ref for ${label}`)
}

async function requireFile(path: string, label: string) {
  const info = await stat(path).catch(() => undefined)
  invariant(!!info?.isFile(), `Missing ${label}: ${path}`)
}

async function createUploadFixture() {
  const dir = join(repoRoot, ".codex", "tmp")
  await mkdir(dir, { recursive: true })
  const path = join(dir, "browser-tools-smoke-upload.txt")
  await writeFile(path, "browser tools smoke upload fixture\n")
  return path
}

async function startFixtureServer() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/" || url.pathname === "/page") {
        return new Response(mainPage(url.origin), {
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        })
      }
      if (url.pathname === "/next") {
        return new Response(nextPage(url.origin), {
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        })
      }
      if (url.pathname === "/asset.png" || url.pathname === "/asset@2x.png" || url.pathname === "/poster.png") {
        return new Response(fixturePng, {
          headers: {
            "content-type": "image/png",
            "content-disposition": `inline; filename="${url.pathname.slice(1)}"`,
            "cache-control": "no-store",
          },
        })
      }
      if (url.pathname === "/movie.mp4") {
        return new Response(Buffer.from("not-a-real-mp4"), {
          headers: {
            "content-type": "video/mp4",
            "content-disposition": 'inline; filename="movie.mp4"',
            "cache-control": "no-store",
          },
        })
      }
      if (url.pathname === "/subtitle.vtt") {
        return new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello\n", {
          headers: {
            "content-type": "text/vtt; charset=utf-8",
            "cache-control": "no-store",
          },
        })
      }
      if (url.pathname === "/api/ping") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        })
      }
      return new Response("Not found", { status: 404 })
    },
  })
  const origin = `http://${server.hostname}:${server.port}`
  return {
    origin,
    assetURL: `${origin}/asset.png`,
    pageURL: `${origin}/page`,
    nextURL: `${origin}/next`,
    stop() {
      server.stop(true)
    },
  }
}

function mainPage(origin: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Browser Tools Smoke</title>
    <link rel="icon" href="${origin}/asset.png" />
    <meta property="og:image" content="${origin}/poster.png" />
    <meta name="twitter:image" content="${origin}/asset@2x.png" />
    <style>
      body { font-family: sans-serif; margin: 0; padding: 24px; min-height: 2200px; }
      .hero {
        width: 220px;
        height: 120px;
        background-image: image-set(url("${origin}/asset.png") 1x, url("${origin}/asset@2x.png") 2x);
        background-size: cover;
        border-radius: 12px;
      }
      .spacer { height: 1200px; }
    </style>
  </head>
  <body>
    <h1>Browser Tools Smoke</h1>
    <p id="ready">ready marker</p>
    <div class="hero" id="hero-bg" aria-label="hero background"></div>
    <img id="direct-img" src="${origin}/asset.png" srcset="${origin}/asset@2x.png 2x" alt="direct asset" width="120" height="120" />
    <img id="blob-img" alt="blob asset" width="120" height="120" />
    <video id="blob-video" controls poster="${origin}/poster.png" width="180" height="120"></video>
    <a id="next-link" href="${origin}/next">Open next page</a>
    <input id="text-input" placeholder="Type here" />
    <select id="picker">
      <option value="a">Alpha</option>
      <option value="b">Beta</option>
    </select>
    <input id="upload-input" type="file" />
    <div id="upload-status">Uploaded 0 files</div>
    <div class="spacer"></div>
    <div id="bottom-marker">bottom marker</div>
    <script>
      const upload = document.getElementById("upload-input")
      const uploadStatus = document.getElementById("upload-status")
      upload.addEventListener("change", () => {
        uploadStatus.textContent = "Uploaded " + upload.files.length + " file" + (upload.files.length === 1 ? "" : "s")
      })

      fetch("${origin}/api/ping").catch(() => undefined)

      fetch("${origin}/asset.png")
        .then((response) => response.blob())
        .then((blob) => {
          document.getElementById("blob-img").src = URL.createObjectURL(blob)
        })

      fetch("${origin}/movie.mp4")
        .then((response) => response.blob())
        .then((blob) => {
          const video = document.getElementById("blob-video")
          video.src = URL.createObjectURL(blob)
          const track = document.createElement("track")
          track.kind = "subtitles"
          track.label = "English"
          track.srclang = "en"
          track.src = "${origin}/subtitle.vtt"
          video.appendChild(track)
        })

      setTimeout(() => {
        throw new Error("smoke page error")
      }, 120)

      setTimeout(() => {
        Promise.reject(new Error("smoke rejection"))
      }, 180)
    </script>
  </body>
</html>`
}

function nextPage(origin: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Browser Tools Next</title>
  </head>
  <body>
    <h1>Next page</h1>
    <p><a href="${origin}/page">Back to main page</a></p>
  </body>
</html>`
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
