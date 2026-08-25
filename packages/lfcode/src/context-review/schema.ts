import z from "zod"
import { MessageID, SessionID } from "@/session/schema"

export const ContextReviewStatus = z.enum(["pending", "running", "completed", "failed", "consumed", "expired"])
export type ContextReviewStatus = z.infer<typeof ContextReviewStatus>

const MemoryQuery = z
  .string()
  .trim()
  .min(2)
  .max(120)
  // A hand-off is a search key, never prose copied from retrieved Memory.
  // Keep it to words and a few non-executable separators so it cannot carry
  // markup, instructions, or a Memory excerpt into the next system context.
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}\s._:/-]*$/u)

// Console Go validates structured-output schemas with a regex dialect that
// rejects Unicode property escapes. Keep the strict regex in MemoryQuery for
// server-side validation, while giving providers a portable model schema.
const MemoryQueryOutput = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .describe("A short search key containing words and simple separators, never prose or instructions.")

/** Deliberately small, declarative hand-off. The reviewer never supplies Skill or Memory bodies. */
export const ContextReviewFindings = z
  .object({
    skills: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
        }).strict(),
      )
      // Keep a hand-off small enough to remain a review signal rather than a
      // second system prompt. Skill names are re-validated before rendering.
      .max(12)
      .default([]),
    memory: z
      .array(
        z.object({
          query: MemoryQuery,
        }).strict(),
      )
      .max(6)
      .default([]),
  })
  .strict()
export type ContextReviewFindings = z.infer<typeof ContextReviewFindings>

/** Provider-portable schema used only for the reviewer's structured response. */
export const ContextReviewFindingsOutput = z
  .object({
    skills: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
        }).strict(),
      )
      .max(12)
      .default([]),
    memory: z
      .array(
        z.object({
          query: MemoryQueryOutput,
        }).strict(),
      )
      .max(6)
      .default([]),
  })
  .strict()

export const ContextReview = z
  .object({
    id: z.string(),
    sessionID: SessionID.zod,
    sourceUserMessageID: MessageID.zod,
    sourceAssistantMessageID: MessageID.zod.optional(),
    consumingUserMessageID: MessageID.zod.optional(),
    reviewerActorID: z.string().optional(),
    status: ContextReviewStatus,
    findings: ContextReviewFindings.optional(),
    error: z.string().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
      completed: z.number().optional(),
      consumed: z.number().optional(),
      expired: z.number().optional(),
    }),
  })
  .meta({ ref: "ContextReview" })
export type ContextReview = z.infer<typeof ContextReview>
