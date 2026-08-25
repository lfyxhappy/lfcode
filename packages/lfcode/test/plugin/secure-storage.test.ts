import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createPluginSecureStorage, type SecureStorageBackend } from "../../src/plugin/secure-storage"
import { tmpdir } from "../fixture/fixture"

describe("plugin secure storage", () => {
  test("stores only backend-encrypted values", async () => {
    await using tmp = await tmpdir()
    const backend: SecureStorageBackend = {
      status: () => "available",
      encrypt: async (value) => Buffer.from(`protected:${value}`).toString("base64"),
      decrypt: async (value) => Buffer.from(value, "base64").toString("utf8").replace(/^protected:/, ""),
    }
    const storage = createPluginSecureStorage(tmp.path, backend)

    await storage.set("openai", "secret-value")

    expect(await storage.get("openai")).toBe("secret-value")
    const persisted = await readFile(path.join(tmp.path, "secrets", "openai.enc"), "utf8")
    expect(persisted).not.toContain("secret-value")
    expect(persisted).toBe(Buffer.from("protected:secret-value").toString("base64"))
  })

  test("rejects writes when the desktop backend is unavailable", async () => {
    await using tmp = await tmpdir()
    const storage = createPluginSecureStorage(tmp.path, {
      status: () => "unavailable",
      encrypt: async () => "",
      decrypt: async () => undefined,
    })

    expect(storage.status()).toBe("unavailable")
    await expect(storage.set("openai", "secret-value")).rejects.toThrow("unavailable")
  })

  test("rejects path-like secret keys", async () => {
    await using tmp = await tmpdir()
    const storage = createPluginSecureStorage(tmp.path, {
      status: () => "available",
      encrypt: async (value) => value,
      decrypt: async (value) => value,
    })

    await expect(storage.set("../escape", "secret-value")).rejects.toThrow("Secure storage key")
  })
})
