import { randomUUID } from "node:crypto"
import { BrowserWindow, safeStorage, session, type Cookie, type Event, type WebContents } from "electron"
import type {
  BrowserAutofillCandidate,
  BrowserAutofillMatch,
  BrowserAutofillRequest,
  BrowserCookieIdentity,
  BrowserCookieRecord,
  BrowserPasswordCapturePayload,
  BrowserPasswordCapturePrompt,
  BrowserPasswordPromptAck,
  BrowserPasswordStorageState,
  SavedBrowserLoginRecord,
  SavedBrowserLoginUpsert,
} from "@lfcode-ai/shared/desktop-browser-management"
import { browserPartition, recordBrowserConsole } from "./browser-runtime"
import { browserCookieRemovalURL } from "./browser-runtime-core"
import { getStore } from "./store"
import { matchSavedBrowserLoginsByOrigin, upsertSavedBrowserLoginRecords } from "./browser-management-core"

const BROWSER_SETTINGS_STORE = "default.dat"
const BROWSER_SETTINGS_KEY = "settings.v3"
const BROWSER_LOGIN_STORE = "lfcode.browser"
const BROWSER_LOGIN_KEY = "savedLogins.v1"
const PAGE_ERROR_PREFIX = "__LFCODE_PAGEERROR__"
const UNHANDLED_REJECTION_PREFIX = "__LFCODE_UNHANDLEDREJECTION__"

const guestWindows = new Map<number, number>()
const pendingPrompts = new Map<
  string,
  {
    guestID: number
    origin: string
    username: string
    password: string
  }
>()

type BrowserSettingsSnapshot = {
  browser?: {
    autofillEnabled?: boolean
    promptToSavePasswords?: boolean
  }
}

export function wireBrowserGuest(input: {
  sourceWindowID: number
  guest: WebContents
}) {
  guestWindows.set(input.guest.id, input.sourceWindowID)
  const onConsoleMessage = (_event: Event, level: number, message: string, line: number, sourceId: string) => {
    const pageError = parseSpecialConsoleEntry(message)
    if (pageError) {
      recordBrowserConsole({
        guestID: input.guest.id,
        entry: {
          level: "error",
          kind: pageError.kind,
          message: pageError.message,
          sourceId: pageError.sourceId,
          line: pageError.line,
          column: pageError.column,
          stack: pageError.stack,
          time: Date.now(),
        },
      })
      return
    }
    recordBrowserConsole({
      guestID: input.guest.id,
      entry: {
        level: consoleLevel(level),
        kind: "console",
        message,
        sourceId: sourceId || undefined,
        line: Number.isFinite(line) ? line : undefined,
        time: Date.now(),
      },
    })
  }
  const onDomReady = () => {
    void input.guest.executeJavaScript(pageErrorHookScript(), true).catch(() => undefined)
  }
  const onDidNavigate = (_event: Event, url: string) => {
    const origin = normalizeOrigin(url)
    for (const [id, prompt] of pendingPrompts) {
      if (prompt.guestID === input.guest.id && prompt.origin !== origin) pendingPrompts.delete(id)
    }
  }
  input.guest.on("console-message", onConsoleMessage)
  input.guest.on("dom-ready", onDomReady)
  input.guest.on("did-navigate", onDidNavigate)
  const cleanup = () => {
    guestWindows.delete(input.guest.id)
    for (const [id, prompt] of pendingPrompts) {
      if (prompt.guestID === input.guest.id) pendingPrompts.delete(id)
    }
    input.guest.removeListener("console-message", onConsoleMessage)
    input.guest.removeListener("dom-ready", onDomReady)
    input.guest.removeListener("did-navigate", onDidNavigate)
  }
  input.guest.once("destroyed", cleanup)
}

function consoleLevel(level: number) {
  if (level === 0) return "info"
  if (level === 1) return "warning"
  if (level === 2) return "error"
  if (level === 3) return "debug"
  return "log"
}

function parseSpecialConsoleEntry(message: string) {
  const prefix =
    message.startsWith(PAGE_ERROR_PREFIX)
      ? PAGE_ERROR_PREFIX
      : message.startsWith(UNHANDLED_REJECTION_PREFIX)
        ? UNHANDLED_REJECTION_PREFIX
        : undefined
  if (!prefix) return undefined
  try {
    const payload = JSON.parse(message.slice(prefix.length)) as {
      message?: string
      sourceId?: string
      line?: number
      column?: number
      stack?: string
    }
    return {
      kind: prefix === PAGE_ERROR_PREFIX ? "pageerror" : "unhandledrejection",
      message: payload.message || "Unknown page error",
      sourceId: payload.sourceId || undefined,
      line: Number.isFinite(payload.line) ? payload.line : undefined,
      column: Number.isFinite(payload.column) ? payload.column : undefined,
      stack: payload.stack || undefined,
    } as const
  } catch {
    return {
      kind: prefix === PAGE_ERROR_PREFIX ? "pageerror" : "unhandledrejection",
      message: message.slice(prefix.length) || "Unknown page error",
    } as const
  }
}

function pageErrorHookScript() {
  return `(() => {
    if (window.__lfcodeBrowserErrorHooksInstalled) return true
    window.__lfcodeBrowserErrorHooksInstalled = true
    const emit = (prefix, payload) => {
      try {
        console.error(prefix + JSON.stringify(payload))
      } catch {
        console.error(prefix + String(payload?.message || "unknown"))
      }
    }
    window.addEventListener("error", (event) => {
      emit(${JSON.stringify(PAGE_ERROR_PREFIX)}, {
        message: event.message || String(event.error?.message || event.error || "Unknown page error"),
        sourceId: event.filename || undefined,
        line: Number.isFinite(event.lineno) ? event.lineno : undefined,
        column: Number.isFinite(event.colno) ? event.colno : undefined,
        stack: typeof event.error?.stack === "string" ? event.error.stack : undefined,
      })
    })
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason
      emit(${JSON.stringify(UNHANDLED_REJECTION_PREFIX)}, {
        message:
          typeof reason === "string"
            ? reason
            : typeof reason?.message === "string"
              ? reason.message
              : String(reason || "Unhandled promise rejection"),
        stack: typeof reason?.stack === "string" ? reason.stack : undefined,
      })
    })
    return true
  })()`
}

export function listBrowserCookies() {
  return browserSession()
    .cookies.get({})
    .then((items) => items.map(serializeBrowserCookie).sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name)))
}

export async function removeBrowserCookie(cookie: BrowserCookieIdentity) {
  await browserSession().cookies.remove(browserCookieRemovalURL(cookie, removalOrigin(cookie)), cookie.name)
}

export async function clearBrowserCookiesByDomain(domain: string) {
  const normalized = normalizeCookieDomain(domain)
  const cookies = await browserSession().cookies.get({})
  const matches = cookies.filter((item) => normalizeCookieDomain(item.domain ?? "") === normalized)
  await Promise.all(matches.map((item) => browserSession().cookies.remove(browserCookieRemovalURL(item, removalOrigin(item)), item.name)))
  return matches.length
}

export async function clearAllBrowserCookies() {
  const cookies = await browserSession().cookies.get({})
  await Promise.all(cookies.map((item) => browserSession().cookies.remove(browserCookieRemovalURL(item, removalOrigin(item)), item.name)))
  return cookies.length
}

export function getBrowserPasswordStorageState(): BrowserPasswordStorageState {
  if (safeStorage.isEncryptionAvailable()) return { available: true }
  return {
    available: false,
    reason: "safeStorageUnavailable",
  }
}

export function listSavedBrowserLogins() {
  return Promise.resolve(loadSavedBrowserLogins())
}

export function upsertSavedBrowserLogin(input: SavedBrowserLoginUpsert) {
  const passwordEncrypted = resolvePasswordEncrypted(input)
  const next = upsertSavedBrowserLoginRecords(loadSavedBrowserLogins(), input, passwordEncrypted, Date.now())
  saveSavedBrowserLogins(next)
  return Promise.resolve(next[next.length - 1]!)
}

export function deleteSavedBrowserLogin(id: string) {
  saveSavedBrowserLogins(loadSavedBrowserLogins().filter((item) => item.id !== id))
  return Promise.resolve()
}

export function acknowledgeBrowserSavePasswordPrompt(input: BrowserPasswordPromptAck) {
  const prompt = pendingPrompts.get(input.id)
  pendingPrompts.delete(input.id)
  if (!input.save || !prompt) return Promise.resolve(null)
  return upsertSavedBrowserLogin({
    origin: prompt.origin,
    username: prompt.username,
    password: prompt.password,
  })
}

export function listBrowserAutofillCandidates(origin: string): BrowserAutofillCandidate[] {
  const settings = readBrowserSettings()
  if (!settings.browser?.autofillEnabled) return []
  if (!safeStorage.isEncryptionAvailable()) return []
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) return []

  return matchSavedBrowserLoginsByOrigin(loadSavedBrowserLogins(), origin).map((item) => ({
    id: item.id,
    origin: item.origin,
    username: item.username,
  }))
}

export function resolveBrowserAutofill(input: BrowserAutofillRequest): BrowserAutofillMatch | null {
  const settings = readBrowserSettings()
  if (!settings.browser?.autofillEnabled) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  if (!input.origin.startsWith("http://") && !input.origin.startsWith("https://")) return null

  const match = matchSavedBrowserLoginsByOrigin(loadSavedBrowserLogins(), input.origin).find((item) => item.id === input.id)
  if (!match) return null
  const password = decryptPassword(match.passwordEncrypted)
  if (!password) return null
  return {
    username: match.username,
    password,
  }
}

export function captureBrowserPassword(input: {
  guestID: number
  payload: BrowserPasswordCapturePayload
}) {
  if (!input.payload.origin.startsWith("http://") && !input.payload.origin.startsWith("https://")) return
  if (!input.payload.password) return
  if (!safeStorage.isEncryptionAvailable()) return
  const settings = readBrowserSettings()
  if (!settings.browser?.promptToSavePasswords) return

  const winID = guestWindows.get(input.guestID)
  if (!winID) return
  const win = BrowserWindow.fromId(winID)
  if (!win || win.isDestroyed()) return

  const id = randomUUID()
  pendingPrompts.set(id, {
    guestID: input.guestID,
    origin: input.payload.origin,
    username: input.payload.username,
    password: input.payload.password,
  })
  setTimeout(() => pendingPrompts.delete(id), 2 * 60 * 1000).unref()
  win.webContents.send("browser-password-capture", {
    id,
    origin: input.payload.origin,
    username: input.payload.username,
  } satisfies BrowserPasswordCapturePrompt)
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function browserSession() {
  return session.fromPartition(browserPartition())
}

function serializeBrowserCookie(cookie: Cookie): BrowserCookieRecord {
  return {
    name: cookie.name ?? "",
    domain: cookie.domain ?? "",
    path: cookie.path ?? "/",
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    sameSite: String(cookie.sameSite),
    session: cookie.session ?? false,
    expirationDate: cookie.expirationDate ?? null,
  }
}

function normalizeCookieDomain(domain: string) {
  return domain.replace(/^\./, "").toLowerCase()
}

function removalOrigin(cookie: Pick<Cookie, "domain" | "secure" | "path">) {
  const host = cookie.domain?.replace(/^\./, "") || "localhost"
  return `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`
}

function readBrowserSettings() {
  const raw = getStore(BROWSER_SETTINGS_STORE).get(BROWSER_SETTINGS_KEY)
  if (typeof raw !== "string") return {} satisfies BrowserSettingsSnapshot
  try {
    return JSON.parse(raw) as BrowserSettingsSnapshot
  } catch {
    return {} satisfies BrowserSettingsSnapshot
  }
}

function loadSavedBrowserLogins() {
  const raw = getStore(BROWSER_LOGIN_STORE).get(BROWSER_LOGIN_KEY)
  if (!Array.isArray(raw)) return [] as SavedBrowserLoginRecord[]
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    if (typeof item.id !== "string") return []
    if (typeof item.origin !== "string") return []
    if (typeof item.username !== "string") return []
    if (typeof item.passwordEncrypted !== "string") return []
    if (typeof item.createdAt !== "number") return []
    if (typeof item.updatedAt !== "number") return []
    return [item as SavedBrowserLoginRecord]
  })
}

function saveSavedBrowserLogins(logins: SavedBrowserLoginRecord[]) {
  getStore(BROWSER_LOGIN_STORE).set(BROWSER_LOGIN_KEY, logins)
}

function resolvePasswordEncrypted(input: SavedBrowserLoginUpsert) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Browser password storage is unavailable on this system")
  }
  if (input.password) return safeStorage.encryptString(input.password).toString("base64")
  if (input.passwordEncrypted) return input.passwordEncrypted
  throw new Error("Browser password is required")
}

function decryptPassword(value: string) {
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"))
  } catch {
    return
  }
}
