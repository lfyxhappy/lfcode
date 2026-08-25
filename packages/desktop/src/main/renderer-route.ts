const rendererProtocol = "oc"
const rendererHost = "renderer"

export function appRouteFromRendererNavigation(input: string) {
  try {
    const url = new URL(input)
    if (url.protocol !== `${rendererProtocol}:` || url.host !== rendererHost) return
    const path = url.pathname || "/"
    if (path === "/index.html" || path === "/loading.html") return
    return `${path}${url.search}${url.hash}`
  } catch {
    return
  }
}
