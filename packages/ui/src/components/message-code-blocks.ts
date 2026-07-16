export type RenderCodeBlockInput = {
  language: string
  code: string
  raw: string
  blockIndex: number
  message: {
    id: string
    sessionID: string
    role: string
  }
  partID: string
}

export type MessageCodeBlockSegment =
  | {
      type: "markdown"
      text: string
    }
  | {
      type: "code"
      language: string
      code: string
      raw: string
      blockIndex: number
    }

const RENDERABLE_LANGUAGES = new Set([
  "cpp",
  "c++",
  "cc",
  "cxx",
  "c",
  "typescript",
  "ts",
  "tsx",
  "javascript",
  "js",
  "jsx",
  "json",
  "python",
  "py",
  "powershell",
  "pwsh",
  "ps1",
  "markdown",
  "md",
  "html",
  "css",
  "scss",
  "less",
  "shell",
  "shellscript",
  "bash",
  "sh",
  "zsh",
])
const FENCE_PATTERN = /```([^\n`]*)\n([\s\S]*?)```/g

export function splitRenderableCodeBlocks(markdown: string) {
  const result: MessageCodeBlockSegment[] = []
  let lastIndex = 0
  let blockIndex = 0

  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    const start = match.index ?? 0
    const raw = match[0] ?? ""
    const info = (match[1] ?? "").trim()
    const language = info.split(/\s+/)[0]?.toLowerCase() ?? ""
    if (!RENDERABLE_LANGUAGES.has(language)) continue

    if (start > lastIndex) {
      result.push({
        type: "markdown",
        text: markdown.slice(lastIndex, start),
      })
    }

    result.push({
      type: "code",
      language,
      code: (match[2] ?? "").replace(/\r\n?/g, "\n"),
      raw,
      blockIndex,
    })
    blockIndex += 1
    lastIndex = start + raw.length
  }

  if (lastIndex < markdown.length) {
    result.push({
      type: "markdown",
      text: markdown.slice(lastIndex),
    })
  }

  if (result.length === 0) {
    return [{ type: "markdown" as const, text: markdown }]
  }

  return result
}
