const MAX_VIEW_STATES = 24

type ViewEntry = {
  key: string
  updatedAt: number
  state: import("monaco-editor").editor.ICodeEditorViewState | null
}

const entries = new Map<string, ViewEntry>()

export function loadCodeEditorViewState(path: string) {
  const key = toKey(path)
  const entry = entries.get(key)
  if (!entry) return
  entry.updatedAt = Date.now()
  return entry.state
}

export function saveCodeEditorViewState(path: string, state: import("monaco-editor").editor.ICodeEditorViewState | null) {
  const key = toKey(path)
  entries.set(key, {
    key,
    state,
    updatedAt: Date.now(),
  })
  pruneViewStates()
}

function toKey(path: string) {
  return path.toLowerCase()
}

function pruneViewStates() {
  if (entries.size <= MAX_VIEW_STATES) return
  const removable = Array.from(entries.values()).sort((a, b) => a.updatedAt - b.updatedAt)
  for (const entry of removable.slice(0, entries.size - MAX_VIEW_STATES)) {
    entries.delete(entry.key)
  }
}
