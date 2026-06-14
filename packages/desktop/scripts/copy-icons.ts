import { $ } from "bun"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "stable" ? arg : resolveChannel()
const sourceChannel = channel === "stable" ? "prod" : channel

const src = `./icons/${sourceChannel}`
const dest = "resources/icons"

await $`rm -rf ${dest}`
await $`cp -R ${src} ${dest}`
console.log(`Copied ${channel} icons from ${src} to ${dest}`)
