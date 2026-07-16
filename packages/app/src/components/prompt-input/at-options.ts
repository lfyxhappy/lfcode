import type { AtOption } from "./slash-popover"

export function buildPromptAtOptions(open: string[], query: string, paths: string[]) {
  const seen = new Set(open)
  const pinned: AtOption[] = open.map((path) => ({ path, display: path, recent: true }))
  if (!query.trim()) return pinned
  const fileOptions: AtOption[] = paths.filter((path) => !seen.has(path)).map((path) => ({ path, display: path }))
  return [...pinned, ...fileOptions]
}
