export type RenderCodeBlockInput = {
  language: string
  code: string
  raw: string
  /** The original fence title, when one was provided. */
  title?: string
  /** A normalized project-relative path derived from the fence title. */
  projectPath?: string
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
      title?: string
      projectPath?: string
      blockIndex: number
    }

const FENCE_PATTERN = /```([^\n`]*)\n([\s\S]*?)```/g

/**
 * Markdown fence titles are intentionally a small, strict contract. They are
 * not allowed to address a drive, an absolute path, or a parent directory.
 * Keeping this parser independent of the host path module also makes the
 * message renderer behave identically in the browser and Electron.
 */
export function normalizeProjectRelativePath(value: string) {
  const input = value.trim().replace(/\\/g, "/")
  if (!input || input.includes("\0")) return
  if (input.startsWith("/") || /^[a-zA-Z]:/.test(input)) return
  if (input.endsWith("/")) return

  const parts = input.split("/")
  if (parts[0]?.includes(":")) return
  if (parts.some((part) => part === "..")) return
  const normalized = parts.filter((part) => part && part !== ".").join("/")
  if (!normalized) return
  return normalized
}

function parseFenceInfo(info: string) {
  const value = info.trim()
  const first = value.split(/\s+/)[0] ?? ""
  const language = first.toLowerCase().startsWith("title=") ? "" : first.toLowerCase()
  const titleMatch = value.match(/(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|([^\s]+))/i)
  const title = titleMatch?.[1] ?? titleMatch?.[2] ?? titleMatch?.[3]
  return {
    language,
    title,
    projectPath: title ? normalizeProjectRelativePath(title) : undefined,
  }
}

export function splitRenderableCodeBlocks(markdown: string) {
  const result: MessageCodeBlockSegment[] = []
  let lastIndex = 0
  let blockIndex = 0

  for (const match of markdown.matchAll(FENCE_PATTERN)) {
    const start = match.index ?? 0
    const raw = match[0] ?? ""
    const normalizedRaw = raw.replace(/\r\n?/g, "\n")
    const info = (match[1] ?? "").trim()
    const parsed = parseFenceInfo(info)

    if (start > lastIndex) {
      result.push({
        type: "markdown",
        text: markdown.slice(lastIndex, start),
      })
    }

    result.push({
      type: "code",
      language: parsed.language,
      code: (match[2] ?? "").replace(/\r\n?/g, "\n"),
      raw: normalizedRaw,
      ...(parsed.title ? { title: parsed.title } : {}),
      ...(parsed.projectPath ? { projectPath: parsed.projectPath } : {}),
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
