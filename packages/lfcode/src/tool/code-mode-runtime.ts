import { Worker } from "node:worker_threads"

export const CODE_MODE_TIMEOUT_MS = 30_000
export const CODE_MODE_MAX_CALLS = 50
export const CODE_MODE_MAX_CONCURRENCY = 8
export const CODE_MODE_MAX_OUTPUT_BYTES = 64 * 1024

export class CodeRunFailed extends Error {
  readonly code = "CodeRunFailed"

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CodeRunFailed"
  }
}

type CallRequest = { type: "call"; id: number; tool: string; args: unknown }
type WorkerMessage = CallRequest | { type: "result"; value: unknown } | { type: "error"; message: string }

export async function runCode(input: {
  code: string
  tools: string[]
  signal?: AbortSignal
  call: (input: { tool: string; args: unknown; sequence: number }) => Promise<unknown>
  timeoutMs?: number
  maxCalls?: number
  maxConcurrency?: number
  maxOutputBytes?: number
}) {
  const timeoutMs = input.timeoutMs ?? CODE_MODE_TIMEOUT_MS
  const maxCalls = input.maxCalls ?? CODE_MODE_MAX_CALLS
  const maxConcurrency = input.maxConcurrency ?? CODE_MODE_MAX_CONCURRENCY
  const maxOutputBytes = input.maxOutputBytes ?? CODE_MODE_MAX_OUTPUT_BYTES
  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { code: input.code, tools: input.tools },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    })
    let settled = false
    let calls = 0
    let active = 0
    const settle = (result: { value?: unknown; error?: Error }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      input.signal?.removeEventListener("abort", abort)
      void worker.terminate()
      if (result.error) reject(result.error)
      else resolve(result.value)
    }
    const fail = (message: string, cause?: unknown) =>
      settle({ error: new CodeRunFailed(message, cause instanceof Error ? { cause } : undefined) })
    const abort = () => fail("Code Mode execution was cancelled")
    const timeout = setTimeout(() => fail(`Code Mode execution exceeded ${timeout}ms`), timeoutMs)
    if (input.signal?.aborted) return abort()
    input.signal?.addEventListener("abort", abort, { once: true })
    worker.on("error", (error) => fail("Code Mode worker crashed", error))
    worker.on("exit", (code) => {
      if (!settled && code !== 0) fail(`Code Mode worker exited unexpectedly (${code})`)
    })
    worker.on("message", (message: WorkerMessage) => {
      if (settled) return
      if (message.type === "result") {
        let serialized: string
        try {
          serialized = JSON.stringify(message.value)
        } catch (error) {
          return fail("Code Mode result must be JSON-serializable", error)
        }
        const size = Buffer.byteLength(serialized, "utf8")
        if (size > maxOutputBytes) return fail(`Code Mode result exceeds ${maxOutputBytes} bytes`)
        return settle({ value: message.value })
      }
      if (message.type === "error") return fail(message.message)
      if (!input.tools.includes(message.tool)) return fail(`Tool "${message.tool}" is not visible in this Code Mode turn`)
      calls += 1
      if (calls > maxCalls) return fail(`Code Mode permits at most ${maxCalls} tool calls`)
      if (active >= maxConcurrency) return fail(`Code Mode permits at most ${maxConcurrency} concurrent tool calls`)
      active += 1
      void input
        .call({ tool: message.tool, args: message.args, sequence: calls })
        .then((value) => worker.postMessage({ type: "response", id: message.id, value }))
        .catch((error) =>
          worker.postMessage({
            type: "response", id: message.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        .finally(() => {
          active -= 1
        })
    })
  })
}

// This isolates convenience execution from the Electron main process. It is not a
// security sandbox: each tool call still crosses the normal permission boundary.
const WORKER_SOURCE = String.raw`
  const { parentPort, workerData } = require("node:worker_threads")
  const vm = require("node:vm")
  let sequence = 0
  const pending = new Map()
  const tools = Object.fromEntries(workerData.tools.map((name) => [name, (args) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    parentPort.postMessage({ type: "call", id, tool: name, args })
  })]))
  parentPort.on("message", (message) => {
    if (message.type !== "response") return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error))
    else request.resolve(message.value)
  })
  const logs = []
  const sandbox = {
    tools,
    console: { log: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    setTimeout,
    clearTimeout,
    Promise,
  }
  try {
    const script = new vm.Script("(async () => {\n" + workerData.code + "\n})()", { filename: "run_code.ts" })
    Promise.resolve(script.runInNewContext(sandbox, { timeout: 28_000, contextCodeGeneration: { strings: false, wasm: false } }))
      .then((value) => parentPort.postMessage({ type: "result", value: value === undefined ? { logs } : value }))
      .catch((error) => parentPort.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) }))
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) })
  }
`
