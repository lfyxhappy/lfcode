import type { Cookie } from "electron"

export function browserCookieRemovalURL(
  cookie: Pick<Cookie, "secure" | "domain" | "path">,
  current: string | URL,
) {
  const url = typeof current === "string" ? new URL(current) : current
  const protocol = cookie.secure ? "https:" : url.protocol === "file:" ? "http:" : url.protocol
  const host = cookie.domain?.replace(/^\./, "") || url.hostname
  const path = cookie.path || "/"
  return `${protocol}//${host}${path}`
}
