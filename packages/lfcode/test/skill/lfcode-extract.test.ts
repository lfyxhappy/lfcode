import { afterEach, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "../../src/filesystem"
import { Global } from "../../src/global"
import { extractLfcodeBundle } from "../../src/skill/lfcode/extract"
import { tmpdir } from "../fixture/fixture"

const originalData = Global.Path.data
const plannedBundledSkillNames = [
  "codebase-explorer",
  "test-debugger",
  "dependency-upgrader",
  "refactor-engineer",
  "performance-profiler",
  "security-auditor",
  "api-reviewer",
  "database-migration",
  "document-editor",
  "pdf-processor",
  "spreadsheet-analyst",
  "slide-deck-builder",
  "research-synthesizer",
  "deep-research",
  "knowledge-curator",
  "git-release-manager",
  "deployment-operator",
  "observability-debugger",
  "ui-implementer",
  "accessibility-auditor",
] as const

afterEach(() => {
  Object.assign(Global.Path, { data: originalData })
})

test("refreshes a stale bundled Skill cache even when the version directory already exists", async () => {
  await using tmp = await tmpdir()
  Object.assign(Global.Path, { data: tmp.path })
  const root = path.join(tmp.path, "lfcode-skills", "local")
  await Bun.write(path.join(root, ".extracted"), "local")
  await Bun.write(path.join(root, "skills", "skill-creator", "SKILL.md"), "stale skill")
  for (const name of plannedBundledSkillNames) {
    await Bun.write(path.join(root, "skills", name, "SKILL.md"), `stale ${name}`)
  }

  await Effect.runPromise(
    Effect.gen(function* () {
      return yield* extractLfcodeBundle(yield* AppFileSystem.Service)
    }).pipe(Effect.provide(AppFileSystem.defaultLayer)),
  )
  const skillCreator = await Bun.file(path.join(root, "skills", "skill-creator", "SKILL.md")).text()
  const marker = JSON.parse(await Bun.file(path.join(root, ".extracted")).text()) as {
    format: number
    version: string
    fingerprint: string
  }

  expect(skillCreator).toContain("Create a user-managed skill")
  expect(await Bun.file(path.join(root, "skills", "runtime-installer", "SKILL.md")).exists()).toBe(true)
  expect(await Bun.file(path.join(root, "skills", "lfcode-plugin-author", "SKILL.md")).exists()).toBe(true)
  for (const name of plannedBundledSkillNames) {
    const content = await Bun.file(path.join(root, "skills", name, "SKILL.md")).text()
    expect(content).toContain(`name: ${name}`)
    expect(content).not.toBe(`stale ${name}`)
  }
  expect(marker.format).toBe(2)
  expect(marker.version).toBe("local")
  expect(marker.fingerprint).toHaveLength(64)
})
