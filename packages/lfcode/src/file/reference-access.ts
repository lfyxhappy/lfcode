import path from "path"
import { AppFileSystem } from "@/filesystem"

const TTL = 30 * 60 * 1000

type Grant = {
  owner: string
  root: string
  expiresAt: number
}

const grants = new Map<string, Grant>()

export function grant(input: { owner: string; root: string }) {
  prune()
  const token = crypto.randomUUID()
  const root = resolve(input.root)
  grants.set(token, {
    owner: resolve(input.owner),
    root,
    expiresAt: Date.now() + TTL,
  })
  return { root, token }
}

export function authorize(input: { owner: string; path: string; token?: string }) {
  prune()
  const token = input.token
  if (!token) throw new Error("Reference access denied: missing grant")

  const entry = grants.get(token)
  if (!entry || entry.owner !== resolve(input.owner)) throw new Error("Reference access denied: invalid grant")

  const target = resolve(input.path)
  if (!contains(entry.root, target)) throw new Error("Reference access denied: path escapes granted directory")

  entry.expiresAt = Date.now() + TTL
  return target
}

function resolve(input: string) {
  try {
    return AppFileSystem.resolve(input)
  } catch {
    return AppFileSystem.normalizePath(path.resolve(input))
  }
}

function contains(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function prune() {
  const now = Date.now()
  for (const [token, entry] of grants) {
    if (entry.expiresAt <= now) grants.delete(token)
  }
}
