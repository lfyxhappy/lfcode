#!/usr/bin/env bun
import { $ } from "bun"

if (process.platform !== "win32") process.exit(0)

await $`bun ./scripts/sync-win-use-copy.ts`.env(process.env)
