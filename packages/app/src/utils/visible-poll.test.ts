import { describe, expect, test } from "bun:test"
import { startVisiblePolling } from "./visible-poll"

const setVisibility = (value: "hidden" | "visible") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  })
}

describe("visible polling", () => {
  test("pauses while hidden and refreshes immediately when visible", async () => {
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    const callbacks: Array<() => void> = []
    const cleared: number[] = []
    window.setInterval = ((callback: TimerHandler) => {
      callbacks.push(callback as () => void)
      return callbacks.length as unknown as number
    }) as typeof window.setInterval
    window.clearInterval = ((id: number) => {
      cleared.push(id)
    }) as typeof window.clearInterval

    try {
      setVisibility("visible")
      let calls = 0
      const stop = startVisiblePolling(() => {
        calls += 1
      }, 1000)
      await Promise.resolve()
      await Promise.resolve()
      expect(calls).toBe(1)
      expect(callbacks).toHaveLength(1)

      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      expect(cleared).toEqual([1])
      callbacks[0]?.()
      await Promise.resolve()
      expect(calls).toBe(1)

      setVisibility("visible")
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
      expect(calls).toBe(2)
      expect(callbacks).toHaveLength(2)

      stop()
      expect(cleared).toEqual([1, 2])
    } finally {
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
      setVisibility("visible")
    }
  })

  test("does not overlap an in-flight refresh", async () => {
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    let callback: (() => void) | undefined
    window.setInterval = ((next: TimerHandler) => {
      callback = next as () => void
      return 1 as unknown as number
    }) as typeof window.setInterval
    window.clearInterval = (() => {}) as typeof window.clearInterval

    try {
      setVisibility("visible")
      let calls = 0
      let release!: () => void
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const stop = startVisiblePolling(async () => {
        calls += 1
        await pending
      }, 1000)
      await Promise.resolve()
      callback?.()
      await Promise.resolve()
      expect(calls).toBe(1)
      release()
      await pending
      await Promise.resolve()
      await Promise.resolve()
      callback?.()
      await Promise.resolve()
      expect(calls).toBe(2)
      stop()
    } finally {
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
      setVisibility("visible")
    }
  })

  test("pauses and resumes from native window visibility events", async () => {
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    const originalApi = window.api
    const callbacks: Array<() => void> = []
    const cleared: number[] = []
    let nativeListener: ((visible: boolean) => void) | undefined
    window.setInterval = ((callback: TimerHandler) => {
      callbacks.push(callback as () => void)
      return callbacks.length as unknown as number
    }) as typeof window.setInterval
    window.clearInterval = ((id: number) => {
      cleared.push(id)
    }) as typeof window.clearInterval
    window.api = {
      getWindowVisibility: async () => true,
      onWindowVisibility: (listener) => {
        nativeListener = listener
        return () => {
          nativeListener = undefined
        }
      },
    }

    try {
      setVisibility("visible")
      let calls = 0
      const stop = startVisiblePolling(() => {
        calls += 1
      }, 1000)
      await Promise.resolve()
      await Promise.resolve()
      expect(calls).toBe(1)
      expect(callbacks).toHaveLength(1)

      nativeListener?.(false)
      expect(cleared).toEqual([1])
      callbacks[0]?.()
      await Promise.resolve()
      expect(calls).toBe(1)

      nativeListener?.(true)
      await Promise.resolve()
      expect(calls).toBe(2)
      expect(callbacks).toHaveLength(2)
      stop()
    } finally {
      window.api = originalApi
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
      setVisibility("visible")
    }
  })

  test("can defer the initial refresh without deferring visibility recovery", async () => {
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    const callbacks: Array<() => void> = []
    const cleared: number[] = []
    window.setInterval = ((callback: TimerHandler) => {
      callbacks.push(callback as () => void)
      return callbacks.length as unknown as number
    }) as typeof window.setInterval
    window.clearInterval = ((id: number) => {
      cleared.push(id)
    }) as typeof window.clearInterval

    try {
      setVisibility("visible")
      let calls = 0
      const stop = startVisiblePolling(() => {
        calls += 1
      }, 1000, { immediate: false })
      await Promise.resolve()
      expect(calls).toBe(0)
      expect(callbacks).toHaveLength(1)

      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      setVisibility("visible")
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
      expect(calls).toBe(1)
      expect(callbacks).toHaveLength(2)
      expect(cleared).toEqual([1])
      stop()
    } finally {
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
      setVisibility("visible")
    }
  })

  test("refreshes once after an in-flight request finishes during visibility recovery", async () => {
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    window.setInterval = (() => 1 as unknown as number) as unknown as typeof window.setInterval
    window.clearInterval = (() => {}) as typeof window.clearInterval

    try {
      setVisibility("visible")
      let calls = 0
      let release!: () => void
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const stop = startVisiblePolling(async () => {
        calls += 1
        await pending
      }, 1000)
      await Promise.resolve()
      expect(calls).toBe(1)

      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      setVisibility("visible")
      document.dispatchEvent(new Event("visibilitychange"))
      release()
      await pending
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toBe(2)
      stop()
    } finally {
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
      setVisibility("visible")
    }
  })

  test("does not duplicate a refresh when DOM and native visibility events overlap", async () => {
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    const callbacks: Array<() => void> = []
    let nativeListener: ((visible: boolean) => void) | undefined
    window.setInterval = ((callback: TimerHandler) => {
      callbacks.push(callback as () => void)
      return callbacks.length as unknown as number
    }) as typeof window.setInterval
    window.clearInterval = (() => {}) as typeof window.clearInterval
    const originalApi = window.api
    window.api = {
      getWindowVisibility: async () => true,
      onWindowVisibility: (listener) => {
        nativeListener = listener
        return () => {
          nativeListener = undefined
        }
      },
    }

    try {
      setVisibility("visible")
      let calls = 0
      const stop = startVisiblePolling(() => {
        calls += 1
      }, 1000)
      await Promise.resolve()
      await Promise.resolve()
      expect(calls).toBe(1)

      setVisibility("hidden")
      nativeListener?.(false)
      document.dispatchEvent(new Event("visibilitychange"))
      setVisibility("visible")
      document.dispatchEvent(new Event("visibilitychange"))
      nativeListener?.(true)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toBe(2)
      expect(callbacks).toHaveLength(2)
      stop()
    } finally {
      window.api = originalApi
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
      setVisibility("visible")
    }
  })

  test("does not replay a stale pending refresh after the request finished while hidden", async () => {
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    const callbacks: Array<() => void> = []
    window.setInterval = ((callback: TimerHandler) => {
      callbacks.push(callback as () => void)
      return callbacks.length as unknown as number
    }) as typeof window.setInterval
    window.clearInterval = (() => {}) as typeof window.clearInterval

    try {
      setVisibility("visible")
      let calls = 0
      let release!: () => void
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const stop = startVisiblePolling(async () => {
        calls += 1
        if (calls === 1) await pending
      }, 1000)
      await Promise.resolve()
      await Promise.resolve()
      expect(calls).toBe(1)

      setVisibility("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      release()
      await pending
      await Promise.resolve()

      setVisibility("visible")
      document.dispatchEvent(new Event("visibilitychange"))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toBe(2)
      callbacks[1]?.()
      await Promise.resolve()
      expect(calls).toBe(3)
      stop()
    } finally {
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
      setVisibility("visible")
    }
  })
})
