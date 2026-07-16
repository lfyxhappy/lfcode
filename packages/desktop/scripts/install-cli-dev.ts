#!/usr/bin/env bun
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const desktopDir = path.join(root, "packages", "desktop")
const lfcodeDir = path.join(root, "packages", "lfcode")
const helperPath = path.join(desktopDir, "resources", "cli", "install-cli.cjs")

const cliArgs = ["script/build.ts", "--single", "--skip-embed-web-ui", "--skip-install"]
if (process.platform === "win32" && process.arch === "x64") cliArgs.splice(2, 0, "--baseline")
await Bun.$`bun ${cliArgs}`.cwd(lfcodeDir)

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
const binary = path.join(lfcodeDir, "dist", cliTarget, "bin", process.platform === "win32" ? "lfcode.exe" : "lfcode")
await Bun.$`node ${helperPath} install --scope user --binary ${binary}`.cwd(root)
