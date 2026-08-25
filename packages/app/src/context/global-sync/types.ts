import type {
  Agent,
  CommandListResponse,
  Config,
  LspStatus,
  McpStatus,
  Message,
  Part,
  Path,
  PermissionRequest,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
  VcsInfo,
} from "@lfcode-ai/sdk/v2/client"
import type { Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"

export type ProjectMeta = {
  name?: string
  icon?: {
    override?: string
    color?: string
  }
  commands?: {
    start?: string
  }
}

export type GoalVerdict = {
  ok: boolean
  impossible?: boolean
  reason: string
  attempt: number
  error?: boolean
}

export type GoalStats = {
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: {
      read?: number
      write?: number
    }
  }
  elapsed?: number
  started?: number
  activeSince?: number
  pausedAt?: number
}

export type SessionGoal = {
  state?: {
    status?: string
    objective?: string
    condition: string
    react?: number
    blockedCount?: number
    blockedReason?: string
    time?: {
      created: number
      updated: number
    }
    stats?: GoalStats
    lastVerdict?: GoalVerdict
  }
  verdicts: {
    [messageID: string]: GoalVerdict
  }
  lastMessageID?: string
}

export type HookRunActivity = {
  hookID: string
  hookName: string
  event: string
  status: "completed" | "blocked" | "failed" | "timeout" | "skipped" | "started"
  durationMs: number
  summary: string
  timeCreated: number
}

export type State = {
  status: "loading" | "partial" | "complete"
  agent: Agent[]
  command: CommandListResponse
  project: string
  projectMeta: ProjectMeta | undefined
  icon: string | undefined
  provider_ready: boolean
  command_ready: boolean
  permission_ready: boolean
  permission_error: boolean
  provider: ProviderListResponse
  config: Config
  path: Path
  session: Session[]
  sessionTotal: number
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_goal: {
    [sessionID: string]: SessionGoal | undefined
  }
  hook_run?: {
    [sessionID: string]: HookRunActivity[] | undefined
  }
  session_diff: {
    [sessionID: string]: SnapshotFileDiff[]
  }
  todo: {
    [sessionID: string]: Todo[]
  }
  permission: {
    [sessionID: string]: PermissionRequest[]
  }
  question: {
    [sessionID: string]: QuestionRequest[]
  }
  mcp_ready: boolean
  mcp: {
    [name: string]: McpStatus
  }
  lsp_ready: boolean
  lsp: LspStatus[]
  vcs: VcsInfo | undefined
  limit: number
  message: {
    [sessionID: string]: Message[]
  }
  messageByAgent: {
    [sessionID: string]: {
      [agentID: string]: Message[]
    }
  }
  actor: {
    [sessionID: string]: {
      actorID: string
      sessionID: string
      mode: string
      status: string
      description: string
      visible?: boolean
      time: { created: number }
      agent?: string
      parentActorID?: string
    }[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export type VcsCache = {
  store: Store<{ value: VcsInfo | undefined }>
  setStore: SetStoreFunction<{ value: VcsInfo | undefined }>
  ready: Accessor<boolean>
}

export type MetaCache = {
  store: Store<{ value: ProjectMeta | undefined }>
  setStore: SetStoreFunction<{ value: ProjectMeta | undefined }>
  ready: Accessor<boolean>
}

export type IconCache = {
  store: Store<{ value: string | undefined }>
  setStore: SetStoreFunction<{ value: string | undefined }>
  ready: Accessor<boolean>
}

export type ChildOptions = {
  bootstrap?: boolean
}

export type DirState = {
  lastAccessAt: number
}

export type EvictPlan = {
  stores: string[]
  state: Map<string, DirState>
  pins: Set<string>
  max: number
  ttl: number
  now: number
}

export type DisposeCheck = {
  directory: string
  hasStore: boolean
  pinned: boolean
  booting: boolean
  loadingSessions: boolean
}

export type RootLoadArgs = {
  directory: string
  limit: number
  list: (query: { directory: string; roots: true; limit?: number }) => Promise<{ data?: Session[] }>
}

export type RootLoadResult = {
  data?: Session[]
  limit: number
  limited: boolean
}

export const MAX_DIR_STORES = 8
export const DIR_IDLE_TTL_MS = 3 * 60 * 1000
export const SESSION_RECENT_WINDOW = 2 * 60 * 60 * 1000
export const SESSION_RECENT_LIMIT = 24
