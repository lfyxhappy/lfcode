export type BrowserCookieRecord = {
  name: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: string
  session: boolean
  expirationDate: number | null
}

export type BrowserCookieIdentity = Pick<BrowserCookieRecord, "name" | "domain" | "path" | "secure">

export type SavedBrowserLoginRecord = {
  id: string
  origin: string
  username: string
  passwordEncrypted: string
  createdAt: number
  updatedAt: number
}

export type SavedBrowserLoginUpsert = {
  id?: string
  origin: string
  username: string
  password?: string
  passwordEncrypted?: string
}

export type BrowserPasswordStorageState = {
  available: boolean
  reason?: "safeStorageUnavailable"
}

export type BrowserPasswordCapturePrompt = {
  id: string
  origin: string
  username: string
}

export type BrowserPasswordPromptAck = {
  id: string
  save: boolean
}

export type BrowserPasswordCapturePayload = {
  origin: string
  username: string
  password: string
}

export type BrowserAutofillMatch = {
  username: string
  password: string
}
