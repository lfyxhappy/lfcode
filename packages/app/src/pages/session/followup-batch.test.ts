import { describe, expect, test } from "bun:test"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { batchFollowupDrafts, canBatchFollowupDrafts } from "./followup-batch"

const draft = (content: string): FollowupDraft => ({
  sessionID: "ses_1",
  sessionDirectory: "/repo",
  prompt: [{ type: "text", content, start: 0, end: content.length }],
  context: [],
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
})

describe("followup batches", () => {
  test("merges consecutive compatible drafts into one model turn", () => {
    const result = batchFollowupDrafts([draft("first"), draft("second")])

    expect(result.prompt).toMatchObject([
      { type: "text", content: "first", start: 0, end: 5 },
      { type: "text", content: "\n\n", start: 5, end: 7 },
      { type: "text", content: "second", start: 7, end: 13 },
    ])
  })

  test("does not batch drafts with different model settings", () => {
    const previous = draft("first")
    const next = { ...draft("second"), model: { providerID: "provider", modelID: "other" } }

    expect(canBatchFollowupDrafts(previous, next)).toBe(false)
  })
})
