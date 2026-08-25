type Navigate = (href: string) => void

let nav: Navigate | undefined
let pendingInternalHref: string | undefined

const isInternalHref = (href: string) => href === "/" || /^\/[^/]/.test(href)

const externalHref = (href: string) => {
  try {
    const url = new URL(href)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    return href
  } catch {
    return
  }
}

export const setNavigate = (fn: Navigate | undefined) => {
  nav = fn
  if (nav && pendingInternalHref) {
    const href = pendingInternalHref
    pendingInternalHref = undefined
    nav(href)
  }

  return () => {
    if (nav === fn) nav = undefined
  }
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (isInternalHref(href)) {
    if (nav) {
      console.info("notification-click", { target: "internal", routeReady: true, action: "navigate" })
      nav(href)
      return
    }
    pendingInternalHref = href
    console.info("notification-click", { target: "internal", routeReady: false, action: "queued" })
    return
  }
  const url = externalHref(href)
  if (!url) {
    console.warn("notification-click", { target: "unsupported", action: "ignored" })
    return
  }
  console.info("notification-click", { target: "external", action: "open" })
  if (window.api?.openExternalLink) {
    window.api.openExternalLink(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}
