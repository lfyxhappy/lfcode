export type LanProject = {
  id: string
  worktree: string
  name?: string
  icon?: unknown
  time?: unknown
  sandboxes?: string[]
}

export function desktopLanProjects(projects: LanProject[], serverState: unknown) {
  const opened = desktopOpenWorktrees(serverState)
  const byWorktree = new Map(projects.map((project) => [workspaceKey(project.worktree), project]))
  const result = new Map<string, LanProject>()

  for (const worktree of opened) {
    const direct = byWorktree.get(workspaceKey(worktree))
    if (direct) {
      result.set(workspaceKey(direct.worktree), direct)
      continue
    }

    const root = projects.find((project) => project.sandboxes?.some((sandbox) => workspaceKey(sandbox) === workspaceKey(worktree)))
    if (root) result.set(workspaceKey(root.worktree), root)
  }

  return [...result.values()]
}

export function desktopLanSessions(input: unknown, worktree: string) {
  if (!Array.isArray(input)) return []
  return input.filter((value) => visibleLanSession(value, worktree))
}

function desktopOpenWorktrees(input: unknown) {
  const state = record(typeof input === "string" ? parse(input) : input)
  const projects = record(state?.projects)
  const local = projects?.local
  if (!Array.isArray(local)) return []

  return local.flatMap((project) => {
    const worktree = record(project)?.worktree
    if (typeof worktree !== "string" || !worktree || workspaceKey(worktree) === "/") return []
    return [worktree]
  })
}

function visibleLanSession(value: unknown, worktree: string) {
  const session = record(value)
  if (!session || typeof session.id !== "string" || typeof session.directory !== "string") return false
  if (workspaceKey(session.directory) !== workspaceKey(worktree)) return false
  if (session.parentID || session.contextFrom) return false
  return !record(session.time)?.archived
}

function workspaceKey(value: string) {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/, "") || "/"
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function parse(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return
  }
}
