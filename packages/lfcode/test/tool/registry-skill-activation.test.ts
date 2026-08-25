import { describe, expect, test } from "bun:test"
import { Skill } from "../../src/skill"
import { extensionToolIsActive } from "../../src/tool/registry"

describe("Skill-gated extension tools", () => {
  test("keeps an extension tool hidden until its exact Skill result is in session history", () => {
    const active = Skill.activeNames([
      {
        parts: [
          {
            type: "tool",
            tool: "skill",
            state: { status: "completed", output: '<skill_content name="imagemaker">instructions</skill_content>' },
          },
        ],
      },
    ] as never)

    expect(extensionToolIsActive({ activationSkill: "imagemaker" }, new Set())).toBe(false)
    expect(extensionToolIsActive({ activationSkill: "imagemaker" }, new Set(active))).toBe(true)
    expect(extensionToolIsActive({}, new Set())).toBe(true)
  })

  test("ignores searches and failed Skill calls as activation evidence", () => {
    expect(
      Skill.activeNames([
        { parts: [{ type: "tool", tool: "skill", state: { status: "completed", output: "<skill_search_results />" } }] },
        { parts: [{ type: "tool", tool: "skill", state: { status: "error", output: '<skill_content name="imagemaker">' } }] },
      ] as never),
    ).toEqual([])
  })
})
