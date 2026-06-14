#!/usr/bin/env bun
import path from "node:path"

await import("./prebuild")

const pkg = await Bun.file("./package.json").json()
const rootPkg = await Bun.file(path.resolve(import.meta.dir, "../../../package.json")).json()
pkg.version = rootPkg.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${rootPkg.version}`)
