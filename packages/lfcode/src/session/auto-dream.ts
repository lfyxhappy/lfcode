import { Effect } from "effect"
import z from "zod"
import { Maintenance } from "@/maintenance"
import { MaintenanceScheduler } from "@/maintenance"
import type { Config } from "@/config"

export const AUTO_DREAM_TITLE = "Auto Dream"
export const AUTO_DISTILL_TITLE = "Auto Distill"

export const DREAM_TASK = [
  "Run one automatic Dream consolidation pass for the current project.",
  "",
  "Use raw lfcode trajectory as the source of truth. Memory Markdown is only a compatibility projection of typed records.",
  "Use terminal tools only for read-only SQLite and filesystem inspection. On Windows, use pwsh syntax. Do not modify the database.",
  "Do not edit memory files directly. After verification, persist each complete durable record with memory(operation=write_project_record).",
  "Use only MEMORY or MEMORY-<topic> keys and send a complete Markdown body for each record. Do not package workflows in this stage.",
].join("\n")

export const DISTILL_TASK = [
  "Run one automatic Distill analysis pass for the current project.",
  "",
  "Review recent trajectories for repeated, costly workflows. Inventory existing skills, agents, and commands first.",
  "Use terminal tools only for read-only SQLite and filesystem inspection. On Windows, use pwsh syntax. Do not modify the database or any asset files.",
  "Do not create, edit, or delete skills, commands, agents, plugins, or source files. Your only deliverable is a JSON array in a fenced json block.",
  "Each object must contain candidate_kind, target_kind, optional target_path, evidence (array of session IDs or dated observations), confidence (0-100), proposed_summary, and optional proposed_patch_preview.",
  "For skill_create or skill_update, target_path must be skills/<name>/SKILL.md and proposed_patch_preview must be the complete UTF-8 SKILL.md document, including YAML frontmatter. Other target kinds remain review-only.",
  "Use candidate_kind=skip when no workflow meets the evidence bar. Keep the array empty when there are no candidates.",
].join("\n")

const DistillCandidate = z.object({
  candidate_kind: z.enum([
    "skill_update",
    "skill_create",
    "command_update",
    "command_create",
    "agent_update",
    "agent_create",
    "skip",
  ]),
  target_kind: z.enum(["skill", "command", "agent", "none"]),
  target_path: z.string().min(1).optional(),
  evidence: z.array(z.string().min(1)).min(1),
  confidence: z.number().int().min(0).max(100),
  proposed_summary: z.string().min(1),
  proposed_patch_preview: z.string().min(1).optional(),
})

const DistillCandidates = z.array(DistillCandidate)

export function maintenanceConfig(cfg: Config.Info) {
  return {
    enabled: cfg.maintenance?.enabled ?? true,
    schedulerEnabled: cfg.maintenance?.scheduler_enabled ?? true,
    dreamEnabled: cfg.maintenance?.dream_enabled ?? cfg.dream?.auto !== false,
    distillEnabled: cfg.maintenance?.distill_enabled ?? cfg.distill?.auto !== false,
  }
}

export function claimAutomaticMaintenance(input: { cfg: Config.Info; projectID: string }) {
  const config = maintenanceConfig(input.cfg)
  if (!config.enabled || !config.schedulerEnabled) return Effect.succeed(undefined)
  if (!config.dreamEnabled && !config.distillEnabled) return Effect.succeed(undefined)
  return Effect.gen(function* () {
    const scheduled = yield* Effect.promise(() => MaintenanceScheduler.consumeMarker())
    const result = Maintenance.claim({
      jobKind: config.dreamEnabled && config.distillEnabled ? "full" : config.dreamEnabled ? "dream" : "distill",
      triggerSource: scheduled ? "scheduler" : "automatic",
      projectIDs: [input.projectID],
    })
    return result.status === "claimed" ? result.run : undefined
  })
}

export function claimManualMaintenance(input: {
  jobKind: "full" | "dream" | "distill"
  projectID: string
  triggerSource?: "manual" | "scheduler"
}) {
  return Effect.sync(() => {
    const result = Maintenance.claim({
      jobKind: input.jobKind,
      triggerSource: input.triggerSource ?? "manual",
      projectIDs: [input.projectID],
    })
    return result.status === "claimed" ? result.run : undefined
  })
}

export function parseDistillCandidates(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)
  if (!source.trim()) return []
  const parsed = safeJson(source)
  const candidates = DistillCandidates.safeParse(parsed)
  if (!candidates.success) return []
  return candidates.data.filter((candidate) => candidate.candidate_kind !== "skip")
}

function safeJson(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** @deprecated Use claimAutomaticMaintenance so dream and distill share one host ledger. */
export function shouldAutoDream(cfg: Config.Info) {
  const config = maintenanceConfig(cfg)
  return Effect.succeed(config.enabled && config.schedulerEnabled && config.dreamEnabled)
}

/** @deprecated Use claimAutomaticMaintenance so dream and distill share one host ledger. */
export function shouldAutoDistill(cfg: Config.Info) {
  const config = maintenanceConfig(cfg)
  return Effect.succeed(config.enabled && config.schedulerEnabled && config.distillEnabled)
}

export * as AutoDream from "./auto-dream"
