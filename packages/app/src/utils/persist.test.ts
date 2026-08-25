import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { AsyncStorage } from "@solid-primitives/storage"

type PersistTestingType = typeof import("./persist").PersistTesting

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  readonly events: string[] = []
  readonly calls = { get: 0, set: 0, remove: 0 }

  clear() {
    this.values.clear()
  }

  get length() {
    return this.values.size
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  getItem(key: string) {
    this.calls.get += 1
    this.events.push(`get:${key}`)
    if (key.startsWith("lfcode.throw")) throw new Error("storage get failed")
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.calls.set += 1
    this.events.push(`set:${key}`)
    if (key.startsWith("lfcode.quota")) throw new DOMException("quota", "QuotaExceededError")
    if (key.startsWith("lfcode.throw")) throw new Error("storage set failed")
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.calls.remove += 1
    this.events.push(`remove:${key}`)
    if (key.startsWith("lfcode.throw")) throw new Error("storage remove failed")
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()
let activePlatform: { platform: "web" | "desktop"; storage?: (name?: string) => AsyncStorage } = { platform: "web" }

let persistTesting: PersistTestingType
let persisted: typeof import("./persist").persisted

beforeAll(async () => {
  mock.module("@/context/platform", () => ({
    usePlatform: () => activePlatform,
  }))

  const mod = await import("./persist")
  persistTesting = mod.PersistTesting
  persisted = mod.persisted
})

beforeEach(() => {
  storage.clear()
  storage.events.length = 0
  storage.calls.get = 0
  storage.calls.set = 0
  storage.calls.remove = 0
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
})

describe("persist localStorage resilience", () => {
  test("does not cache values as persisted when quota write and eviction fail", () => {
    const storageApi = persistTesting.localStorageWithPrefix("lfcode.quota.scope")
    storageApi.setItem("value", '{"value":1}')

    expect(storage.getItem("lfcode.quota.scope:value")).toBeNull()
    expect(storageApi.getItem("value")).toBeNull()
  })

  test("disables only the failing scope when storage throws", () => {
    const bad = persistTesting.localStorageWithPrefix("lfcode.throw.scope")
    bad.setItem("value", '{"value":1}')

    const before = storage.calls.set
    bad.setItem("value", '{"value":2}')
    expect(storage.calls.set).toBe(before)
    expect(bad.getItem("value")).toBeNull()

    const healthy = persistTesting.localStorageWithPrefix("lfcode.safe.scope")
    healthy.setItem("value", '{"value":3}')
    expect(storage.getItem("lfcode.safe.scope:value")).toBe('{"value":3}')
  })

  test("failing fallback scope does not poison direct storage scope", () => {
    const broken = persistTesting.localStorageWithPrefix("lfcode.throw.scope2")
    broken.setItem("value", '{"value":1}')

    const direct = persistTesting.localStorageDirect()
    direct.setItem("direct-value", '{"value":5}')

    expect(storage.getItem("direct-value")).toBe('{"value":5}')
  })

  test("normalizer rejects malformed JSON payloads", () => {
    const result = persistTesting.normalize({ value: "ok" }, '{"value":"\\x"}')
    expect(result).toBeUndefined()
  })

  test("workspace storage sanitizes Windows filename characters", () => {
    const result = persistTesting.workspaceStorage("C:\\Users\\foo")

    expect(result).toStartWith("lfcode.workspace.")
    expect(result.endsWith(".dat")).toBeTrue()
    expect(/[:\\/]/.test(result)).toBeFalse()
  })
})

function asyncStorage(value: string | null) {
  const storage: AsyncStorage = {
    getItem: async () => value,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }
  return storage
}

describe("persist desktop initialization", () => {
  test("restores saved state when no edit happens before storage is ready", async () => {
    const storage = asyncStorage('{"prompt":"saved"}')
    activePlatform = { platform: "desktop", storage: () => storage }
    const session = createRoot((dispose) => {
      const [store, setStore, init] = persisted("prompt", createStore({ prompt: "" }))
      return { dispose, store, setStore, init }
    })

    await session.init

    expect(session.store.prompt).toBe("saved")
    session.dispose()
    activePlatform = { platform: "web" }
  })

  test("keeps an early edit when saved state resolves later", async () => {
    const storage = asyncStorage('{"prompt":"saved"}')
    activePlatform = { platform: "desktop", storage: () => storage }
    const session = createRoot((dispose) => {
      const [store, setStore, init] = persisted("prompt", createStore({ prompt: "" }))
      return { dispose, store, setStore, init }
    })

    session.setStore("prompt", "typed before ready")
    await session.init

    expect(session.store.prompt).toBe("typed before ready")
    session.dispose()
    activePlatform = { platform: "web" }
  })

  test("falls back to defaults when desktop storage cannot be read", async () => {
    const storage: AsyncStorage = {
      getItem: async () => {
        throw new Error("storage unavailable")
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    }
    activePlatform = { platform: "desktop", storage: () => storage }
    const session = createRoot((dispose) => {
      const [store, setStore, init] = persisted("prompt", createStore({ prompt: "" }))
      return { dispose, store, setStore, init }
    })

    await session.init

    expect(session.store.prompt).toBe("")
    session.dispose()
    activePlatform = { platform: "web" }
  })
})
