#!/usr/bin/env bun
import { $ } from "bun"
import path from "node:path"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
const pkg = await Bun.file("./package.json").json()
const rootPkg = await Bun.file(path.resolve(import.meta.dir, "../../../package.json")).json()
if (pkg.version !== rootPkg.version) {
  pkg.version = rootPkg.version
  await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
  console.log(`Updated desktop package version to ${rootPkg.version}`)
}

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun script/build-node.ts`
  .cwd("../opencode")
  .env({
    ...process.env,
    OPENCODE_CHANNEL: channel,
    OPENCODE_VERSION: rootPkg.version,
  })
