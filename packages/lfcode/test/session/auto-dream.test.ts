import { describe, expect, test } from "bun:test"
import { parseDistillCandidates } from "../../src/session/auto-dream"

describe("automatic memory maintenance", () => {
  test("accepts structured distill candidates and ignores explicit skips", () => {
    const candidates = parseDistillCandidates(`
      \`\`\`json
      [
        {
          "candidate_kind": "skill_update",
          "target_kind": "skill",
          "target_path": "skills/release/SKILL.md",
          "evidence": ["ses_123", "ses_456"],
          "confidence": 91,
          "proposed_summary": "Add the repeatable release checklist."
        },
        {
          "candidate_kind": "skip",
          "target_kind": "none",
          "evidence": ["ses_789"],
          "confidence": 10,
          "proposed_summary": "One-off task."
        }
      ]
      \`\`\`
    `)

    expect(candidates).toEqual([
      {
        candidate_kind: "skill_update",
        target_kind: "skill",
        target_path: "skills/release/SKILL.md",
        evidence: ["ses_123", "ses_456"],
        confidence: 91,
        proposed_summary: "Add the repeatable release checklist.",
      },
    ])
  })

  test("rejects prose and malformed candidate output instead of creating queue rows", () => {
    expect(parseDistillCandidates("No repeated workflow found.")).toEqual([])
    expect(parseDistillCandidates("```json\n[{not json}]\n```")).toEqual([])
  })
})
