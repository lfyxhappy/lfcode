import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import * as Maintenance from "./persistence"

export async function applyCandidate(candidateID: string) {
  const candidate = Maintenance.getCandidate(candidateID)
  if (!candidate) throw new Error("Maintenance candidate was not found")
  if (candidate.status !== "approved") throw new Error("Approve the maintenance candidate before applying it")
  if (candidate.targetKind !== "skill") throw new Error("Only skill candidates are supported for controlled application")
  if (candidate.candidateKind !== "skill_create" && candidate.candidateKind !== "skill_update") {
    throw new Error("This maintenance candidate is not a supported skill change")
  }
  const targetPath = candidate.targetPath
  const proposedSkill = candidate.proposedPatchPreview
  if (!targetPath || !proposedSkill) throw new Error("The candidate has no skill target or complete skill document")

  try {
    const target = resolveSkillTarget(targetPath)
    const body = validateSkillDocument(proposedSkill)
    const existing = await fs.readFile(target, "utf-8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (candidate.candidateKind === "skill_create" && existing !== undefined) {
      throw new Error("The proposed skill already exists; refresh the candidate before applying it")
    }
    if (candidate.candidateKind === "skill_update" && existing === undefined) {
      throw new Error("The proposed skill no longer exists; refresh the candidate before applying it")
    }

    const backupPath = existing === undefined ? undefined : path.join(Global.Path.state, "maintenance", "candidates", candidate.id, "before-SKILL.md")
    if (backupPath && existing !== undefined) {
      await fs.mkdir(path.dirname(backupPath), { recursive: true })
      await fs.writeFile(backupPath, existing, "utf-8")
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${candidate.id}.tmp`
    await fs.writeFile(temporary, body, "utf-8")
    await fs.rename(temporary, target)
    return Maintenance.markCandidateApplied({
      id: candidate.id,
      detail: {
        targetPath,
        backupPath,
        operation: candidate.candidateKind,
      },
    })
  } catch (error) {
    Maintenance.markCandidateApplyFailed({ id: candidate.id, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

function resolveSkillTarget(targetPath: string) {
  const root = path.resolve(Global.Path.config)
  const skillsRoot = path.resolve(root, "skills")
  const target = path.resolve(root, targetPath)
  const relative = path.relative(skillsRoot, target)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.basename(target) !== "SKILL.md") {
    throw new Error("Skill candidates must target skills/<name>/SKILL.md inside the Lfcode config directory")
  }
  return target
}

function validateSkillDocument(value: string) {
  const body = value.trim() + "\n"
  if (body.length > 512_000) throw new Error("The proposed skill document is too large to apply")
  if (!body.startsWith("---\n") || !/^---$/m.test(body.slice(4))) {
    throw new Error("The proposed skill document must contain YAML frontmatter")
  }
  if (/\u0000/.test(body)) throw new Error("The proposed skill document contains invalid binary data")
  return body
}
