import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"

export function globalSkillRoot() {
  return path.join(Global.Path.home, ".lfcode", "skills")
}

export function legacyGlobalSkillRoot() {
  return path.join(Global.Path.config, "skills")
}

function externalSkillRoots() {
  return [
    { source: legacyGlobalSkillRoot(), mode: "move" as const },
    { source: path.join(Global.Path.home, ".codex", "skills"), mode: "copy" as const },
    { source: path.join(Global.Path.home, ".claude", "skills"), mode: "copy" as const },
    { source: path.join(Global.Path.home, ".agents", "skills"), mode: "copy" as const },
  ]
}

export async function migrateLegacyGlobalSkills() {
  return migrateSkillRoot({ source: legacyGlobalSkillRoot(), mode: "move" })
}

export async function migrateExternalGlobalSkills() {
  const migrated: string[] = []
  const retained: string[] = []
  for (const root of externalSkillRoots()) {
    const result = await migrateSkillRoot(root)
    migrated.push(...result.migrated)
    retained.push(...result.retained)
  }
  return { migrated, retained }
}

async function migrateSkillRoot(input: { source: string; mode: "copy" | "move" }) {
  const source = input.source
  const target = globalSkillRoot()
  if (path.resolve(source) === path.resolve(target)) return { migrated: [], retained: [] }

  const entries = await fs.readdir(source).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  if (entries.length === 0) return { migrated: [], retained: [] }

  await fs.mkdir(target, { recursive: true })
  const migrated: string[] = []
  const retained: string[] = []
  for (const entry of entries) {
    const from = path.join(source, entry)
    const to = path.join(target, entry)
    const exists = await fs
      .access(to)
      .then(() => true)
      .catch(() => false)
    if (exists) {
      retained.push(entry)
      continue
    }

    try {
      if (input.mode === "move") await fs.rename(from, to)
      else await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
      migrated.push(entry)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      retained.push(entry)
    }
  }

  return { migrated, retained }
}
