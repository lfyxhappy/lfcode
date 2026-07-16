export function detectPromptPopover(input: {
  mode: "normal" | "shell"
  rawText: string
  cursorPosition: number
}) {
  if (input.mode === "shell") return { popover: null, query: undefined } as const

  const beforeCursor = input.rawText.substring(0, input.cursorPosition)
  const agentMatch = beforeCursor.match(/\$(\S*)$/)
  if (agentMatch) return { popover: "agent", query: agentMatch[1] } as const

  const atMatch = beforeCursor.match(/@(\S*)$/)
  if (atMatch) return { popover: "at", query: atMatch[1] } as const

  const slashMatch = input.rawText.match(/^\/(\S*)$/)
  if (slashMatch) return { popover: "slash", query: slashMatch[1] } as const

  return { popover: null, query: undefined } as const
}

export function pickActivePopoverItem<T>(
  items: T[],
  active: string | null | undefined,
  keyFor: (item: T) => string | undefined,
) {
  if (items.length === 0) return
  return items.find((item) => keyFor(item) === active) ?? items[0]
}
