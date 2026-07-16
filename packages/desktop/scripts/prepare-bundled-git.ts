#!/usr/bin/env bun
import { hasBundledGitRecommendedTools, stageBundledGitRuntime } from "./bundled-git"

if (process.platform !== "win32") {
  console.log("Skipping bundled Git preparation on non-Windows platform.")
  process.exit(0)
}

const result = await stageBundledGitRuntime()
if (!result) {
  console.log("Bundled Git staging skipped.")
  process.exit(0)
}

const extras = hasBundledGitRecommendedTools(result.stage) ? "git + ssh + less" : "git core"
console.log(
  `${result.reused ? "Reused" : "Prepared"} bundled Git runtime (${extras}): ${result.source} -> ${result.stage} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`,
)
