#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)
await import("./generate.ts")
import { Script } from "../../script/src/index"

const rootPkg = await Bun.file(path.join(dir, "../../package.json")).json()
const channel = process.env.LFCODE_CHANNEL ?? "stable"
const version = process.env.LFCODE_VERSION ?? rootPkg.version ?? "0.0.0"

const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const appDir = path.join(import.meta.dirname, "../../app")
const appDist = path.join(appDir, "dist")
const embeddedWebUI =
  process.env.LFCODE_BUILD_NODE_SKIP_EMBEDDED_WEB_UI === "true"
    ? "export default {}"
    : await (async () => {
        await $`bun run --cwd ${appDir} build`
        const appFiles = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: appDist })))
          .map((file) => file.replaceAll("\\\\", "/"))
          .sort()
        if (!appFiles.includes("index.html")) {
          throw new Error(`Web UI build did not produce index.html in ${appDist}`)
        }
        return [
          "// Generated package map for the sidecar Web UI.",
          ...appFiles.map((file, index) => {
            const spec = path.relative(dir, path.join(appDist, file)).replaceAll("\\\\", "/")
            return `import file_${index} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
          }),
          "export default {",
          ...appFiles.map((file, index) => `  ${JSON.stringify(file)}: file_${index},`),
          "}",
        ].join("\n")
      })()

const build = await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts", "lfcode-web-ui.gen.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  files: {
    "lfcode-web-ui.gen.ts": embeddedWebUI,
  },
  define: {
    LFCODE_MIGRATIONS: JSON.stringify(migrations),
    LFCODE_CHANNEL: JSON.stringify(channel),
    LFCODE_VERSION: JSON.stringify(version),
  },
})
if (!build.success) throw new Error("Unable to build the sidecar with its embedded Web UI")

console.log("Build complete")
