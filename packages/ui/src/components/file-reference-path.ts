export type FileReferenceKind = "file" | "directory" | "unknown"

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u
const POSIX_ABSOLUTE = /^\//u
const RELATIVE_PREFIX = /^(\.\.?[\\/])/u
const LOCAL_SCHEME = /^file:\/\//iu
const WEB_SCHEME = /^(https?:)?\/\//iu
const TRAILING_PUNCTUATION = /[),.;:!?]+$/u
const FILE_EXTENSION = /\.[A-Za-z0-9_-]{1,16}$/u
const PATH_SEPARATOR = /[\\/]/u
const PATH_SEGMENT = /^[A-Za-z0-9._-]+$/u
const DIGIT_ONLY = /^\d+$/u
const SHORT_BARE_PATH = /^[A-Za-z0-9._-]+[\\/][A-Za-z0-9._-]+$/u
const HAS_PATH_SIGNAL = /[._-]/u

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
  if (isStrictPosixAbsolutePath(next)) return true
  if (RELATIVE_PREFIX.test(next)) return isStructuredRelativePath(next)
  if (hasBarePathStructure(next)) return true
  return false
}

export function looksLikeCommand(value: string) {
  const next = value.trim()
  if (!next) return false
  if (/\s/u.test(next) && !PATH_SEPARATOR.test(next)) return true
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
  if (!RELATIVE_PREFIX.test(next) && !PATH_SEPARATOR.test(next) && !FILE_EXTENSION.test(next)) return
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

export function getPlainTextPathMatch(text: string, startIndex = 0) {
  const candidate = findPlainTextPathCandidate(text, startIndex)
  if (!candidate) return
  const value = stripTrailingPathPunctuation(candidate.value)
  if (!value || !isPlainTextPathLike(value)) return
  return { ...candidate, value }
}

function findPlainTextPathCandidate(text: string, startIndex: number) {
  const length = text.length
  let index = startIndex

  while (index < length) {
    const start = findCandidateStart(text, index)
    if (start < 0) return

    const end = findCandidateEnd(text, start)
    const value = text.slice(start, end)
    if (value && isPlainTextPathLike(stripTrailingPathPunctuation(value))) return { start, end, value }

    index = start + 1
  }
}

function findCandidateStart(text: string, fromIndex: number) {
  for (let index = fromIndex; index < text.length; index += 1) {
    const char = text[index]
    if (char === "\\" || char === "/") {
      if (isWordBoundary(text, index - 1) && isWordBoundary(text, index + 1) && hasPathLead(text, index + 1)) return index
      continue
    }
    if (hasPathLead(text, index)) return index
  }
  return -1
}

function findCandidateEnd(text: string, start: number) {
  let index = start
  for (; index < text.length; index += 1) {
    const char = text[index]
    if (isPathChar(char) || (char === ":" && index === start + 1 && /^[A-Za-z]$/u.test(text[start]))) continue
    break
  }
  return index
}

function isPlainTextPathLike(value: string) {
  if (looksLikeCommand(value)) return false
  if (WINDOWS_ABSOLUTE.test(value)) return true
  if (isStrictPosixAbsolutePath(value)) return true
  if (RELATIVE_PREFIX.test(value)) return isStructuredRelativePath(value)
  return hasBarePathStructure(value)
}

function isStructuredRelativePath(value: string) {
  const body = stripLeadingRelativePrefix(value)
  if (!body) return false
  if (WINDOWS_ABSOLUTE.test(body)) return true
  if (isStrictPosixAbsolutePath(body)) return true
  if (FILE_EXTENSION.test(body)) return true
  return hasPathSegments(body) && hasPathSignal(body)
}

function isStrictPosixAbsolutePath(value: string) {
  if (!POSIX_ABSOLUTE.test(value)) return false
  if (value === "/") return false
  const body = value.slice(1)
  if (!body || body === "n" || DIGIT_ONLY.test(body)) return false
  const segments = body.split("/").filter(Boolean)
  if (segments.length < 2) return FILE_EXTENSION.test(segments[0] ?? body) || FILE_EXTENSION.test(body)
  return segments.every((segment) => isPathSegment(segment) || FILE_EXTENSION.test(segment))
}

function hasBarePathStructure(value: string) {
  if (!value || value.includes("://")) return false
  if (WINDOWS_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value) || RELATIVE_PREFIX.test(value)) return false
  if (SHORT_BARE_PATH.test(value)) {
    const [left, right] = value.split(/[\\/]/)
    if (!left || !right) return false
    if (DIGIT_ONLY.test(left) || DIGIT_ONLY.test(right)) return false
    if (isDateLikeSegments(left, right)) return false
    return hasPathSignal(left) || hasPathSignal(right) || FILE_EXTENSION.test(right)
  }
  if (!PATH_SEPARATOR.test(value)) return false
  const segments = value.split(/[\\/]/).filter(Boolean)
  if (segments.length < 2) return false
  if (segments.some((segment) => DIGIT_ONLY.test(segment))) return false
  if (isDateLikeSegments(segments[0] ?? "", segments[1] ?? "")) return false
  return segments.every((segment, index) => {
    if (index === 0 && segment.length === 1) return false
    return hasPathSignal(segment) || FILE_EXTENSION.test(segment) || segment.length > 1
  })
}

function hasPathSegments(value: string) {
  const segments = value.split(/[\\/]/).filter(Boolean)
  if (segments.length < 2) return false
  if (segments.some((segment) => DIGIT_ONLY.test(segment))) return false
  return segments.every((segment) => isPathSegment(segment) || FILE_EXTENSION.test(segment))
}

function isPathSegment(segment: string) {
  return !!segment && PATH_SEGMENT.test(segment) && (HAS_PATH_SIGNAL.test(segment) || segment.length > 1)
}

function hasPathSignal(segment: string) {
  return HAS_PATH_SIGNAL.test(segment) || FILE_EXTENSION.test(segment)
}

function isDateLikeSegments(left: string, right: string) {
  if (!DIGIT_ONLY.test(left) || !DIGIT_ONLY.test(right)) return false
  return left.length <= 4 && right.length <= 2
}

function stripLeadingRelativePrefix(value: string) {
  return value.replace(/^(\.\.?[\\/])+/u, "")
}

function isPathLead(text: string, index: number) {
  return hasPathLead(text, index)
}

function hasPathLead(text: string, index: number) {
  const char = text[index]
  const next = text[index + 1]
  const prev = text[index - 1]
  if (!char) return false
  if (/^[A-Za-z]$/u.test(char) && next === ":" && (text[index + 2] === "/" || text[index + 2] === "\\")) return true
  if (char === "." && (next === "/" || next === "\\")) return true
  if (char === "/" || char === "\\") return isWordBoundary(text, index - 1) && isWordBoundary(text, index + 1)
  if (!isWordBoundary(text, index - 1) || prev === ":" || prev === "/" || prev === "\\") return false
  const tail = text.slice(index).match(/^[^\s<>"'`]+/u)?.[0] ?? ""
  if (!tail) return false
  return isPlainTextPathLike(stripTrailingPathPunctuation(tail))
}

function isPathChar(char: string) {
  return !!char && (/[A-Za-z0-9._~%+-]/u.test(char) || char === "/" || char === "\\" || char === ":")
}

function isWordBoundary(text: string, index: number) {
  if (index < 0 || index >= text.length) return true
  return !/[A-Za-z0-9_]/u.test(text[index])
}
