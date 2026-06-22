import { randomUUID } from "node:crypto"
import type { SavedBrowserLoginRecord, SavedBrowserLoginUpsert } from "@lfcode-ai/shared/desktop-browser-management"

export function normalizeSavedBrowserLoginOrigin(value: string) {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    return url.origin
  } catch {
    return
  }
}

export function savedBrowserLoginKey(origin: string, username: string) {
  return `${origin}\u0000${username}`
}

export function matchSavedBrowserLoginsByOrigin(logins: SavedBrowserLoginRecord[], origin: string) {
  return logins.filter((item) => item.origin === origin)
}

export function upsertSavedBrowserLoginRecords(
  current: SavedBrowserLoginRecord[],
  input: SavedBrowserLoginUpsert,
  passwordEncrypted: string,
  now: number,
) {
  const origin = normalizeSavedBrowserLoginOrigin(input.origin)
  if (!origin) throw new Error("Saved browser login origin must use http or https")

  const username = input.username.trim()
  const matchKey = savedBrowserLoginKey(origin, username)
  const existing = current.find(
    (item) => item.id === input.id || savedBrowserLoginKey(item.origin, item.username) === matchKey,
  )

  const next = {
    id: existing?.id ?? input.id ?? randomUUID(),
    origin,
    username,
    passwordEncrypted,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  } satisfies SavedBrowserLoginRecord

  return [...current.filter((item) => item.id !== existing?.id && savedBrowserLoginKey(item.origin, item.username) !== matchKey), next]
}
