#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises"
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

  await $`bun prettier --write src/gen`
  await $`bun prettier --write src/v2`
  await $`rm -rf dist`
  await $`bun tsc`
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
