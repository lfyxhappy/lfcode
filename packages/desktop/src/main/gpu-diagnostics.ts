import { app } from "electron"

export const GPU_MODES = ["auto", "d3d11", "software"] as const
export type GpuMode = (typeof GPU_MODES)[number]
export type GpuRuntimeStatus = "hardware" | "software" | "fallback" | "unknown"

const sensitiveKey = /(path|directory|dir|serial|uuid|guid|token|cookie|password|username|profile|command.?line|user.?data|machine.?model)/i
const gpuSwitches = new Map<GpuMode, Array<{ name: string; value?: string }>>([
  ["auto", []],
  ["d3d11", [{ name: "use-angle", value: "d3d11" }]],
  ["software", [{ name: "disable-gpu" }]],
])
let configuredMode: GpuMode | undefined

export function normalizeGpuMode(value: string | undefined | null): GpuMode {
  const mode = value?.trim().toLowerCase()
  if (mode === "d3d11" || mode === "software") return mode
  return "auto"
}

export function gpuModeFromEnvironment(environment: NodeJS.ProcessEnv = process.env): GpuMode {
  return normalizeGpuMode(environment.LFCODE_GPU_MODE)
}

/** Apply GPU switches before app.whenReady(). The default auto mode is intentionally a no-op. */
export function configureGpuMode(mode = gpuModeFromEnvironment()) {
  if (configuredMode) return configuredMode
  configuredMode = mode
  for (const item of gpuSwitches.get(mode) ?? []) {
    app.commandLine.appendSwitch(item.name, item.value)
  }
  return mode
}

export function configuredGpuMode() {
  return configuredMode ?? gpuModeFromEnvironment()
}

export function configuredGpuSwitches(mode = configuredGpuMode()) {
  return (gpuSwitches.get(mode) ?? []).map((item) => (item.value ? `${item.name}=${item.value}` : item.name))
}

export async function getGpuDiagnostics() {
  const featureStatus = safe(() => app.getGPUFeatureStatus())
  const info = await Promise.resolve()
    .then(() => app.getGPUInfo("complete"))
    .catch(() => undefined)
  const metrics = safe(() => app.getAppMetrics())
  const detectedStatus = gpuRuntimeStatus(featureStatus, info)
  const status = detectedStatus === "unknown" && configuredGpuMode() === "software" ? "software" : detectedStatus
  const backend = readBackend(info)
  const gpuProcesses = Array.isArray(metrics)
    ? metrics
        .filter((item) => item.type === "GPU" || item.serviceName?.toLowerCase().includes("gpu"))
        .map((item) => ({
          pid: item.pid,
          type: item.type,
          serviceName: item.serviceName,
          cpuPercent: round(item.cpu.percentCPUUsage),
          workingSetMb: round(item.memory.workingSetSize / 1024),
          privateMb: round((item.memory.privateBytes ?? 0) / 1024),
        }))
    : []

  return {
    mode: configuredGpuMode(),
    switches: configuredGpuSwitches(),
    status,
    hardwareAcceleration:
      status === "hardware" ? "enabled" : status === "software" || status === "fallback" ? "disabled" : "unknown",
    hardwareAccelerated: status === "hardware",
    backend,
    featureStatus: sanitizeGpuValue(featureStatus) ?? null,
    info: sanitizeGpuValue(info) ?? null,
    gpuProcesses,
    capturedAt: Date.now(),
  }
}

export function gpuRuntimeStatus(featureStatus: unknown, info: unknown): GpuRuntimeStatus {
  const values = Object.values(asRecord(featureStatus)).map((value) => String(value).toLowerCase())
  const implementation = readBackend(info)?.toLowerCase() ?? ""
  if (values.length === 0 && !implementation) return "unknown"
  if (values.some((value) => value.includes("unavailable") || value.includes("disabled_software"))) return "fallback"
  if (values.some((value) => value.includes("software"))) return "software"
  if (implementation.includes("swiftshader") || implementation.includes("software")) return "software"
  if (values.some((value) => value === "enabled" || value === "enabled_readback")) return "hardware"
  if (implementation.includes("angle") || implementation.includes("d3d") || implementation.includes("metal")) return "hardware"
  return "unknown"
}

function readBackend(input: unknown) {
  const record = asRecord(input)
  const aux = asRecord(record.auxAttributes)
  const value = [
    record.angleBackend,
    record.graphicsBackend,
    record.glImplementation,
    aux.angleBackend,
    aux.glImplementation,
    aux.displayType,
  ].find((item): item is string => typeof item === "string" && item.trim().length > 0)
  return value?.slice(0, 200)
}

function sanitizeGpuValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return value.slice(0, 512)
  if (depth >= 4) return "[truncated]"
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => sanitizeGpuValue(item, depth + 1))
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKey.test(key))
      .slice(0, 100)
      .map(([key, item]) => [key, sanitizeGpuValue(item, depth + 1)]),
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safe<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

function round(value: number) {
  return Math.round(value * 10) / 10
}
