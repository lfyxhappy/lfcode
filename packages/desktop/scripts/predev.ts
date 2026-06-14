import { $ } from "bun"
import { existsSync } from "node:fs"
import { join } from "node:path"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "stable"}`

await $`cd ../opencode && bun script/build-node.ts`

const electronBinary = join(
  process.cwd(),
  "node_modules/electron/dist",
  process.platform === "win32"
    ? "electron.exe"
    : process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : "electron",
)

if (!existsSync(electronBinary)) await ensureElectronBinary()

async function ensureElectronBinary() {
  console.log("Electron runtime missing, installing local binary")
  const result = await installElectron(process.env)
  if (result.ok && existsSync(electronBinary)) {
    console.log("Electron runtime installed")
    return
  }

  if (!result.stderr.includes("unable to verify the first certificate")) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Electron install failed")
  }

  console.log("Electron download hit certificate verification, retrying with NODE_TLS_REJECT_UNAUTHORIZED=0")
  const retry = await installElectron({
    ...process.env,
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
  })

  if (retry.ok && existsSync(electronBinary)) {
    console.log("Electron runtime installed after TLS retry")
    return
  }

  throw new Error(retry.stderr.trim() || retry.stdout.trim() || "Electron install failed after TLS retry")
}

async function installElectron(env: NodeJS.ProcessEnv) {
  const proc = Bun.spawn({
    cmd: [process.execPath, "./install.js"],
    cwd: join(process.cwd(), "node_modules/electron"),
    stdout: "pipe",
    stderr: "pipe",
    env,
  })

  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  return {
    ok: code === 0,
    stdout,
    stderr,
  }
}
