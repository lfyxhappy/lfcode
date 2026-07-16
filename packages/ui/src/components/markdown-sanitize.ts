import DOMPurify from "dompurify"

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

export const markdownSanitizeConfig = {
  // KaTeX radicals and stretchy operators are rendered with inline SVG.
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

export function sanitizeMarkdownHtml(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, markdownSanitizeConfig)
}
