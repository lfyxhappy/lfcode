#!/usr/bin/env bun
import { stageBundledPythonRuntime } from "./bundled-python"

if (process.platform !== "win32") {
  console.log("Skipping bundled Python preparation on non-Windows platform.")
  process.exit(0)
}

const result = await stageBundledPythonRuntime()
if (!result) {
  console.log("Bundled Python staging skipped.")
  process.exit(0)
}

console.log(
  `${result.reused ? "Reused" : "Prepared"} bundled Python runtime: ${result.source} -> ${result.stage} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`,
)
