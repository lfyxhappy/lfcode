import { describe, expect, test } from "bun:test"
import { DEFAULT_CHUNK_TIMEOUT, wrapSSE } from "../../src/provider/provider"

describe("provider chunkTimeout", () => {
  test("DEFAULT_CHUNK_TIMEOUT is 8 minutes (480_000 ms)", () => {
    expect(DEFAULT_CHUNK_TIMEOUT).toBe(480_000)
  })

  test("user-supplied chunkTimeout (number) takes precedence over default", () => {
    // Mirrors provider.ts:1472-1476 selection logic.
    function pickChunkTimeout(options: { chunkTimeout?: unknown }): number {
      const userChunkTimeout = options["chunkTimeout"]
      return typeof userChunkTimeout === "number" ? userChunkTimeout : DEFAULT_CHUNK_TIMEOUT
    }

    expect(pickChunkTimeout({ chunkTimeout: 60_000 })).toBe(60_000)
    expect(pickChunkTimeout({ chunkTimeout: 0 })).toBe(0)
    expect(pickChunkTimeout({ chunkTimeout: -1 })).toBe(-1)
    expect(pickChunkTimeout({})).toBe(DEFAULT_CHUNK_TIMEOUT)
    expect(pickChunkTimeout({ chunkTimeout: "not a number" })).toBe(DEFAULT_CHUNK_TIMEOUT)
    expect(pickChunkTimeout({ chunkTimeout: null })).toBe(DEFAULT_CHUNK_TIMEOUT)
  })

  test("wrapSSE does not enqueue a late chunk after external abort", async () => {
    const encoder = new TextEncoder()
    const readGate = Promise.withResolvers<void>()
    const canceled = Promise.withResolvers<void>()
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        return readGate.promise.then(() => {
          controller.enqueue(encoder.encode("data: late\n\n"))
          controller.close()
        })
      },
      cancel() {
        canceled.resolve()
      },
    })

    const timeoutAbort = new AbortController()
    const externalAbort = new AbortController()
    const wrapped = wrapSSE(
      new Response(upstream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      10_000,
      timeoutAbort,
      externalAbort.signal,
    )

    const reader = wrapped.body?.getReader()
    expect(reader).toBeDefined()
    const pending = reader!.read()
    externalAbort.abort()
    readGate.resolve()

    await expect(pending).rejects.toThrow()
    await canceled.promise
    expect(timeoutAbort.signal.aborted).toBe(true)
  })
})
