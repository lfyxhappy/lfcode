#!/usr/bin/env bun
import path from "node:path"

const pkgPath = path.resolve(import.meta.dir, "../package.json")
const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const pkg = await Bun.file(pkgPath).json()
const rootPkg = await Bun.file(rootPkgPath).json()

if (pkg.version === rootPkg.version) process.exit(0)

pkg.version = rootPkg.version
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated app package version to ${rootPkg.version}`)
