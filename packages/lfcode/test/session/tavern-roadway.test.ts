import { describe, expect, test } from "bun:test"
import { buildTranscript, RoadwayMode } from "../../src/session/tavern-roadway"

describe("Tavern roadway input", () => {
  test("accepts the dedicated side-effect-free story summary mode", () => {
    expect(RoadwayMode.parse("summary")).toBe("summary")
    expect(RoadwayMode.safeParse("compaction").success).toBe(false)
  })

  test("does not include hidden context-reviewer output in the roadway prompt", () => {
    expect(
      buildTranscript(
        [
          { info: { role: "user", agentID: "main" }, parts: [{ type: "text", text: "Visible user request" }] },
          {
            info: { role: "assistant", agentID: "context-reviewer-1" },
            parts: [{ type: "text", text: '{"skills":["private-skill"]}' }],
          },
          { info: { role: "assistant", agentID: "main" }, parts: [{ type: "text", text: "Visible assistant reply" }] },
        ],
        40,
      ),
    ).toEqual([
      { role: "user", content: "Visible user request" },
      { role: "assistant", content: "Visible assistant reply" },
    ])
  })
})
