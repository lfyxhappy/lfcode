import { replaceHtmlComponentFences } from "./markdown-html-component"

export function extractMarkdownCodeLanguages(source: string) {
  return [...replaceHtmlComponentFences(source).matchAll(/```([^\n`]*)\n[\s\S]*?```/g)].map((match) => {
    const first = match[1]?.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
    return first.startsWith("title=") ? "text" : first || "text"
  })
}
