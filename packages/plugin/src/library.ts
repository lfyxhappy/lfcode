import type { PluginCategory, PluginSourceType, PluginTrust } from "./manifest.js"

export type PluginFileSummary = {
  count: number
  bytes: number
}

export type PluginDependency = {
  name: string
  requested: string
  version?: string
  integrity?: string
  optional: boolean
}

export type PluginImportSource = {
  type: PluginSourceType
  label: string
  digest: string
}

export type PluginImportReport = {
  id: string
  name: string
  version: string
  description?: string
  category: PluginCategory
  capabilities: string[]
  trust: PluginTrust
  apiVersion: string
  lfcodeRange?: string
  entrypoints: string[]
  runtimeDependencies: { id: string; version?: string; required?: boolean }[]
  dependencies: PluginDependency[]
  source: PluginImportSource
  files: PluginFileSummary
  operation: "install" | "replace" | "unchanged"
  warnings: string[]
}

export type PluginImportPreview = {
  token: string
  expiresAt: number
  report: PluginImportReport
}

export type PluginInstallRecord = PluginImportReport & {
  installedAt: number
  enabled: boolean
  spec: string
  directory: string
}
