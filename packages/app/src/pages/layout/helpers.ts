import { getFilename } from "@lfcode-ai/shared/util/path"
import { type Session } from "@lfcode-ai/sdk/v2/client"
import { normalizeWorkspacePath } from "@/utils/persist"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

type WorkspaceNameStore = {
  workspaceName: Record<string, string>
  workspaceBranchName: Record<string, Record<string, string>>
}

type WorkspaceProject = {
  id?: string
  worktree: string
  sandboxes?: string[]
}

type ActivityProject = {
  worktree: string
  time?: {
    created?: number
    lastUser?: number
  }
}

type RootSessionCacheEntry = {
  stamp: string
  roots: Session[]
  sorted?: {
    pin: string
    value: Session[]
  }
}

const rootSessionCache = new WeakMap<object, RootSessionCacheEntry>()

export const workspaceKey = (directory: string) => normalizeWorkspacePath(directory)
export const pinnedSessionKey = (directory: string, sessionID: string) => `${workspaceKey(directory)}\n${sessionID}`
export const sessionActivityTime = (session: Pick<Session, "time">) => session.time.lastUser ?? session.time.created
export const projectActivityTime = (project: { time?: { created?: number; lastUser?: number } }) =>
  project.time?.lastUser ?? project.time?.created ?? 0

export const sortedProjects = <T extends ActivityProject>(
  projects: T[],
  options?: {
    pinned?: (project: T) => boolean
  },
) =>
  projects.slice().sort((a, b) => {
    const aPinned = options?.pinned?.(a) ?? false
    const bPinned = options?.pinned?.(b) ?? false
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    return projectActivityTime(b) - projectActivityTime(a)
  })

function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = sessionActivityTime(a)
    const bUpdated = sessionActivityTime(b)
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

const isRootVisibleSession = (session: Session, directory: string) =>
  workspaceKey(session.directory) === workspaceKey(directory) &&
  !session.parentID &&
  !session.contextFrom &&
  !session.time?.archived

function cachedRootSessions(store: SessionStore): RootSessionCacheEntry {
  const key = store as object
  const directory = store.path.directory
  const cached = rootSessionCache.get(key)
  const roots: Session[] = []
  let stamp = `${workspaceKey(directory)}|${store.session?.length ?? 0}`

  for (const session of store.session ?? []) {
    if (!isRootVisibleSession(session, directory)) continue
    roots.push(session)
    stamp += `|${session.id}:${session.parentID ?? ""}:${session.contextFrom ?? ""}:${sessionActivityTime(session)}:${session.time.updated ?? 0}`
  }

  if (cached?.stamp === stamp) return cached
  const next: RootSessionCacheEntry = { stamp, roots }
  rootSessionCache.set(key, next)
  return next
}

export const roots = (store: SessionStore) => cachedRootSessions(store).roots

export const sortedRootSessions = (
  store: SessionStore,
  now: number,
  options?: {
    pinned?: (session: Session) => boolean
    pinStamp?: string
  },
) => {
  const cached = cachedRootSessions(store)
  const pin = options?.pinStamp ?? ""
  if (cached.sorted?.pin === pin) return cached.sorted.value
  const compare = sortSessions(now)
  const sorted = cached.roots.slice().sort((a, b) => {
    const aPinned = options?.pinned?.(a) ?? false
    const bPinned = options?.pinned?.(b) ?? false
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    return compare(a, b)
  })
  cached.sorted = { pin, value: sorted }
  return sorted
}

export const latestRootSession = (stores: SessionStore[], now: number) => {
  const compare = sortSessions(now)
  let latest: Session | undefined

  for (const store of stores) {
    for (const session of roots(store)) {
      if (!latest || compare(session, latest) < 0) latest = session
    }
  }

  return latest
}

export const startupProjectRoot = (last: string | undefined, projects: { worktree: string }[]) =>
  projects.find((project) => project.worktree === last)?.worktree ?? projects[0]?.worktree ?? last

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const childSessionOnPath = (sessions: Session[] | undefined, rootID: string, activeID?: string) => {
  if (!activeID || activeID === rootID) return
  const map = new Map((sessions ?? []).map((session) => [session.id, session]))
  let id = activeID

  while (id) {
    const session = map.get(id)
    if (!session?.parentID) return
    if (session.contextFrom) return
    if (session.parentID === rootID) return session
    id = session.parentID
  }
}

export const descendantSessionIDs = (sessions: Session[] | undefined, rootID: string) => {
  const removed = new Set<string>([rootID])
  const byParent = new Map<string, string[]>()

  for (const session of sessions ?? []) {
    const parentID = session.parentID
    if (!parentID) continue
    const children = byParent.get(parentID)
    if (children) {
      children.push(session.id)
      continue
    }
    byParent.set(parentID, [session.id])
  }

  const stack = [rootID]
  while (stack.length) {
    const parentID = stack.pop()
    if (!parentID) continue
    const children = byParent.get(parentID)
    if (!children) continue
    for (const child of children) {
      if (removed.has(child)) continue
      removed.add(child)
      stack.push(child)
    }
  }

  return removed
}

export const isSidebarSessionSelected = (sessionID: string, activeID?: string) => sessionID === activeID

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = workspaceKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = workspaceKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = workspaceKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}

export const storedWorkspaceName = (
  store: WorkspaceNameStore,
  directory: string,
  projectId?: string,
  branch?: string,
) => {
  const key = workspaceKey(directory)
  const direct = store.workspaceName[key] ?? store.workspaceName[directory]
  if (direct) return direct
  if (!projectId) return
  if (!branch) return
  return store.workspaceBranchName[projectId]?.[branch]
}

export const storedWorkspaceLabel = (
  store: WorkspaceNameStore,
  directory: string,
  branch?: string,
  projectId?: string,
) => storedWorkspaceName(store, directory, projectId, branch) ?? branch ?? getFilename(directory)

export const orderedWorkspaceDirs = (input: {
  project: WorkspaceProject | undefined
  activeProjectWorktree?: string
  currentDir?: string
  persisted?: string[]
  isPending?: (directory: string) => boolean
}) => {
  const project = input.project
  if (!project) return []
  const local = project.worktree
  const dirs = [local, ...(project.sandboxes ?? [])]
  const directory =
    workspaceKey(input.activeProjectWorktree ?? "") === workspaceKey(project.worktree) ? input.currentDir : undefined
  const extra =
    directory &&
    workspaceKey(directory) !== workspaceKey(local) &&
    !dirs.some((item) => workspaceKey(item) === workspaceKey(directory))
      ? directory
      : undefined
  const pending = extra ? input.isPending?.(extra) === true : false

  const ordered = effectiveWorkspaceOrder(local, dirs, input.persisted)
  if (pending && extra) return [local, extra, ...ordered.filter((item) => item !== local)]
  if (!extra) return ordered
  if (pending) return ordered
  return [...ordered, extra]
}

export const visibleWorkspaceSessionDirs = (input: {
  project: Pick<WorkspaceProject, "worktree"> | undefined
  workspacesEnabled: boolean
  currentDir: string
  orderedDirs: string[]
  expanded: Record<string, boolean>
}) => {
  const project = input.project
  if (!project) return [] as string[]
  if (!input.workspacesEnabled) return [project.worktree]
  return input.orderedDirs.filter((directory) => {
    const expanded = input.expanded[directory] ?? directory === project.worktree
    const active = workspaceKey(directory) === workspaceKey(input.currentDir)
    return expanded || active
  })
}

export const projectRootForDirectory = (input: {
  directory: string
  projects: WorkspaceProject[]
  workspaceOrder: Record<string, string[]>
  childProjectID?: string
  projectMeta: { id?: string; worktree: string }[]
}) => {
  const key = workspaceKey(input.directory)
  const project = input.projects.find(
    (item) =>
      workspaceKey(item.worktree) === key || item.sandboxes?.some((sandbox) => workspaceKey(sandbox) === key),
  )
  if (project) return project.worktree

  const known = Object.entries(input.workspaceOrder).find(
    ([root, dirs]) => workspaceKey(root) === key || dirs.some((item) => workspaceKey(item) === key),
  )
  if (known) return known[0]
  if (!input.childProjectID) return input.directory
  return input.projectMeta.find((item) => item.id === input.childProjectID)?.worktree ?? input.directory
}

export const sidebarSessionRemovalTarget = (input: {
  session: Pick<Session, "directory" | "parentID">
  removed: Set<string>
  activeID?: string
  nextRootSessionID?: string
}) => {
  if (!input.activeID || !input.removed.has(input.activeID)) return
  if (input.session.parentID) {
    return {
      directory: input.session.directory,
      sessionID: input.session.parentID,
    }
  }
  if (input.nextRootSessionID) {
    return {
      directory: input.session.directory,
      sessionID: input.nextRootSessionID,
    }
  }
  return {
    directory: input.session.directory,
  }
}
