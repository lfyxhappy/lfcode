export const PLUGIN_TRUST = ["bundled", "official", "dev-local", "external"] as const
export type PluginTrust = (typeof PLUGIN_TRUST)[number]

export const PLUGIN_CATEGORIES = ["tool", "provider", "integration", "ui", "theme", "runtime", "mixed"] as const
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]

export const PLUGIN_ACTIVATIONS = ["startup", "model"] as const
export type PluginActivation = (typeof PLUGIN_ACTIVATIONS)[number]

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

export type PluginSkillRequirement = {
  id: string
  required?: boolean
  purpose?: string
}

export type PluginBundledSkill = {
  id: string
  path: string
}

export type PluginStorage = {
  data?: boolean
}

export type PluginManagedProject = {
  type: string
  name?: string
  worktree: string
}

// Desktop slots are declarations only until the desktop host provides a sandboxed loader.
// `tui-slot` is the sole executable plugin UI surface in this contract.
export const PLUGIN_UI_CONTRIBUTION_SLOTS = [
  "tui-slot",
  "desktop-settings-panel",
  "desktop-session-toolbar",
  "desktop-session-composer",
] as const
export type PluginUIContributionSlot = (typeof PLUGIN_UI_CONTRIBUTION_SLOTS)[number]

export const PLUGIN_SESSION_COMPOSER_MODES = ["replace", "append"] as const
export type PluginSessionComposerMode = (typeof PLUGIN_SESSION_COMPOSER_MODES)[number]

// Plugin UI remains declarative. The desktop host owns the actual component and
// never gives a plugin's renderer access to the main window DOM.
export const PLUGIN_SESSION_COMPOSER_RENDERERS = ["conversation"] as const
export type PluginSessionComposerRenderer = (typeof PLUGIN_SESSION_COMPOSER_RENDERERS)[number]

export const PLUGIN_SESSION_HIDDEN_COMPONENTS = ["summary", "jobs-rail", "side-panel"] as const
export type PluginSessionHiddenComponent = (typeof PLUGIN_SESSION_HIDDEN_COMPONENTS)[number]

export type PluginUIContribution = {
  slot: PluginUIContributionSlot
  title?: string
  sessionComposer?: {
    type: string
    mode: PluginSessionComposerMode
    renderer: PluginSessionComposerRenderer
    placeholder?: string
    submitLabel?: string
    description?: string
    hiddenComponents?: PluginSessionHiddenComponent[]
  }
  managedSession?: {
    type: string
    title?: string
    label?: string
  }
}

export type PluginManifest = {
  apiVersion: number | string
  id?: string
  name?: string
  version?: string
  description?: string
  category?: PluginCategory
  activation?: PluginActivation
  capabilities?: string[]
  compatibility?: {
    lfcode?: string
  }
  trust?: PluginTrust
  entrypoints: Partial<Record<PluginEntrypointTarget, PluginEntrypoint>>
  runtimeDependencies?: PluginRuntimeDependency[]
  skillRequirements?: PluginSkillRequirement[]
  bundledSkills?: PluginBundledSkill[]
  uiContributions?: PluginUIContribution[]
  managedProject?: PluginManagedProject
  storage?: PluginStorage
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
  const activation = readActivation(value.activation, spec)
  const trust = readTrust(value.trust, spec)
  const compatibility = readCompatibility(value.compatibility, spec)
  const runtimeDependencies = readRuntimeDependencies(value.runtimeDependencies, spec)
  const skillRequirements = readSkillRequirements(value.skillRequirements, spec)
  const bundledSkills = readBundledSkills(value.bundledSkills, spec)
  const uiContributions = readUIContributions(value.uiContributions, spec)
  const managedProject = readManagedProject(value.managedProject, spec)
  const storage = readStorage(value.storage, spec)

  return {
    apiVersion: readApiVersion(value.apiVersion, spec),
    id: readOptionalString(value.id, spec, "lfcode.id"),
    name: readOptionalString(value.name, spec, "lfcode.name"),
    version: readOptionalString(value.version, spec, "lfcode.version"),
    description: readOptionalString(value.description, spec, "lfcode.description"),
    category,
    activation,
    capabilities,
    compatibility,
    trust,
    entrypoints,
    runtimeDependencies,
    skillRequirements,
    bundledSkills,
    uiContributions,
    managedProject,
    storage,
    configSchema: value.configSchema,
    migrations: value.migrations,
  } satisfies PluginManifest
}

function readManagedProject(value: unknown, spec: string) {
  if (value === undefined) return
  if (!isRecord(value)) throw new TypeError(`Plugin ${spec} has invalid lfcode.managedProject`)
  const type = readOptionalString(value.type, spec, "lfcode.managedProject.type")
  const worktree = readOptionalString(value.worktree, spec, "lfcode.managedProject.worktree")
  if (!type || !worktree) throw new TypeError(`Plugin ${spec} must declare lfcode.managedProject.type and worktree`)
  if (worktree.startsWith("/") || worktree.startsWith("\\") || worktree.split(/[\\/]/).some((part) => part === "..")) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.managedProject.worktree`)
  }
  const name = readOptionalString(value.name, spec, "lfcode.managedProject.name")
  return { type, worktree, ...(name ? { name } : {}) }
}

function readActivation(value: unknown, spec: string) {
  if (value === undefined) return
  if (typeof value !== "string" || !PLUGIN_ACTIVATIONS.includes(value as PluginActivation)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.activation`)
  }
  return value as PluginActivation
}

function readStorage(value: unknown, spec: string) {
  if (value === undefined) return
  if (!isRecord(value) || (value.data !== undefined && typeof value.data !== "boolean")) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.storage`)
  }
  return value.data === undefined ? {} : { data: value.data }
}

function readSkillRequirements(value: unknown, spec: string) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new TypeError(`Plugin ${spec} has invalid lfcode.skillRequirements`)
  return value.map((item) => {
    if (!isRecord(item)) throw new TypeError(`Plugin ${spec} has invalid lfcode.skillRequirements entry`)
    const id = readOptionalString(item.id, spec, "lfcode.skillRequirements[].id")
    if (!id) throw new TypeError(`Plugin ${spec} must declare lfcode.skillRequirements[].id`)
    const purpose = readOptionalString(item.purpose, spec, "lfcode.skillRequirements[].purpose")
    if (item.required !== undefined && typeof item.required !== "boolean") {
      throw new TypeError(`Plugin ${spec} has invalid lfcode.skillRequirements[].required`)
    }
    return {
      id,
      ...(purpose ? { purpose } : {}),
      ...(item.required === undefined ? {} : { required: item.required }),
    }
  })
}

function readBundledSkills(value: unknown, spec: string) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new TypeError(`Plugin ${spec} has invalid lfcode.bundledSkills`)
  const skills = value.map((item) => {
    if (!isRecord(item)) throw new TypeError(`Plugin ${spec} has invalid lfcode.bundledSkills entry`)
    const id = readOptionalString(item.id, spec, "lfcode.bundledSkills[].id")
    const skillPath = readOptionalString(item.path, spec, "lfcode.bundledSkills[].path")
    if (!id || !skillPath) throw new TypeError(`Plugin ${spec} must declare lfcode.bundledSkills[].id and path`)
    if (
      skillPath.startsWith("/") ||
      skillPath.startsWith("\\") ||
      /^[A-Za-z]:[\\/]/.test(skillPath) ||
      skillPath.split(/[\\/]/).some((part) => part === "..") ||
      !/(?:^|[\\/])SKILL\.md$/i.test(skillPath)
    ) {
      throw new TypeError(`Plugin ${spec} has invalid lfcode.bundledSkills[].path`)
    }
    return { id, path: skillPath }
  })
  if (new Set(skills.map((item) => item.id)).size !== skills.length) {
    throw new TypeError(`Plugin ${spec} has duplicate lfcode.bundledSkills[].id`)
  }
  return skills
}

function readUIContributions(value: unknown, spec: string) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new TypeError(`Plugin ${spec} has invalid lfcode.uiContributions`)
  return value.map((item) => {
    if (!isRecord(item)) throw new TypeError(`Plugin ${spec} has invalid lfcode.uiContributions entry`)
    if (typeof item.slot !== "string" || !PLUGIN_UI_CONTRIBUTION_SLOTS.includes(item.slot as PluginUIContributionSlot)) {
      throw new TypeError(`Plugin ${spec} has invalid lfcode.uiContributions[].slot`)
    }
    const title = readOptionalString(item.title, spec, "lfcode.uiContributions[].title")
    const managedSession = readManagedSessionContribution(item.managedSession, spec)
    const sessionComposer = readSessionComposerContribution(item.sessionComposer, spec)
    if (sessionComposer && item.slot !== "desktop-session-composer") {
      throw new TypeError(`Plugin ${spec} must use desktop-session-composer for lfcode.uiContributions[].sessionComposer`)
    }
    return {
      slot: item.slot as PluginUIContributionSlot,
      ...(title ? { title } : {}),
      ...(sessionComposer ? { sessionComposer } : {}),
      ...(managedSession ? { managedSession } : {}),
    }
  })
}

function readSessionComposerContribution(value: unknown, spec: string) {
  if (value === undefined) return
  if (!isRecord(value)) throw new TypeError(`Plugin ${spec} has invalid lfcode.uiContributions[].sessionComposer`)
  const type = readOptionalString(value.type, spec, "lfcode.uiContributions[].sessionComposer.type")
  if (!type) throw new TypeError(`Plugin ${spec} must declare lfcode.uiContributions[].sessionComposer.type`)
  if (typeof value.mode !== "string" || !PLUGIN_SESSION_COMPOSER_MODES.includes(value.mode as PluginSessionComposerMode)) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.uiContributions[].sessionComposer.mode`)
  }
  if (
    typeof value.renderer !== "string" ||
    !PLUGIN_SESSION_COMPOSER_RENDERERS.includes(value.renderer as PluginSessionComposerRenderer)
  ) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.uiContributions[].sessionComposer.renderer`)
  }
  const placeholder = readOptionalString(value.placeholder, spec, "lfcode.uiContributions[].sessionComposer.placeholder")
  const submitLabel = readOptionalString(value.submitLabel, spec, "lfcode.uiContributions[].sessionComposer.submitLabel")
  const description = readOptionalString(value.description, spec, "lfcode.uiContributions[].sessionComposer.description")
  const hiddenComponents = readSessionHiddenComponents(value.hiddenComponents, spec)
  return {
    type,
    mode: value.mode as PluginSessionComposerMode,
    renderer: value.renderer as PluginSessionComposerRenderer,
    ...(placeholder ? { placeholder } : {}),
    ...(submitLabel ? { submitLabel } : {}),
    ...(description ? { description } : {}),
    ...(hiddenComponents?.length ? { hiddenComponents } : {}),
  }
}

function readSessionHiddenComponents(value: unknown, spec: string) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !PLUGIN_SESSION_HIDDEN_COMPONENTS.includes(item as PluginSessionHiddenComponent))) {
    throw new TypeError(`Plugin ${spec} has invalid lfcode.uiContributions[].sessionComposer.hiddenComponents`)
  }
  return [...new Set(value)] as PluginSessionHiddenComponent[]
}

function readManagedSessionContribution(value: unknown, spec: string) {
  if (value === undefined) return
  if (!isRecord(value)) throw new TypeError(`Plugin ${spec} has invalid lfcode.uiContributions[].managedSession`)
  const type = readOptionalString(value.type, spec, "lfcode.uiContributions[].managedSession.type")
  if (!type) throw new TypeError(`Plugin ${spec} must declare lfcode.uiContributions[].managedSession.type`)
  const title = readOptionalString(value.title, spec, "lfcode.uiContributions[].managedSession.title")
  const label = readOptionalString(value.label, spec, "lfcode.uiContributions[].managedSession.label")
  return { type, ...(title ? { title } : {}), ...(label ? { label } : {}) }
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
