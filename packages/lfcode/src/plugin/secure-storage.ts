import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { PluginSecureStorage } from "@lfcode-ai/plugin"

export type SecureStorageBackend = {
  status(): "available" | "unavailable"
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<string | undefined>
}

let registeredBackend: SecureStorageBackend | undefined

export function register(backend: SecureStorageBackend | undefined) {
  registeredBackend = backend
}

export function backend(): SecureStorageBackend {
  return registeredBackend ?? unavailableBackend
}

export function createPluginSecureStorage(directory: string, backend: SecureStorageBackend): PluginSecureStorage {
  return {
    status: () => backend.status(),
    async get(key) {
      const target = secretPath(directory, key)
      const encrypted = await readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return
        throw error
      })
      if (!encrypted) return
      return backend.decrypt(encrypted)
    },
    async set(key, value) {
      if (backend.status() !== "available") throw new Error("Secure credential storage is unavailable on this system")
      const target = secretPath(directory, key)
      await mkdir(path.dirname(target), { recursive: true })
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temp, await backend.encrypt(value), "utf8")
      await rename(temp, target)
    },
    async remove(key) {
      await rm(secretPath(directory, key), { force: true })
    },
  }
}

function secretPath(directory: string, key: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)) throw new Error("Secure storage key must use letters, digits, dots, underscores, or hyphens")
  return path.join(directory, "secrets", `${key}.enc`)
}

const unavailableBackend: SecureStorageBackend = {
  status: () => "unavailable",
  async encrypt() {
    throw new Error("Secure credential storage is unavailable on this system")
  },
  async decrypt() {
    return undefined
  },
}

export * as PluginSecureStorage from "./secure-storage"
