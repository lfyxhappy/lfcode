#!/usr/bin/env bun
import { rm } from "node:fs/promises"
import { bundledGitStageDir } from "./bundled-git"

await rm(bundledGitStageDir(), { recursive: true, force: true })
console.log(`Cleaned bundled Git staging directory: ${bundledGitStageDir()}`)
