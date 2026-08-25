const HIDDEN_ELEMENTS = /<(script|style|noscript|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const HTML_TAG = /<[^>]*>/g

export function extractTextFromHTML(html: string) {
  return decodeHTMLEntities(html.replace(HIDDEN_ELEMENTS, " ").replace(HTML_COMMENT, " ").replace(HTML_TAG, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function decodeHTMLEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name) => {
      const entities: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }
      return entities[name.toLowerCase()] ?? `&${name};`
    })
}
