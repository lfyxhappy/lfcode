#!/usr/bin/env bun
import { rm } from "node:fs/promises"
import { bundledPythonStageDir } from "./bundled-python"

await rm(bundledPythonStageDir(), { recursive: true, force: true })
console.log(`Cleaned bundled Python staging directory: ${bundledPythonStageDir()}`)
