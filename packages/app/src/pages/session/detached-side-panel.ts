export type DetachedSidePanelKind = "file" | "browser" | "review"

export type DetachedSidePanelContext = {
  detachedWindowID: string
  sessionKey: string
  route: string
  tab: string
  kind: DetachedSidePanelKind
}

function parseHashRoute(value: string) {
  const hash = value.startsWith("#") ? value.slice(1) : value
  if (!hash) return
  const url = new URL(hash, "http://lfcode.local")
  const detachedWindowID = url.searchParams.get("detachedWindowID")
  const sessionKey = url.searchParams.get("sessionKey")
  const tab = url.searchParams.get("tab")
  const kind = url.searchParams.get("kind")
  if (!detachedWindowID || !sessionKey || !tab) return
  if (kind !== "file" && kind !== "browser" && kind !== "review") return
  return {
    detachedWindowID,
    sessionKey,
    route: `${url.pathname}${url.search}`,
    tab,
    kind,
  } satisfies DetachedSidePanelContext
}

export function getDetachedSidePanelContext() {
  if (typeof location !== "object") return
  return parseHashRoute(location.hash)
}

export function buildDetachedSidePanelRoute(input: {
  detachedWindowID: string
  sessionKey: string
  tab: string
  kind: DetachedSidePanelKind
}) {
  const slash = input.sessionKey.indexOf("/")
  const dir = slash >= 0 ? input.sessionKey.slice(0, slash) : input.sessionKey
  const sessionID = slash >= 0 ? input.sessionKey.slice(slash + 1) : ""
  const params = new URLSearchParams({
    detachedWindowID: input.detachedWindowID,
    sessionKey: input.sessionKey,
    tab: input.tab,
    kind: input.kind,
  })
  return `/${dir}/session/${sessionID}?${params.toString()}`
}
