import { $ } from "bun"
import semver from "semver"
import fs from "fs"
import path from "path"

function findWorkspaceRootPackageJson(startDir: string) {
  let current = startDir
  while (true) {
    const candidate = path.join(current, "package.json")
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { packageManager?: string; workspaces?: unknown }
        if (typeof parsed.packageManager === "string" && parsed.workspaces) return candidate
      } catch {}
    }

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  throw new Error(`workspace root package.json not found from ${startDir}`)
}

const rootPkgPath = findWorkspaceRootPackageJson(import.meta.dir)
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  LFCODE_CHANNEL: process.env["LFCODE_CHANNEL"] ?? process.env["OPENCODE_CHANNEL"],
  LFCODE_BUMP: process.env["LFCODE_BUMP"] ?? process.env["OPENCODE_BUMP"],
  LFCODE_VERSION: process.env["LFCODE_VERSION"] ?? process.env["OPENCODE_VERSION"],
  LFCODE_RELEASE: process.env["LFCODE_RELEASE"] ?? process.env["OPENCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.LFCODE_CHANNEL) return env.LFCODE_CHANNEL
  if (env.LFCODE_BUMP) return "stable"
  if (env.LFCODE_VERSION && !env.LFCODE_VERSION.startsWith("0.0.0-")) return "stable"
  return await $`git branch --show-current`.text().then((x) => x.trim()) || "stable"
})()
const IS_PREVIEW = CHANNEL !== "stable"

const VERSION = await (async () => {
  if (env.LFCODE_VERSION) return env.LFCODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = await Bun.file(path.resolve(import.meta.dir, "../../../package.json"))
    .json()
    .then((data) => (data as { version?: string }).version)
  if (!version) throw new Error("Root package.json is missing a version")
  const t = env.LFCODE_BUMP?.toLowerCase()
  if (!t) return version
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.LFCODE_RELEASE
  },
}
console.log(`lfcode script`, JSON.stringify(Script, null, 2))
