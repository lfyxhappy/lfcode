import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  CODEGRAPH_ASSET,
  CODEGRAPH_RUNTIME_METADATA_FILE,
  CODEGRAPH_SHA256,
  CODEGRAPH_VERSION,
  prepareCodegraphRuntime,
  resolveCodegraphRuntimeLayout,
  sha256File,
  sha256RuntimeTree,
} from "./codegraph-runtime"

describe("CodeGraph runtime preparation", () => {
  test("does not prepare on unsupported platforms", async () => {
    await expect(
      prepareCodegraphRuntime({ stageDir: path.join(os.tmpdir(), "lfcode-codegraph-test"), platform: "linux", arch: "x64" }),
    ).resolves.toBeUndefined()
  })

  test("hashes cached archives before extraction", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-hash-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const file = path.join(dir, "archive.zip")
    await fs.writeFile(file, "codegraph")
    expect(await sha256File(file)).not.toBe(CODEGRAPH_SHA256)
  })

  test("recognizes the official bundled Node launcher layout", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-node-layout-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const nodePath = path.join(dir, "node.exe")
    const entry = path.join(dir, "lib", "dist", "bin", "codegraph.js")
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await Promise.all([fs.writeFile(nodePath, "MZ"), fs.writeFile(entry, "console.log('codegraph')")])

    await expect(resolveCodegraphRuntimeLayout(dir)).resolves.toEqual({ entry, installDir: dir, nodePath })
  })

  test("only reuses a staged runtime with the locked release metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-staged-runtime-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const nodePath = path.join(dir, "node.exe")
    const entry = path.join(dir, "lib", "dist", "bin", "codegraph.js")
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await Promise.all([fs.writeFile(nodePath, "MZ"), fs.writeFile(entry, "console.log('codegraph')")])
    await fs.writeFile(
      path.join(dir, CODEGRAPH_RUNTIME_METADATA_FILE),
      JSON.stringify({
        version: CODEGRAPH_VERSION,
        asset: CODEGRAPH_ASSET,
        sha256: CODEGRAPH_SHA256,
        launcher: "node",
        runtimeSha256: await sha256RuntimeTree(dir),
      }),
    )

    await expect(
      prepareCodegraphRuntime({ stageDir: dir, platform: "win32", arch: "x64", fetchImpl: async () => new Response("unexpected") }),
    ).resolves.toMatchObject({ entry, installDir: dir, nodePath, reused: true })
  })

  test("does not reuse a staged runtime after its files change", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-staged-tamper-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const nodePath = path.join(dir, "node.exe")
    const entry = path.join(dir, "lib", "dist", "bin", "codegraph.js")
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await Promise.all([fs.writeFile(nodePath, "MZ"), fs.writeFile(entry, "console.log('codegraph')")])
    await fs.writeFile(
      path.join(dir, CODEGRAPH_RUNTIME_METADATA_FILE),
      JSON.stringify({
        version: CODEGRAPH_VERSION,
        asset: CODEGRAPH_ASSET,
        sha256: CODEGRAPH_SHA256,
        launcher: "node",
        runtimeSha256: await sha256RuntimeTree(dir),
      }),
    )
    await fs.writeFile(entry, "tampered")

    await expect(
      prepareCodegraphRuntime({
        stageDir: dir,
        platform: "win32",
        arch: "x64",
        fetchImpl: async () => {
          throw new Error("network unavailable")
        },
      }),
    ).rejects.toThrow("network unavailable")
    await expect(fs.access(entry)).rejects.toThrow()
  })

  test("removes an unverified staged runtime before downloading", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-staged-corrupt-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const entry = path.join(dir, "codegraph.exe")
    await fs.writeFile(entry, "stale")

    await expect(
      prepareCodegraphRuntime({
        stageDir: dir,
        platform: "win32",
        arch: "x64",
        fetchImpl: async () => {
          throw new Error("network unavailable")
        },
      }),
    ).rejects.toThrow("network unavailable")
    await expect(fs.access(entry)).rejects.toThrow()
  })

  test("keeps compatibility with a legacy single executable layout", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-exe-layout-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const entry = path.join(dir, "codegraph.exe")
    await fs.writeFile(entry, "MZ")

    await expect(resolveCodegraphRuntimeLayout(dir)).resolves.toEqual({ entry, installDir: dir })
  })

  test("rejects empty launchers as corrupt runtime files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-empty-layout-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const entry = path.join(dir, "lib", "dist", "bin", "codegraph.js")
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await Promise.all([fs.writeFile(path.join(dir, "node.exe"), ""), fs.writeFile(entry, "")])

    await expect(resolveCodegraphRuntimeLayout(dir)).resolves.toBeUndefined()
  })

  test("replaces a corrupt cached archive before validating the replacement", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-cache-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const cacheDir = path.join(dir, "cache")
    const archive = path.join(cacheDir, `${CODEGRAPH_VERSION}-${CODEGRAPH_ASSET}`)
    await fs.mkdir(cacheDir, { recursive: true })
    await fs.writeFile(archive, "stale")
    let fetched = false

    await expect(
      prepareCodegraphRuntime({
        stageDir: path.join(dir, "stage"),
        cacheDir,
        platform: "win32",
        arch: "x64",
        fetchImpl: async () => {
          fetched = true
          return new Response("replacement")
        },
      }),
    ).rejects.toThrow("CodeGraph SHA256 mismatch")

    expect(fetched).toBe(true)
    await expect(fs.access(archive)).rejects.toThrow()
  })

  test("keeps an interrupted curl fallback download for the next package attempt", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-resume-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(dir, { recursive: true, force: true }) } }
    const cacheDir = path.join(dir, "cache")
    const archive = path.join(cacheDir, `${CODEGRAPH_VERSION}-${CODEGRAPH_ASSET}`)

    await expect(
      prepareCodegraphRuntime({
        stageDir: path.join(dir, "stage"),
        cacheDir,
        platform: "win32",
        arch: "x64",
        fetchImpl: async () => {
          throw new Error("certificate unavailable")
        },
        curlImpl: async ({ output }) => {
          await fs.writeFile(output, "partial")
          throw new Error("connection interrupted")
        },
      }),
    ).rejects.toThrow("Windows curl fallback")

    expect(await fs.readFile(`${archive}.part`, "utf8")).toBe("partial")
    await expect(fs.access(archive)).rejects.toThrow()
  })
})
