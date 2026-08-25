import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { AppFileSystem } from "../../src/filesystem"
import { materializeCodegraphRuntime } from "../../src/mcp"

describe("CodeGraph runtime materialization", () => {
  test("copies the bundled Node layout into the managed data directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lfcode-codegraph-materialize-"))
    await using _ = { async [Symbol.asyncDispose]() { await fs.rm(root, { recursive: true, force: true }) } }
    const source = path.join(root, "resources", "codegraph")
    const target = path.join(root, "data", "codegraph")
    const sourceNode = path.join(source, "node.exe")
    const sourceEntry = path.join(source, "lib", "dist", "bin", "codegraph.js")
    await fs.mkdir(path.dirname(sourceEntry), { recursive: true })
    await Promise.all([
      fs.writeFile(sourceNode, "MZ"),
      fs.writeFile(sourceEntry, "console.log('codegraph')"),
      fs.writeFile(path.join(source, "NOTICE.txt"), "CodeGraph"),
    ])

    const config = {
      type: "local" as const,
      command: [sourceNode, sourceEntry, "serve", "--mcp"],
      enabled: true,
    }
    const materialized = await Effect.runPromise(
      AppFileSystem.Service.use((fsys) =>
        materializeCodegraphRuntime(fsys, config, {
          LFCODE_CODEGRAPH_INSTALL_DIR: source,
          LFCODE_CODEGRAPH_NODE_EXE: sourceNode,
          LFCODE_CODEGRAPH_ENTRY: sourceEntry,
          LFCODE_CODEGRAPH_DATA_DIR: target,
        }),
      ).pipe(Effect.provide(AppFileSystem.defaultLayer)),
    )

    expect(materialized.type).toBe("local")
    if (materialized.type !== "local") throw new Error("Expected local CodeGraph config")
    expect(materialized.command).toEqual([
      path.join(target, "node.exe"),
      path.join(target, "lib", "dist", "bin", "codegraph.js"),
      "serve",
      "--mcp",
    ])
    expect(await fs.readFile(path.join(target, "NOTICE.txt"), "utf8")).toBe("CodeGraph")
  })

  test("leaves custom CodeGraph commands untouched", async () => {
    const config = {
      type: "local" as const,
      command: ["C:\\tools\\custom-codegraph.cmd", "serve", "--mcp"],
      enabled: true,
    }
    const result = await Effect.runPromise(
      AppFileSystem.Service.use((fsys) =>
        materializeCodegraphRuntime(fsys, config, {
          LFCODE_CODEGRAPH_INSTALL_DIR: "C:\\Lfcode\\resources\\codegraph",
          LFCODE_CODEGRAPH_NODE_EXE: "C:\\Lfcode\\resources\\codegraph\\node.exe",
          LFCODE_CODEGRAPH_ENTRY: "C:\\Lfcode\\resources\\codegraph\\lib\\dist\\bin\\codegraph.js",
          LFCODE_CODEGRAPH_DATA_DIR: "C:\\Users\\test\\.lfcode\\data\\codegraph",
        }),
      ).pipe(Effect.provide(AppFileSystem.defaultLayer)),
    )

    expect(result).toEqual(config)
  })
})
