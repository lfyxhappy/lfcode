import { base64Encode } from "@lfcode-ai/shared/util/encode"

type BrowserAuthorizationScope = "read" | "interactive"

type BrowserAuthorization = {
  scope: BrowserAuthorizationScope
  source: "user-request" | "legacy-confirmation" | "existing-target"
  createdAt: number
}

const authorizedSessions = new Map<string, BrowserAuthorization>()

export function browserSessionKey(input: { directory: string; sessionID: string }) {
  return `${base64Encode(input.directory.replace(/\\/g, "/"))}/${input.sessionID}`
}

export function browserConfirmationRequired(input: { sessionKey: string; url: string; reason: string }) {
  return {
    type: "browser_confirmation_required" as const,
    sessionKey: input.sessionKey,
    url: input.url,
    reason: input.reason,
    scope: "session-browser-read" as const,
  }
}

export function allowBrowserNavigation(input: { sessionKey: string; hasTarget: boolean; confirm?: boolean }) {
  const existing = authorizedSessions.get(input.sessionKey)
  if (input.hasTarget || existing?.scope === "interactive" || input.confirm === true) {
    authorizeBrowserSession({
      sessionKey: input.sessionKey,
      scope: "interactive",
      source: input.confirm ? "legacy-confirmation" : input.hasTarget ? "existing-target" : "user-request",
    })
    return true
  }
  return false
}

export function authorizeBrowserSession(input: {
  sessionKey: string
  scope: BrowserAuthorizationScope
  source?: BrowserAuthorization["source"]
}) {
  const current = authorizedSessions.get(input.sessionKey)
  if (current?.scope === "interactive") return current
  const next = {
    scope: input.scope,
    source: input.source ?? "user-request",
    createdAt: Date.now(),
  } satisfies BrowserAuthorization
  authorizedSessions.set(input.sessionKey, next)
  return next
}

export function browserSessionAuthorization(sessionKey: string) {
  return authorizedSessions.get(sessionKey)
}

export function clearBrowserNavigationAuthorization(sessionKey: string) {
  authorizedSessions.delete(sessionKey)
}

export function resetBrowserNavigationAuthorizations() {
  authorizedSessions.clear()
}
