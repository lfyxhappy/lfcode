import { describe, expect, test } from "bun:test"
import { localSkillDirectory, localSkillKey, removeLocalSkill, replaceLocalSkill, skillImportSources, type LocalSkillItem } from "./settings-skills-helpers"

const skill = (input: Partial<LocalSkillItem> & { name: string; location: string }): LocalSkillItem => ({
  name: input.name,
  description: input.description ?? "",
  location: input.location,
  content: input.content ?? "",
  directory: input.directory,
})

describe("settings skills helpers", () => {
  test("derives stable local skill keys and directories", () => {
    const item = skill({ name: "alpha", location: "C:/repo/.lfcode/skills/alpha/SKILL.md" })

    expect(localSkillKey(item)).toBe("C:/repo/.lfcode/skills/alpha/SKILL.md")
    expect(localSkillDirectory(item)).toBe("C:/repo/.lfcode/skills/alpha")
  })

  test("replaces and removes local skills by key", () => {
    const base = [skill({ name: "alpha", location: "a" }), skill({ name: "beta", location: "b" })]
    const updated = skill({ name: "alpha-2", location: "a", directory: "a" })

    expect(replaceLocalSkill(base, updated).map((item) => item.name)).toEqual(["alpha-2", "beta"])
    expect(removeLocalSkill(base, localSkillKey(base[0]!)).map((item) => item.name)).toEqual(["beta"])
  })

  test("exposes the five import sources", () => {
    expect(skillImportSources.map((item) => item.value)).toEqual(["zip", "folder", "claude", "codex", "agents"])
  })
})
