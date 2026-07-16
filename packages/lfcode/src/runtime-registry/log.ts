import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { type RuntimeManageItemID, type RuntimeOperationAction, type RuntimeOperationLog, type RuntimeOperationLogState } from "./types"

const LOG_PATH = path.join(Global.Path.data, "runtime", "logs.jsonl")
const MAX_ENTRIES = 200
const DEFAULT_LIMIT = 20

export async function listRuntimeOperationLogs(options?: {
  limit?: number
  id?: RuntimeManageItemID
}): Promise<RuntimeOperationLogState> {
  const entries = await readRuntimeOperationLogs()
  const filtered = options?.id ? entries.filter((entry) => entry.id === options.id) : entries
  const limit = Math.max(1, Math.min(options?.limit ?? DEFAULT_LIMIT, MAX_ENTRIES))
  return {
    refreshedAt: Date.now(),
    entries: filtered.slice(-limit).reverse(),
  }
}

export function runtimeOperationLogPath() {
  return LOG_PATH
}

export async function recordRuntimeOperationLog(
  entry: Omit<RuntimeOperationLog, "timestamp"> & { timestamp?: number },
): Promise<void> {
  const next = {
    ...entry,
    timestamp: entry.timestamp ?? Date.now(),
  }
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true })
  await fs.appendFile(LOG_PATH, `${JSON.stringify(next)}\n`, "utf8")
}

async function readRuntimeOperationLogs() {
  try {
    const raw = await fs.readFile(LOG_PATH, "utf8")
    return raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as RuntimeOperationLog]
        } catch {
          return []
        }
      })
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }
}

function isEnoent(error: unknown): error is { code: "ENOENT" } {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"
}

export function runtimeOperationTitle(id: RuntimeManageItemID, action: RuntimeOperationAction) {
  const noun =
    id === "voice-recorder"
      ? "录音器"
      : id === "ffmpeg"
        ? "FFmpeg"
        : id === "python-base"
          ? "Python 基础运行时"
          : id === "python-managed"
            ? "Python 受管环境"
            : id === "cpp-compiler"
              ? "C++ 编译器"
              : id === "java-runtime"
                ? "Java 运行时"
                : id === "java-sdk"
                  ? "Java SDK"
                  : "OfficeCLI"
  return `${noun}${action === "install" ? "安装" : action === "repair" ? "修复" : action === "update" ? "更新" : "切换"}`
}
