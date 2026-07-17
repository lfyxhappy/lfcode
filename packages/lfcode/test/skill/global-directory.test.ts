import { expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import {
  globalSkillRoot,
  legacyGlobalSkillRoot,
  migrateExternalGlobalSkills,
  migrateLegacyGlobalSkills,
} from "../../src/skill/global-directory"
import { tmpdir } from "../fixture/fixture"

test("moves legacy global skills to the canonical root and preserves canonical duplicates", async () => {
  await using tmp = await tmpdir()
  const home = Object.getOwnPropertyDescriptor(Global.Path, "home")
  const config = Global.Path.config
  Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })
  Object.assign(Global.Path, { config: path.join(tmp.path, "legacy-config") })
  try {
    await Bun.write(path.join(legacyGlobalSkillRoot(), "legacy-only", "SKILL.md"), "# Legacy")
    await Bun.write(path.join(legacyGlobalSkillRoot(), "duplicate", "SKILL.md"), "# Old")
    await Bun.write(path.join(globalSkillRoot(), "duplicate", "SKILL.md"), "# Canonical")

    const result = await migrateLegacyGlobalSkills()

    expect(result.migrated).toEqual(["legacy-only"])
    expect(result.retained).toEqual(["duplicate"])
    expect(await Bun.file(path.join(globalSkillRoot(), "legacy-only", "SKILL.md")).text()).toBe("# Legacy")
    expect(await Bun.file(path.join(globalSkillRoot(), "duplicate", "SKILL.md")).text()).toBe("# Canonical")
    expect(await Bun.file(path.join(legacyGlobalSkillRoot(), "duplicate", "SKILL.md")).text()).toBe("# Old")
  } finally {
    Object.assign(Global.Path, { config })
    Object.defineProperty(Global.Path, "home", home!)
  }
})

test("copies external skill roots into the canonical root", async () => {
  await using tmp = await tmpdir()
  const home = Object.getOwnPropertyDescriptor(Global.Path, "home")
  const config = Global.Path.config
  Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })
  Object.assign(Global.Path, { config: path.join(tmp.path, "legacy-config") })
  try {
    await Bun.write(path.join(tmp.path, ".codex", "skills", "codex-only", "SKILL.md"), "# Codex")
    await Bun.write(path.join(tmp.path, ".agents", "skills", "duplicate", "SKILL.md"), "# Agent")
    await Bun.write(path.join(globalSkillRoot(), "duplicate", "SKILL.md"), "# Canonical")

    const result = await migrateExternalGlobalSkills()

    expect(result.migrated).toContain("codex-only")
    expect(result.retained).toContain("duplicate")
    expect(await Bun.file(path.join(globalSkillRoot(), "codex-only", "SKILL.md")).text()).toBe("# Codex")
    expect(await Bun.file(path.join(globalSkillRoot(), "duplicate", "SKILL.md")).text()).toBe("# Canonical")
    expect(await Bun.file(path.join(tmp.path, ".codex", "skills", "codex-only", "SKILL.md")).text()).toBe("# Codex")
  } finally {
    Object.assign(Global.Path, { config })
    Object.defineProperty(Global.Path, "home", home!)
  }
})
