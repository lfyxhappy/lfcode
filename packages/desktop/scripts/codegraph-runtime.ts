import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

export const CODEGRAPH_VERSION = "v1.4.1"
export const CODEGRAPH_ASSET = "codegraph-win32-x64.zip"
export const CODEGRAPH_SHA256 = "559cb1010b7899b5137f0801d35698f722a33370e907a84968852d3d68f6458d"
export const CODEGRAPH_URL = `https://github.com/colbymchenry/codegraph/releases/download/${CODEGRAPH_VERSION}/${CODEGRAPH_ASSET}`
export const CODEGRAPH_RUNTIME_METADATA_FILE = "lfcode-codegraph-runtime.json"

const execFileAsync = promisify(execFile)

export type CodegraphRuntimeResult = {
  /** `codegraph.exe` for legacy releases, or the JavaScript launcher for Node releases. */
  readonly entry: string
  readonly installDir: string
  readonly nodePath?: string
  readonly reused: boolean
}

export async function prepareCodegraphRuntime(input: {
  readonly stageDir: string
  readonly cacheDir?: string
  readonly platform?: string
  readonly arch?: string
  readonly fetchImpl?: typeof fetch
  readonly curlImpl?: (input: { readonly output: string; readonly url: string }) => Promise<void>
  readonly curlMaxTimeSeconds?: number
}): Promise<CodegraphRuntimeResult | undefined> {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  if (platform !== "win32" || arch !== "x64") return undefined

  const staged = await resolveCodegraphRuntimeLayout(input.stageDir)
  if (staged && (await hasVerifiedRuntimeMetadata(input.stageDir, staged))) return { ...staged, reused: true }
  if (staged) await rm(input.stageDir, { recursive: true, force: true })

  const cacheDir = input.cacheDir ?? path.join(input.stageDir, "cache")
  const archive = path.join(cacheDir, `${CODEGRAPH_VERSION}-${CODEGRAPH_ASSET}`)
  await mkdir(cacheDir, { recursive: true })
  if (existsSync(archive) && (await sha256File(archive)) !== CODEGRAPH_SHA256) {
    await rm(archive, { force: true })
    await rm(`${archive}.part`, { force: true })
  }
  if (!existsSync(archive)) {
    await downloadArchive(archive, input.fetchImpl, input.curlImpl, input.curlMaxTimeSeconds)
  }

  const digest = await sha256File(archive)
  if (digest !== CODEGRAPH_SHA256) {
    await rm(archive, { force: true })
    throw new Error(`CodeGraph SHA256 mismatch: expected ${CODEGRAPH_SHA256}, received ${digest}`)
  }

  const extractDir = path.join(cacheDir, `${CODEGRAPH_VERSION}-extract`)
  await rm(extractDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })
  await execFileAsync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(extractDir)} -Force`,
  ])

  const candidate = await findCodegraphRuntimeLayout(extractDir)
  if (!candidate) throw new Error("CodeGraph archive did not contain a supported launcher")
  await rm(input.stageDir, { recursive: true, force: true })
  await mkdir(input.stageDir, { recursive: true })
  for (const entry of await readdir(candidate.installDir)) {
    await cp(path.join(candidate.installDir, entry), path.join(input.stageDir, entry), { recursive: true, force: true })
  }
  const prepared = await resolveCodegraphRuntimeLayout(input.stageDir)
  if (!prepared) throw new Error("CodeGraph runtime extraction did not produce a supported launcher")
  await writeRuntimeMetadata(input.stageDir, prepared)
  return { ...prepared, reused: false }
}

export async function sha256File(file: string) {
  const hash = createHash("sha256")
  hash.update(Buffer.from(await Bun.file(file).arrayBuffer()))
  return hash.digest("hex")
}

async function isRegularFile(file: string) {
  return stat(file).then((value) => value.isFile() && value.size > 0, () => false)
}

export async function resolveCodegraphRuntimeLayout(installDir: string): Promise<Omit<CodegraphRuntimeResult, "reused"> | undefined> {
  const executable = path.join(installDir, "codegraph.exe")
  if (await isRegularFile(executable)) return { entry: executable, installDir }

  const nodePath = path.join(installDir, "node.exe")
  const entry = path.join(installDir, "lib", "dist", "bin", "codegraph.js")
  if (!(await isRegularFile(nodePath)) || !(await isRegularFile(entry))) return
  return { entry, installDir, nodePath }
}

type CodegraphRuntimeMetadata = {
  readonly version: string
  readonly asset: string
  readonly sha256: string
  readonly launcher: "node" | "executable"
  readonly runtimeSha256: string
}

async function hasVerifiedRuntimeMetadata(
  installDir: string,
  layout: Omit<CodegraphRuntimeResult, "reused">,
) {
  const metadata = await Bun.file(path.join(installDir, CODEGRAPH_RUNTIME_METADATA_FILE))
    .json()
    .catch(() => undefined) as Partial<CodegraphRuntimeMetadata> | undefined
  return (
    metadata?.version === CODEGRAPH_VERSION &&
    metadata.asset === CODEGRAPH_ASSET &&
    metadata.sha256 === CODEGRAPH_SHA256 &&
    metadata.launcher === (layout.nodePath ? "node" : "executable") &&
    metadata.runtimeSha256 === (await sha256RuntimeTree(installDir))
  )
}

async function writeRuntimeMetadata(installDir: string, layout: Omit<CodegraphRuntimeResult, "reused">) {
  const metadata: CodegraphRuntimeMetadata = {
    version: CODEGRAPH_VERSION,
    asset: CODEGRAPH_ASSET,
    sha256: CODEGRAPH_SHA256,
    launcher: layout.nodePath ? "node" : "executable",
    runtimeSha256: await sha256RuntimeTree(installDir),
  }
  await writeFile(path.join(installDir, CODEGRAPH_RUNTIME_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`)
}

export async function sha256RuntimeTree(installDir: string) {
  const files = await listRuntimeFiles(installDir)
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(file.relative)
    hash.update("\0")
    hash.update(Buffer.from(await Bun.file(file.absolute).arrayBuffer()))
    hash.update("\0")
  }
  return hash.digest("hex")
}

async function listRuntimeFiles(installDir: string, current = installDir): Promise<Array<{ relative: string; absolute: string }>> {
  const entries = await readdir(current, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) return listRuntimeFiles(installDir, absolute)
      if (!entry.isFile() || entry.name === CODEGRAPH_RUNTIME_METADATA_FILE) return Promise.resolve([])
      return Promise.resolve([{ relative: path.relative(installDir, absolute).replaceAll("\\", "/"), absolute }])
    }),
  )
  return files.flat().sort((left, right) => left.relative.localeCompare(right.relative))
}

async function downloadArchive(
  archive: string,
  fetchImpl?: typeof fetch,
  curlImpl?: (input: { readonly output: string; readonly url: string }) => Promise<void>,
  curlMaxTimeSeconds?: number,
) {
  const partial = `${archive}.part`
  let response: Response
  try {
    response = await (fetchImpl ?? fetch)(CODEGRAPH_URL)
  } catch (error) {
    if (fetchImpl && !curlImpl) throw error
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`CodeGraph fetch failed (${message}); retrying with Windows curl certificate store.`)
    await downloadWithCurl(partial, curlImpl, curlMaxTimeSeconds)
    await rename(partial, archive)
    return
  }
  if (!response.ok) throw new Error(`CodeGraph download failed: ${response.status}`)
  await writeFile(partial, Buffer.from(await response.arrayBuffer()))
  await rename(partial, archive)
}

async function downloadWithCurl(
  output: string,
  curlImpl?: (input: { readonly output: string; readonly url: string }) => Promise<void>,
  maxTimeSeconds = 180,
) {
  if (curlImpl) {
    await curlImpl({ output, url: CODEGRAPH_URL }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`CodeGraph download failed through Windows curl fallback: ${message}`)
    })
    return
  }
  await execFileAsync("curl.exe", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--connect-timeout",
    "15",
    "--max-time",
    String(maxTimeSeconds),
    "--ssl-no-revoke",
    "--continue-at",
    "-",
    "--output",
    output,
    CODEGRAPH_URL,
  ]).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`CodeGraph download failed through Windows curl fallback: ${message}`)
  })
}

async function findCodegraphRuntimeLayout(directory: string): Promise<Omit<CodegraphRuntimeResult, "reused"> | undefined> {
  const local = await resolveCodegraphRuntimeLayout(directory)
  if (local) return local
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findCodegraphRuntimeLayout(target)
      if (nested) return nested
    }
  }
}

function quotePowerShell(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "../../..")
  try {
    const result = await prepareCodegraphRuntime({
      stageDir: path.join(root, ".codegraph-runtime"),
      cacheDir: path.join(root, ".codegraph-runtime-cache"),
      curlMaxTimeSeconds: Number(process.env.LFCODE_CODEGRAPH_DOWNLOAD_MAX_TIME ?? 180),
    })
    console.log(result ? `${result.reused ? "Reused" : "Prepared"} CodeGraph runtime: ${result.entry}` : "Skipping CodeGraph preparation.")
  } catch (error) {
    if (process.env.LFCODE_CODEGRAPH_OPTIONAL !== "true") throw error
    console.warn(`CodeGraph runtime is unavailable; packaging with external fallback: ${error instanceof Error ? error.message : String(error)}`)
  }
}
