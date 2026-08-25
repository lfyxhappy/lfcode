#!/usr/bin/env bun
import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"

import { copyBinaryToCliFolder, resolveChannel, windowsify } from "./utils"

const channel = resolveChannel()
const lfcodeDir = path.resolve(import.meta.dir, "../../lfcode")
const pluginDir = path.resolve(import.meta.dir, "../../plugin")
const pkg = await Bun.file("./package.json").json()
const rootPkg = await Bun.file(path.resolve(import.meta.dir, "../../../package.json")).json()
if (pkg.version !== rootPkg.version) {
  pkg.version = rootPkg.version
  await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
  console.log(`Updated desktop package version to ${rootPkg.version}`)
}

await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun run build`.cwd(pluginDir)

const cliArgs = ["script/build.ts", "--single", "--skip-embed-web-ui", "--skip-install"]
if (process.platform === "win32" && process.arch === "x64") cliArgs.splice(2, 0, "--baseline")
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
const cliBuildEnv = {
  ...process.env,
  LFCODE_CHANNEL: channel,
  LFCODE_VERSION: rootPkg.version,
}
let builtCliTarget = cliTarget
try {
  await $`bun ${cliArgs}`.cwd(lfcodeDir).env(cliBuildEnv)
} catch (error) {
  if (!(process.platform === "win32" && process.arch === "x64" && cliArgs.includes("--baseline"))) throw error
  console.warn("Baseline CLI build failed; falling back to the local x64 CLI target.")
  await $`bun script/build.ts --single --skip-embed-web-ui --skip-install`.cwd(lfcodeDir).env(cliBuildEnv)
  builtCliTarget = "lfcode-windows-x64"
}
await copyBinaryToCliFolder(path.join(lfcodeDir, "dist", builtCliTarget, "bin", windowsify("lfcode")))

await $`bun ${path.join(lfcodeDir, "script/build-node.ts")}`
  .env({
    ...process.env,
    LFCODE_BUILD_NODE_SKIP_EMBEDDED_WEB_UI: "true",
    LFCODE_CHANNEL: channel,
    LFCODE_VERSION: rootPkg.version,
  })

const appWebDir = path.resolve(import.meta.dir, "../../app")
const appWebDist = path.join(appWebDir, "dist")
await $`bun run build`.cwd(appWebDir).env({
  ...process.env,
  LFCODE_CHANNEL: channel,
  LFCODE_VERSION: rootPkg.version,
})
await fs.rm(path.resolve(import.meta.dir, "../out/web-ui"), { recursive: true, force: true })
await fs.cp(appWebDist, path.resolve(import.meta.dir, "../out/web-ui"), { recursive: true })
