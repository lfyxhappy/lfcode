import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { isLoopbackAutomationHost } from "./automation-security"

const MANAGED_ROOT_DIR = ".lfcode"
const AUTOMATION_STATE_DIR = "automation"
const AUTOMATION_STATE_FILE = "desktop.json"
const execFileAsync = promisify(execFile)

export type AutomationDiscovery = {
  host: string
  pid: number
  port: number
  startedAt: number
  token: string
  userData: string
  version: string
  protocolVersion?: number
  instanceID?: string
}

export function resolveAutomationStateFile(env = process.env) {
  if (env.LFCODE_AUTOMATION_STATE_FILE) return env.LFCODE_AUTOMATION_STATE_FILE
  if (env.LFCODE_STATE_DIR) return join(env.LFCODE_STATE_DIR, AUTOMATION_STATE_DIR, AUTOMATION_STATE_FILE)
  return join(homedir(), MANAGED_ROOT_DIR, "state", AUTOMATION_STATE_DIR, AUTOMATION_STATE_FILE)
}

export async function readAutomationDiscovery(env = process.env): Promise<AutomationDiscovery | undefined> {
  const file = resolveAutomationStateFile(env)
  const text = await readFile(file, "utf8").catch(() => undefined)
  if (!text) return undefined
  try {
    return parseAutomationDiscovery(JSON.parse(text) as unknown)
  } catch {
    return undefined
  }
}

export async function writeAutomationDiscovery(state: AutomationDiscovery, env = process.env) {
  const file = resolveAutomationStateFile(env)
  const directory = dirname(file)
  const temporary = join(directory, `.${AUTOMATION_STATE_FILE}.${process.pid}.${randomUUID()}.tmp`)
  await mkdir(directory, { mode: 0o700, recursive: true })
  await secureAutomationPath(directory, true)
  const handle = await open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(JSON.stringify(parseAutomationDiscovery(state), null, 2), "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await secureAutomationPath(temporary, false)
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
  return file
}

export async function removeAutomationDiscovery(env = process.env) {
  const file = resolveAutomationStateFile(env)
  await rm(file, { force: true })
}

function parseAutomationDiscovery(value: unknown): AutomationDiscovery {
  if (!isRecord(value)) throw new Error("Invalid automation discovery")
  if (typeof value.host !== "string" || !isLoopbackAutomationHost(value.host)) {
    throw new Error("Invalid automation discovery host")
  }
  if (typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new Error("Invalid automation discovery pid")
  }
  if (typeof value.port !== "number" || !Number.isSafeInteger(value.port) || value.port <= 0 || value.port > 65_535) {
    throw new Error("Invalid automation discovery port")
  }
  if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt) || value.startedAt <= 0) {
    throw new Error("Invalid automation discovery start time")
  }
  if (typeof value.token !== "string" || !value.token) throw new Error("Invalid automation discovery token")
  if (typeof value.userData !== "string" || !value.userData) throw new Error("Invalid automation discovery user data")
  if (typeof value.version !== "string" || !value.version) throw new Error("Invalid automation discovery version")
  if (
    value.protocolVersion !== undefined &&
    (typeof value.protocolVersion !== "number" ||
      !Number.isSafeInteger(value.protocolVersion) ||
      value.protocolVersion <= 0)
  ) {
    throw new Error("Invalid automation discovery protocol version")
  }
  if (value.instanceID !== undefined && (typeof value.instanceID !== "string" || !value.instanceID)) {
    throw new Error("Invalid automation discovery instance ID")
  }
  return {
    host: value.host,
    pid: value.pid,
    port: value.port,
    startedAt: value.startedAt,
    token: value.token,
    userData: value.userData,
    version: value.version,
    ...(value.protocolVersion === undefined ? {} : { protocolVersion: value.protocolVersion }),
    ...(value.instanceID === undefined ? {} : { instanceID: value.instanceID }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

async function secureAutomationPath(path: string, directory: boolean) {
  if (process.platform !== "win32") {
    await chmod(path, directory ? 0o700 : 0o600)
    return
  }
  const result = await execFileAsync(windowsSystemExecutable("whoami.exe"), ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true,
  })
  const sid = result.stdout.match(/S-\d(?:-\d+)+/)?.[0]
  if (!sid) throw new Error("Unable to resolve the current Windows user SID for automation discovery ACL")
  await execFileAsync(
    windowsSystemExecutable("icacls.exe"),
    [
      path,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:${directory ? "(OI)(CI)(F)" : "(F)"}`,
      `*S-1-5-18:${directory ? "(OI)(CI)(F)" : "(F)"}`,
      `*S-1-5-32-544:${directory ? "(OI)(CI)(F)" : "(F)"}`,
    ],
    { windowsHide: true },
  )
}

function windowsSystemExecutable(name: string) {
  return join(process.env.SystemRoot || "C:\\Windows", "System32", name)
}
