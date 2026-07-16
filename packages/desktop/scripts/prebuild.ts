#!/usr/bin/env bun
import { $ } from "bun"
import path from "node:path"

import { copyBinaryToCliFolder, resolveChannel, windowsify } from "./utils"

const channel = resolveChannel()
const lfcodeDir = path.resolve(import.meta.dir, "../../lfcode")
const pkg = await Bun.file("./package.json").json()
const rootPkg = await Bun.file(path.resolve(import.meta.dir, "../../../package.json")).json()
if (pkg.version !== rootPkg.version) {
  pkg.version = rootPkg.version
  await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
  console.log(`Updated desktop package version to ${rootPkg.version}`)
}

await $`bun ./scripts/copy-icons.ts ${channel}`

const cliArgs = ["script/build.ts", "--single", "--skip-embed-web-ui", "--skip-install"]
if (process.platform === "win32" && process.arch === "x64") cliArgs.splice(2, 0, "--baseline")
await $`bun ${cliArgs}`.cwd(lfcodeDir).env({
  ...process.env,
  LFCODE_CHANNEL: channel,
  LFCODE_VERSION: rootPkg.version,
})

const cliTarget =
  process.platform === "win32"
    ? process.arch === "arm64"
      ? "lfcode-windows-arm64"
      : "lfcode-windows-x64-baseline"
    : process.platform === "darwin"
      ? process.arch === "arm64"
        ? "lfcode-darwin-arm64"
        : "lfcode-darwin-x64-baseline"
      : process.arch === "arm64"
        ? "lfcode-linux-arm64"
        : "lfcode-linux-x64-baseline"
await copyBinaryToCliFolder(path.join(lfcodeDir, "dist", cliTarget, "bin", windowsify("lfcode")))

await $`bun ${path.join(lfcodeDir, "script/build-node.ts")}`
  .env({
    ...process.env,
    LFCODE_CHANNEL: channel,
    LFCODE_VERSION: rootPkg.version,
  })
