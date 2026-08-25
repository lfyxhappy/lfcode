#!/usr/bin/env bun
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "path"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import { createClient } from "@hey-api/openapi-ts"

const tempDir = await mkdtemp(path.join(tmpdir(), "lfcode-sdk-"))
const openapiPath = path.join(tempDir, "openapi.json")

try {
  await $`bun dev generate > ${openapiPath}`.cwd(path.resolve(dir, "../../lfcode"))

  await createClient({
    input: openapiPath,
    output: {
      path: "./src/v2/gen",
      tsConfigPath: path.join(dir, "tsconfig.json"),
      clean: true,
    },
    plugins: [
      {
        name: "@hey-api/typescript",
        exportFromIndex: false,
      },
      {
        name: "@hey-api/sdk",
        exportFromIndex: false,
        auth: false,
        paramsStructure: "flat",
        operations: {
          strategy: "single",
          containerName: "LfcodeClient",
          methods: "instance",
        },
      },
      {
        name: "@hey-api/client-fetch",
        exportFromIndex: false,
        baseUrl: "http://localhost:4096",
      },
    ],
  })

  // On Windows the generator can return before all rewritten handles are
  // released. Retry formatting briefly instead of making SDK generation flaky.
  await formatWithRetry("src/gen")
  await formatDirectoryWithRetry("src/v2")
  await $`rm -rf dist`
  await $`bun tsc`
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

async function formatWithRetry(target: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await $`bun prettier --write ${target}`
      return
    } catch (error) {
      lastError = error
      if (attempt < 7) await Bun.sleep(500 * (attempt + 1))
    }
  }
  throw lastError
}

async function formatDirectoryWithRetry(directory: string) {
  await Bun.sleep(1000)
  const files = await collectTypeScriptFiles(directory)
  for (const file of files) await formatWithRetry(file)
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) return collectTypeScriptFiles(target)
      return entry.isFile() && target.endsWith(".ts") ? [target] : []
    }),
  )
  return nested.flat()
}
