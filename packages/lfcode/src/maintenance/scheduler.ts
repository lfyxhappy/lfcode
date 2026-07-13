import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Process } from "@/util"

const TASK_NAME = "Lfcode Memory Maintenance"
const TASK_TIME = "03:15"

export type SchedulerState = {
  supported: boolean
  registered: boolean
  taskName: string
  markerPath: string
  lastRunTime?: string
  lastResult?: string
  error?: string
}

export function markerPath() {
  return path.join(Global.Path.state, "maintenance", "scheduled.json")
}

function scriptPath() {
  return path.join(Global.Path.state, "maintenance", "schedule-trigger.ps1")
}

export async function status(): Promise<SchedulerState> {
  if (process.platform !== "win32") {
    return { supported: false, registered: false, taskName: TASK_NAME, markerPath: markerPath() }
  }

  const result = await Process.run(["schtasks.exe", "/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"], { nothrow: true })
  if (result.code !== 0) {
    return { supported: true, registered: false, taskName: TASK_NAME, markerPath: markerPath() }
  }

  const output = result.stdout.toString("utf8")
  return {
    supported: true,
    registered: true,
    taskName: TASK_NAME,
    markerPath: markerPath(),
    lastRunTime: field(output, "Last Run Time", "上次运行时间"),
    lastResult: field(output, "Last Result", "上次运行结果"),
  }
}

export async function enable(): Promise<SchedulerState> {
  if (process.platform !== "win32") return status()
  const target = markerPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(
    scriptPath(),
    [
      "$ErrorActionPreference = 'Stop'",
      `$target = '${escapePowerShellLiteral(target)}'`,
      "$directory = Split-Path -Parent $target",
      "New-Item -ItemType Directory -Force -Path $directory | Out-Null",
      "@{ requested_at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress | Set-Content -LiteralPath $target -Encoding UTF8",
    ].join("\r\n"),
    "utf8",
  )
  const command = `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"${scriptPath()}\"`
  const result = await Process.run(
    ["schtasks.exe", "/Create", "/TN", TASK_NAME, "/TR", command, "/SC", "DAILY", "/ST", TASK_TIME, "/F"],
    { nothrow: true },
  )
  if (result.code !== 0) {
    return {
      supported: true,
      registered: false,
      taskName: TASK_NAME,
      markerPath: target,
      error: result.stderr.toString("utf8").trim() || "Unable to create the Windows scheduled task.",
    }
  }
  return status()
}

export async function disable(): Promise<SchedulerState> {
  if (process.platform !== "win32") return status()
  const result = await Process.run(["schtasks.exe", "/Delete", "/TN", TASK_NAME, "/F"], { nothrow: true })
  if (result.code !== 0 && !/cannot find|找不到/i.test(result.stderr.toString("utf8"))) {
    return {
      supported: true,
      registered: true,
      taskName: TASK_NAME,
      markerPath: markerPath(),
      error: result.stderr.toString("utf8").trim() || "Unable to remove the Windows scheduled task.",
    }
  }
  return status()
}

export async function consumeMarker() {
  const file = markerPath()
  const parsed = await fs
    .readFile(file, "utf8")
    .then((text) => JSON.parse(text) as { requested_at?: unknown })
    .catch(() => undefined)
  if (!parsed || typeof parsed.requested_at !== "number") return false
  await fs.unlink(file).catch(() => {})
  return true
}

function field(output: string, ...names: string[]) {
  const line = output.split(/\r?\n/).find((item) => names.some((name) => item.startsWith(`${name}:`)))
  return line?.slice(line.indexOf(":") + 1).trim() || undefined
}

function escapePowerShellLiteral(value: string) {
  return value.replace(/'/g, "''")
}
