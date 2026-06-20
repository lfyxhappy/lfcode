export type FileReferenceKind = "file" | "directory" | "unknown"

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u
const POSIX_ABSOLUTE = /^\//u
const RELATIVE_PREFIX = /^(\.\.?[\\/])/u
const LOCAL_SCHEME = /^file:\/\//iu
const WEB_SCHEME = /^(https?:)?\/\//iu
const TRAILING_PUNCTUATION = /[),.;:!?]+$/u
const FILE_EXTENSION = /\.[A-Za-z0-9_-]{1,16}$/u
const PATH_TEXT = /[\\/]/u

export function stripTrailingPathPunctuation(value: string) {
  return value.replace(TRAILING_PUNCTUATION, "")
}

export function isLocalFileHref(value: string) {
  if (!value) return false
  if (WEB_SCHEME.test(value)) return false
  if (LOCAL_SCHEME.test(value)) return true
  return isPathLike(value)
}

export function isPathLike(value: string) {
  const next = stripTrailingPathPunctuation(value.trim())
  if (!next) return false
  if (WEB_SCHEME.test(next)) return false
  if (WINDOWS_ABSOLUTE.test(next)) return true
  if (POSIX_ABSOLUTE.test(next)) return true
  if (RELATIVE_PREFIX.test(next)) return true
  if (PATH_TEXT.test(next)) return true
  return FILE_EXTENSION.test(next)
}

export function looksLikeCommand(value: string) {
  const next = value.trim()
  if (!next) return false
  if (/\s/u.test(next) && !/[\\/]/u.test(next)) return true
  return /^(bun|git|npm|pnpm|yarn|python|node|cmd|pwsh|powershell)\b/u.test(next)
}

export function inferFileReferenceKind(value: string): FileReferenceKind {
  const next = stripTrailingPathPunctuation(value.trim())
  if (!next) return "unknown"
  if (/[\\/]$/.test(next)) return "directory"
  if (FILE_EXTENSION.test(next)) return "file"
  return "unknown"
}
