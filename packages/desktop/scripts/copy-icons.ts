import { cp, rm } from "node:fs/promises"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "stable" ? arg : resolveChannel()
const sourceChannel = channel === "stable" ? "prod" : channel

const src = `./icons/${sourceChannel}`
const dest = "resources/icons"

await rm(dest, { recursive: true, force: true })
await cp(src, dest, { recursive: true, force: true })
console.log(`Copied ${channel} icons from ${src} to ${dest}`)
