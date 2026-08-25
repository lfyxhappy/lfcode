import { Tool } from "@/tool"
import type { CapabilityRisk, CapabilitySource } from "./policy"

export type CapabilityKind = "tool" | "skill" | "plugin" | "mcp" | "runtime"
export type CapabilityHealth = "ready" | "disabled" | "degraded" | "missing"
export type CapabilityAuthentication = "not_required" | "available" | "required" | "unknown"

export type CapabilityCatalogEntry = {
  id: string
  title: string
  description?: string
  kind: CapabilityKind
  source: CapabilitySource
  risk: CapabilityRisk
  scope: "global" | "project"
  health: CapabilityHealth
  authentication: CapabilityAuthentication
  dependencies: string[]
  foreground: boolean
  background: boolean
  subagent: boolean
  reversible: boolean
}

export function toolCapability(tool: Tool.Def): CapabilityCatalogEntry {
  const metadata = Tool.definitionMetadata(tool)
  return {
    id: `tool:${tool.id}`,
    title: tool.id,
    description: tool.description,
    kind: "tool",
    source: metadata.namespace === "extensions" ? "plugin" : "core",
    risk: tool.id === "credential_manage" ? "credential" : metadata.readOnly ? "read" : metadata.kind === "execution" ? "destructive" : "modify",
    scope: "project",
    health: "ready",
    authentication: "not_required",
    dependencies: [],
    foreground: true,
    background: metadata.kind === "execution" || metadata.kind === "task",
    subagent: true,
    reversible: metadata.readOnly || metadata.kind !== "execution",
  }
}

export function localSkillCapability(input: { name: string; description: string; location: string }): CapabilityCatalogEntry {
  return {
    id: `skill:${input.name}`,
    title: input.name,
    description: input.description,
    kind: "skill",
    source: "local",
    risk: "read",
    scope: "global",
    health: "ready",
    authentication: "not_required",
    dependencies: [],
    foreground: true,
    background: true,
    subagent: true,
    reversible: true,
  }
}

export function filterCapabilities(entries: CapabilityCatalogEntry[], query?: string, kind?: CapabilityKind) {
  const needle = query?.trim().toLowerCase()
  return entries
    .filter((entry) => !kind || entry.kind === kind)
    .filter((entry) => !needle || `${entry.id} ${entry.title} ${entry.description ?? ""}`.toLowerCase().includes(needle))
    .toSorted((a, b) => a.id.localeCompare(b.id))
}
