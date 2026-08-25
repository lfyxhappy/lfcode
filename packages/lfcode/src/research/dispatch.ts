import z from "zod"

export const ResearchKind = z.literal("deep-research")
export const ResearchDepth = z.enum(["quick", "standard", "deep"])
export const ResearchPhase = z.enum(["planning", "retrieving", "verifying", "synthesizing", "completed", "failed", "cancelled"])

export const Snapshot = z
  .object({
    kind: ResearchKind,
    title: z.string().min(1).max(240).optional(),
    depth: ResearchDepth,
    phase: ResearchPhase.default("planning"),
    subtaskCount: z.number().int().min(0).max(3).default(0),
    sourceCount: z.number().int().min(0).default(0),
    citations: z.array(z.string().min(1).max(4096)).max(256).default([]),
    summary: z.string().max(12000).optional(),
    startedAt: z.number().int().optional(),
    completedAt: z.number().int().optional(),
  })
  .strict()
  .meta({ ref: "ResearchDispatchSnapshot" })

export type Snapshot = z.infer<typeof Snapshot>
