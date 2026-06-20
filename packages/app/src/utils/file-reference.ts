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

function preferredSeparator(value: string): "\\" | "/" {
  return value.includes("\\") ? "\\" : "/"
}

function normalizeSeparators(value: string, separator: "\\" | "/") {
  const unified = value.replace(/[\\/]+/g, "/")
  return separator === "\\" ? unified.replace(/\//g, "\\") : unified
}

function normalizePath(value: string, separator = preferredSeparator(value)) {
  const unified = value.replace(/[\\/]+/g, "/")
  const prefix = WINDOWS_ABSOLUTE.test(unified)
    ? unified.slice(0, 2)
    : unified.startsWith("//")
      ? "//"
      : unified.startsWith("/")
        ? "/"
        : ""
  const body = prefix === "//" ? unified.slice(2) : prefix ? unified.slice(prefix.length) : unified
  const stack: string[] = []

  for (const segment of body.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      const last = stack.at(-1)
      if (last && last !== "..") {
        stack.pop()
        continue
      }
      if (!prefix) stack.push("..")
      continue
    }
    stack.push(segment)
  }

  const joined = stack.join("/")
  const normalized =
    prefix === "//" ? `//${joined}` : prefix ? `${prefix}${joined ? `/${joined}` : ""}` : joined || "."
  return normalizeSeparators(normalized, separator)
}

function joinPath(base: string, relative: string) {
  const separator = preferredSeparator(base)
  const left = normalizeSeparators(base, separator).replace(/[\\/]+$/g, "")
  const right = relative.replace(/^[\\/]+/g, "")
  return normalizePath(`${left}${separator}${right}`, separator)
}

export function resolveFileReferencePath(value: string, baseDir?: string) {
  const next = stripTrailingPathPunctuation(value.trim())
  if (!next) return
  if (LOCAL_SCHEME.test(next)) {
    try {
      const url = new URL(next)
      return normalizePath(decodeURIComponent(url.pathname.replace(/^\/(?=[A-Za-z]:\/)/u, "")))
    } catch {
      return
    }
  }
  if (WINDOWS_ABSOLUTE.test(next) || POSIX_ABSOLUTE.test(next)) return normalizePath(next)
  if (!baseDir) return
  if (!RELATIVE_PREFIX.test(next) && !PATH_TEXT.test(next) && !FILE_EXTENSION.test(next)) return
  return joinPath(baseDir, next)
}

export function getParentPath(value: string) {
  const normalized = normalizePath(value)
  const separator = preferredSeparator(normalized)
  const trimmed = normalized.replace(/[\\/]+$/g, "")
  const parts = trimmed.split(/[\\/]/)
  if (parts.length <= 1) return
  if (WINDOWS_ABSOLUTE.test(trimmed) && parts.length === 1) return
  const parent = parts.slice(0, -1).join(separator)
  if (!parent || parent === trimmed) return
  return parent
}
