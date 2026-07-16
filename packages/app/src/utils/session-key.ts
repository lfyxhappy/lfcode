import { base64Encode } from "@lfcode-ai/shared/util/encode"
import { decode64 } from "./base64"
import { normalizeWorkspacePath } from "./persist"

function decodeWorkspaceDirectory(dir: string) {
  const decoded = decode64(dir)
  if (!decoded) return

  const normalized = normalizeWorkspacePath(decoded)
  if (/^[A-Za-z]:\//.test(normalized)) return normalized
  if (normalized.startsWith("/")) return normalized
  return
}

export function normalizeSessionDirSlug(dir: string) {
  const decoded = decodeWorkspaceDirectory(dir)
  if (!decoded) return dir
  return base64Encode(decoded)
}

export function createSessionStorageKey(dir: string | undefined, id?: string) {
  if (!dir) return ""
  const key = normalizeSessionDirSlug(dir)
  return id ? `${key}/${id}` : key
}

export function normalizeSessionStorageKey(key: string) {
  const split = key.indexOf("/")
  if (split < 0) return normalizeSessionDirSlug(key)

  const dir = key.slice(0, split)
  const id = key.slice(split + 1)
  const normalized = normalizeSessionDirSlug(dir)
  return id ? `${normalized}/${id}` : normalized
}

export function decodeSessionStorageDirectory(dir: string) {
  return decodeWorkspaceDirectory(dir)
}
