const LEGACY_STORE_PREFIXES = ["opencode", "mimocode"] as const
const MERGED_STORE_KEYS = new Set(["layout", "layout.page", "server"])

function normalizeWorktree(worktree: string) {
  const value = worktree.replaceAll("\\", "/")
  const drive = value.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1]}/`
  if (/^\/+$/i.test(value)) return "/"
  return value.replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return
  try {
    return JSON.parse(value) as unknown
  } catch {
    return
  }
}

function stringify(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value)
}

function mergeArray(current: unknown[], legacy: unknown[]) {
  if (current.length === 0) return legacy
  if (legacy.length === 0) return current

  const keyed = legacy.every((item) => isRecord(item) && typeof item.worktree === "string") &&
    current.every((item) => isRecord(item) && typeof item.worktree === "string")
  if (keyed) {
    const merged = new Map<string, unknown>()
    for (const item of legacy) {
      merged.set(normalizeWorktree((item as { worktree: string }).worktree), {
        ...(item as { worktree: string }),
        worktree: normalizeWorktree((item as { worktree: string }).worktree),
      })
    }
    for (const item of current) {
      merged.set(normalizeWorktree((item as { worktree: string }).worktree), {
        ...(item as { worktree: string }),
        worktree: normalizeWorktree((item as { worktree: string }).worktree),
      })
    }
    return [...merged.values()]
  }

  const merged = new Map<string, unknown>()
  for (const item of legacy) merged.set(JSON.stringify(item), item)
  for (const item of current) merged.set(JSON.stringify(item), item)
  return [...merged.values()]
}

function mergeValue(current: unknown, legacy: unknown): unknown {
  if (current === undefined) return legacy
  if (current === null || legacy === null) return current ?? legacy
  if (Array.isArray(current) && Array.isArray(legacy)) return mergeArray(current, legacy)

  if (isRecord(current) && isRecord(legacy)) {
    const result: Record<string, unknown> = { ...legacy }
    for (const [key, value] of Object.entries(current)) {
      result[key] = key in legacy ? mergeValue(value, legacy[key]) : value
    }
    return result
  }

  return current
}

export function renameLegacyStore(filename: string) {
  for (const prefix of LEGACY_STORE_PREFIXES) {
    if (!filename.startsWith(`${prefix}.`)) continue
    return `lfcode.${filename.slice(prefix.length + 1)}`
  }
  return
}

export function mergeLegacyStoreValue(key: string, current: unknown, legacy: unknown) {
  if (current === undefined) return legacy
  if (!MERGED_STORE_KEYS.has(key)) return current

  const currentJson = parseJson(current)
  const legacyJson = parseJson(legacy)
  if (currentJson === undefined || legacyJson === undefined) return current

  return stringify(mergeValue(currentJson, legacyJson))
}
