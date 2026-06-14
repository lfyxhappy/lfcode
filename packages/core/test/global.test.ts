import { describe, expect, test } from "bun:test"
import { spawn } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"

const worker = path.join(import.meta.dir, "fixture", "global-worker.ts")

type GlobalPathsResult = {
  path: {
    data: string
    cache: string
    config: string
    state: string
    bin: string
    log: string
    repos: string
    tmp: string
  }
  make: {
    data: string
    cache: string
    config: string
    state: string
    bin: string
    log: string
    repos: string
    tmp: string
  }
}

async function tmpdir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-global-"))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

function runWorker(env: Record<string, string>) {
  return new Promise<{ ok: true; value: GlobalPathsResult } | { ok: false; stderr: string }>((resolve) => {
    const proc = spawn(process.execPath, [worker], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, stderr })
        return
      }

      try {
        resolve({ ok: true, value: JSON.parse(stdout) as GlobalPathsResult })
      } catch (error) {
        resolve({ ok: false, stderr: `${stderr}\n${String(error)}` })
      }
    })
  })
}

describe("global paths", () => {
  test("tmp path stays under the system temp directory when no env overrides are set", async () => {
    await using tmp = await tmpdir()
    const result = await runWorker({
      TMPDIR: path.join(tmp.path, "tmp"),
      XDG_DATA_HOME: path.join(tmp.path, "xdg-data"),
      XDG_STATE_HOME: path.join(tmp.path, "xdg-state"),
      XDG_CACHE_HOME: path.join(tmp.path, "xdg-cache"),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.stderr)

    expect(result.value.path.tmp).toBe(path.join(os.tmpdir(), "opencode"))
    expect(result.value.make.tmp).toBe(path.join(os.tmpdir(), "opencode"))
    expect(result.value.path.data).toBe(path.join(tmp.path, "xdg-data", "opencode"))
    expect(result.value.path.state).toBe(path.join(tmp.path, "xdg-state", "opencode"))
    expect(result.value.path.cache).toBe(path.join(tmp.path, "xdg-cache", "opencode"))
  })

  test("respects final data, state, and cache env directories without appending opencode", async () => {
    await using tmp = await tmpdir()
    const data = path.join(tmp.path, "data")
    const state = path.join(tmp.path, "state")
    const cache = path.join(tmp.path, "cache")
    const result = await runWorker({
      OPENCODE_DATA_DIR: data,
      OPENCODE_STATE_DIR: state,
      OPENCODE_CACHE_DIR: cache,
      XDG_DATA_HOME: path.join(tmp.path, "xdg-data"),
      XDG_STATE_HOME: path.join(tmp.path, "xdg-state"),
      XDG_CACHE_HOME: path.join(tmp.path, "xdg-cache"),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.stderr)

    expect(result.value.path.data).toBe(data)
    expect(result.value.path.state).toBe(state)
    expect(result.value.path.cache).toBe(cache)
    expect(result.value.path.bin).toBe(path.join(cache, "bin"))
    expect(result.value.path.log).toBe(path.join(data, "log"))
    expect(result.value.path.repos).toBe(path.join(data, "repos"))
    expect(result.value.make.data).toBe(data)
    expect(result.value.make.state).toBe(state)
    expect(result.value.make.cache).toBe(cache)
    expect(result.value.make.bin).toBe(path.join(cache, "bin"))
    expect(result.value.make.log).toBe(path.join(data, "log"))
    expect(result.value.make.repos).toBe(path.join(data, "repos"))
  })

  test("tmp path is created on module load", async () => {
    await using tmp = await tmpdir()
    const result = await runWorker({
      TMPDIR: path.join(tmp.path, "tmp"),
      XDG_DATA_HOME: path.join(tmp.path, "xdg-data"),
      XDG_STATE_HOME: path.join(tmp.path, "xdg-state"),
      XDG_CACHE_HOME: path.join(tmp.path, "xdg-cache"),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.stderr)

    expect((await fs.stat(path.join(os.tmpdir(), "opencode"))).isDirectory()).toBe(true)
  })
})
