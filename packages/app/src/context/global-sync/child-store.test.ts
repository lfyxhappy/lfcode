import { describe, expect, test } from "bun:test"
import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import { createChildStoreManager } from "./child-store"

const child = () => createStore({} as State)

describe("createChildStoreManager", () => {
  test("existing does not create a store for unknown directories", () => {
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
    })

    expect(manager.existing("/missing")).toBeUndefined()
    expect(Object.keys(manager.children)).toEqual([])
  })

  test("admits one initial bootstrap for equivalent directory paths", () => {
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    let bootstraps = 0
    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {
        bootstraps += 1
      },
      onDispose() {},
      translate: (key) => key,
    })
    const directory = "C:/workspace"
    const store = createStore<State>({ status: "loading" } as State)
    manager.children[directory] = store

    manager.child("C:\\workspace")
    manager.child(directory)

    expect(bootstraps).toBe(1)
    expect(store[0].status).toBe("partial")
  })

  test("does not evict the active directory during mark", () => {
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
    })

    Array.from({ length: 30 }, (_, index) => `/pinned-${index}`).forEach((directory) => {
      manager.children[directory] = child()
      manager.pin(directory)
    })

    const directory = "/active"
    manager.children[directory] = child()
    manager.mark(directory)

    expect(manager.children[directory]).toBeDefined()
  })
})
