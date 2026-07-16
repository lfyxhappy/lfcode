export const PLUGIN_TRUST = ["bundled", "official", "dev-local", "external"] as const
export type PluginTrust = (typeof PLUGIN_TRUST)[number]

export const PLUGIN_CATEGORIES = ["tool", "provider", "integration", "ui", "theme", "runtime", "mixed"] as const
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]

export const PLUGIN_SOURCE_TYPES = ["npm", "directory", "zip", "generated", "bundled", "internal"] as const
export type PluginSourceType = (typeof PLUGIN_SOURCE_TYPES)[number]

export const PLUGIN_ENTRYPOINT_TARGETS = ["location", "tui", "desktop", "app"] as const
export type PluginEntrypointTarget = (typeof PLUGIN_ENTRYPOINT_TARGETS)[number]

export type PluginEntrypoint = {
  path: string
  config?: Record<string, unknown>
}

export type PluginRuntimeDependency = {
  id: string
  version?: string
  required?: boolean
}

export type PluginManifest = {
  apiVersion: number | string
  id?: string
  name?: string
  version?: string
  description?: string
  category?: PluginCategory
  capabilities?: string[]
  compatibility?: {
    lfcode?: string
  }
  trust?: PluginTrust
  entrypoints: Partial<Record<PluginEntrypointTarget, PluginEntrypoint>>
  runtimeDependencies?: PluginRuntimeDependency[]
  configSchema?: unknown
  migrations?: unknown
}

export function readLfcodePluginManifest(value: unknown, spec: string) {
  if (value === undefined) return
  if (!isRecord(value)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode manifest`)
  }

  const entrypoints = readEntrypoints(value.entrypoints, spec)
  const capabilities = readCapabilities(value.capabilities, spec)
  const category = readCategory(value.category, spec)
  const trust = readTrust(value.trust, spec)
  const compatibility = readCompatibility(value.compatibility, spec)
  const runtimeDependencies = readRuntimeDependencies(value.runtimeDependencies, spec)

  return {
    apiVersion: readApiVersion(value.apiVersion, spec),
    id: readOptionalString(value.id, spec, "lfcode.id"),
    name: readOptionalString(value.name, spec, "lfcode.name"),
    version: readOptionalString(value.version, spec, "lfcode.version"),
    description: readOptionalString(value.description, spec, "lfcode.description"),
    category,
    capabilities,
    compatibility,
    trust,
    entrypoints,
    runtimeDependencies,
    configSchema: value.configSchema,
    migrations: value.migrations,
  } satisfies PluginManifest
}

function readCategory(value: unknown, spec: string) {
  if (value === undefined) return
  if (typeof value !== "string" || !PLUGIN_CATEGORIES.includes(value as PluginCategory)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.category`)
  }
  return value as PluginCategory
}

function readRuntimeDependencies(value: unknown, spec: string) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new TypeError(`Plugin ${spec} has invalid lfcode.runtimeDependencies`)
  return value.map((item) => {
    if (!isRecord(item)) throw new TypeError(`Plugin ${spec} has invalid lfcode.runtimeDependencies entry`)
    const id = readOptionalString(item.id, spec, "lfcode.runtimeDependencies[].id")
    if (!id) throw new TypeError(`Plugin ${spec} must declare lfcode.runtimeDependencies[].id`)
    const version = readOptionalString(item.version, spec, "lfcode.runtimeDependencies[].version")
    if (item.required !== undefined && typeof item.required !== "boolean") {
      throw new TypeError(`Plugin ${spec} has invalid lfcode.runtimeDependencies[].required`)
    }
    return {
      id,
      ...(version ? { version } : {}),
      ...(item.required === undefined ? {} : { required: item.required }),
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readApiVersion(value: unknown, spec: string) {
  if (typeof value === "number" || typeof value === "string") {
    if (`${value}`.trim()) return value
  }
  throw new TypeError(`Plugin ${spec} must declare lfcode.apiVersion`)
}

function readOptionalString(value: unknown, spec: string, field: string) {
  if (value === undefined) return
  if (typeof value !== "string") {
    throw new TypeError(`Plugin ${spec} has invalid ${field}`)
  }
  const next = value.trim()
  if (!next) {
    throw new TypeError(`Plugin ${spec} has empty ${field}`)
  }
  return next
}

function readCapabilities(value: unknown, spec: string) {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.capabilities`)
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new TypeError(`Plugin ${spec} has invalid lfcode.capabilities entry`)
    }
    const next = item.trim()
    if (!next) {
      throw new TypeError(`Plugin ${spec} has empty lfcode.capabilities entry`)
    }
    return next
  })
}

function readTrust(value: unknown, spec: string) {
  if (value === undefined) return
  if (typeof value !== "string" || !PLUGIN_TRUST.includes(value as PluginTrust)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.trust`)
  }
  return value as PluginTrust
}

function readCompatibility(value: unknown, spec: string) {
  if (value === undefined) return
  if (!isRecord(value)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.compatibility`)
  }
  const lfcode = value.lfcode
  if (lfcode !== undefined && typeof lfcode !== "string") {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.compatibility.lfcode`)
  }
  return {
    lfcode,
  }
}

function readEntrypoints(value: unknown, spec: string) {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.entrypoints`)
  }

  const result: Partial<Record<PluginEntrypointTarget, PluginEntrypoint>> = {}
  for (const target of PLUGIN_ENTRYPOINT_TARGETS) {
    const raw = value[target]
    if (raw === undefined) continue
    result[target] = readEntrypoint(raw, target, spec)
  }
  return result
}

function readEntrypoint(value: unknown, target: PluginEntrypointTarget, spec: string): PluginEntrypoint {
  if (typeof value === "string") {
    const next = value.trim()
    if (!next) {
      throw new TypeError(`Plugin ${spec} has empty lfcode.entrypoints.${target}`)
    }
    return { path: next }
  }

  if (!isRecord(value)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.entrypoints.${target}`)
  }

  const path = readOptionalString(value.path, spec, `lfcode.entrypoints.${target}.path`)
  if (!path) {
    throw new TypeError(`Plugin ${spec} must declare lfcode.entrypoints.${target}.path`)
  }
  const config = value.config
  if (config !== undefined && !isRecord(config)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.entrypoints.${target}.config`)
  }
  return {
    path,
    config,
  }
}
