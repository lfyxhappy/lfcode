import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import { bootstrapDirectory } from "./bootstrap"

const directory = "C:/repo/project"

const baseState = (input: Partial<State> = {}) =>
  ({
    status: "loading",
    agent: [],
    command: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: false,
    command_ready: false,
    permission_ready: false,
    permission_error: false,
    provider: { all: [], connected: [], default: {} },
    config: {},
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_goal: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: false,
    mcp: {},
    lsp_ready: false,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    messageByAgent: {},
    actor: {},
    part: {},
    ...input,
  }) as State

const permissionRequest = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    permission: id,
    patterns: ["*"],
    metadata: {},
    always: [],
  }) as State["permission"][string][number]

const questionRequest = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    questions: [
      {
        question: id,
        header: id,
        options: [{ label: id, description: id }],
      },
    ],
  }) as State["question"][string][number]

async function waitFor(check: () => boolean, timeoutMs = 1500) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Timed out waiting for condition")
}

describe("bootstrapDirectory", () => {
  test("completes directory bootstrap without requesting MCP status", async () => {
    const [store, setStore] = createStore(baseState())
    let mcpCalls = 0
    let loadSessionsCalls = 0
    const snapshots: string[] = []

    await bootstrapDirectory({
      directory,
      sdk: {
        config: {
          get: () => Promise.resolve({ data: {} }),
        },
        session: {
          status: () => Promise.resolve({ data: {} }),
        },
        project: {
          current: () => Promise.resolve({ data: { id: "project-id" } }),
        },
        path: {
          get: () =>
            Promise.resolve({
              data: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
            }),
        },
        vcs: {
          get: () => Promise.resolve({ data: undefined }),
        },
        command: {
          list: () => Promise.resolve({ data: [] }),
        },
        permission: {
          list: () => new Promise(() => {}),
        },
        question: {
          list: () => new Promise(() => {}),
        },
        mcp: {
          status: () => {
            mcpCalls += 1
            return Promise.reject(new Error("mcp.status should not be called during bootstrap"))
          },
        },
        provider: {
          list: () => Promise.resolve({ data: { all: [], connected: [], default: {} } }),
        },
        app: {
          agents: () => Promise.resolve({ data: [] }),
        },
      } as any,
      store,
      setStore,
      onSessionStatusSnapshot(nextDirectory) {
        snapshots.push(nextDirectory)
      },
      vcsCache: {
        store: { value: undefined },
        setStore() {},
        ready: () => true,
      } as any,
      loadSessions: () => {
        loadSessionsCalls += 1
        return Promise.resolve()
      },
      loadCommands: () => Promise.resolve(),
      translate: (key) => key,
      global: {
        config: {},
        path: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
        project: [
          {
            id: "project-id",
            worktree: directory,
            time: { created: 0, updated: 0 },
            sandboxes: [],
          },
        ],
        provider: { all: [], connected: [], default: {} },
      },
      queryClient: new QueryClient(),
    })

    await waitFor(() => store.status === "complete")

    expect(store.status).toBe("complete")
    expect(store.mcp_ready).toBe(false)
    expect(mcpCalls).toBe(0)
    expect(loadSessionsCalls).toBe(1)
    expect(snapshots).toEqual([directory])
  })

  test("marks bootstrap complete before deferred directory work resolves", async () => {
    const [store, setStore] = createStore(baseState())
    let loadSessionsCalls = 0

    await bootstrapDirectory({
      directory,
      sdk: {
        config: {
          get: () => new Promise(() => {}),
        },
        session: {
          status: () => Promise.resolve({ data: {} }),
        },
        project: {
          current: () => Promise.resolve({ data: { id: "project-id" } }),
        },
        path: {
          get: () =>
            Promise.resolve({
              data: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
            }),
        },
        vcs: {
          get: () => new Promise(() => {}),
        },
        command: {
          list: () => new Promise(() => {}),
        },
        permission: {
          list: () => new Promise(() => {}),
        },
        question: {
          list: () => new Promise(() => {}),
        },
        provider: {
          list: () => new Promise(() => {}),
        },
        app: {
          agents: () => new Promise(() => {}),
        },
      } as any,
      store,
      setStore,
      vcsCache: {
        store: { value: undefined },
        setStore() {},
        ready: () => true,
      } as any,
      loadSessions: () => {
        loadSessionsCalls += 1
        return Promise.resolve()
      },
      loadCommands: () => Promise.resolve(),
      translate: (key) => key,
      global: {
        config: {},
        path: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
        project: [
          {
            id: "project-id",
            worktree: directory,
            time: { created: 0, updated: 0 },
            sandboxes: [],
          },
        ],
        provider: { all: [], connected: [], default: {} },
      },
      queryClient: new QueryClient(),
    })

    await waitFor(() => store.status === "complete")

    expect(store.status).toBe("complete")
    expect(loadSessionsCalls).toBe(1)
  })

  test("keeps the bootstrap promise pending through critical directory work", async () => {
    const [store, setStore] = createStore(baseState())
    let loadSessionsCalls = 0
    let releaseSessions: (() => void) | undefined
    const sessions = new Promise<void>((resolve) => {
      releaseSessions = resolve
    })
    let settled = false

    const bootstrap = bootstrapDirectory({
      directory,
      sdk: {
        config: { get: () => Promise.resolve({ data: {} }) },
        session: { status: () => Promise.resolve({ data: {} }) },
        project: { current: () => Promise.resolve({ data: { id: "project-id" } }) },
        path: {
          get: () =>
            Promise.resolve({
              data: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
            }),
        },
        vcs: { get: () => Promise.resolve({ data: undefined }) },
        command: { list: () => Promise.resolve({ data: [] }) },
        permission: { list: () => Promise.resolve({ data: [] }) },
        question: { list: () => Promise.resolve({ data: [] }) },
        provider: { list: () => Promise.resolve({ data: { all: [], connected: [], default: {} } }) },
        app: { agents: () => Promise.resolve({ data: [] }) },
      } as any,
      store,
      setStore,
      vcsCache: { store: { value: undefined }, setStore() {}, ready: () => true } as any,
      loadSessions: () => {
        loadSessionsCalls += 1
        return sessions
      },
      loadCommands: () => Promise.resolve(),
      translate: (key) => key,
      global: {
        config: {},
        path: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
        project: [{ id: "project-id", worktree: directory, time: { created: 0, updated: 0 }, sandboxes: [] }],
        provider: { all: [], connected: [], default: {} },
      },
      queryClient: new QueryClient(),
    })

    void bootstrap.then(() => {
      settled = true
    })

    await waitFor(() => loadSessionsCalls === 1)
    expect(settled).toBe(false)
    expect(store.status).toBe("partial")

    releaseSessions?.()
    await bootstrap

    expect(settled).toBe(true)
    expect(store.status).toBe("complete")
  })

  test("defers VCS and commands until the idle phase", async () => {
    const [store, setStore] = createStore(baseState())
    let vcsCalls = 0
    let commandLoads = 0

    await bootstrapDirectory({
      directory,
      sdk: {
        config: { get: () => Promise.resolve({ data: {} }) },
        session: { status: () => Promise.resolve({ data: {} }) },
        project: { current: () => Promise.resolve({ data: { id: "project-id" } }) },
        path: { get: () => Promise.resolve({ data: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" } }) },
        vcs: {
          get: () => {
            vcsCalls += 1
            return Promise.resolve({ data: { branch: "main", default_branch: "main" } })
          },
        },
        command: { list: () => Promise.resolve({ data: [] }) },
        permission: { list: () => Promise.resolve({ data: [] }) },
        question: { list: () => Promise.resolve({ data: [] }) },
        provider: { list: () => Promise.resolve({ data: { all: [], connected: [], default: {} } }) },
        app: { agents: () => Promise.resolve({ data: [] }) },
      } as any,
      store,
      setStore,
      vcsCache: { store: { value: undefined }, setStore() {}, ready: () => true } as any,
      loadSessions: () => Promise.resolve(),
      loadCommands: () => {
        commandLoads += 1
        setStore("command_ready", true)
        return Promise.resolve()
      },
      translate: (key) => key,
      global: {
        config: {},
        path: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
        project: [{ id: "project-id", worktree: directory, time: { created: 0, updated: 0 }, sandboxes: [] }],
        provider: { all: [], connected: [], default: {} },
      },
      queryClient: new QueryClient(),
    })

    await waitFor(() => store.status === "complete")
    expect(vcsCalls).toBe(0)
    expect(commandLoads).toBe(0)
    expect(store.command_ready).toBe(false)

    await waitFor(() => store.command_ready)
    expect(vcsCalls).toBe(1)
    expect(commandLoads).toBe(1)
    expect(store.vcs?.branch).toBe("main")
  })

  test("keeps live question and permission requests when bootstrap snapshots are stale", async () => {
    const sessionID = "ses_live"
    const [store, setStore] = createStore(
      baseState({
        permission: { [sessionID]: [permissionRequest("perm_live", sessionID)] },
        question: { [sessionID]: [questionRequest("que_live", sessionID)] },
      }),
    )

    await bootstrapDirectory({
      directory,
      sdk: {
        config: {
          get: () => Promise.resolve({ data: {} }),
        },
        session: {
          status: () => Promise.resolve({ data: {} }),
          get: () =>
            Promise.resolve({
              data: {
                id: sessionID,
                time: { created: 0, updated: 0 },
              },
            }),
        },
        project: {
          current: () => Promise.resolve({ data: { id: "project-id" } }),
        },
        path: {
          get: () =>
            Promise.resolve({
              data: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
            }),
        },
        vcs: {
          get: () => Promise.resolve({ data: undefined }),
        },
        command: {
          list: () => Promise.resolve({ data: [] }),
        },
        permission: {
          list: () => Promise.resolve({ data: [] }),
        },
        question: {
          list: () => Promise.resolve({ data: [] }),
        },
        provider: {
          list: () => Promise.resolve({ data: { all: [], connected: [], default: {} } }),
        },
        app: {
          agents: () => Promise.resolve({ data: [] }),
        },
      } as any,
      store,
      setStore,
      vcsCache: {
        store: { value: undefined },
        setStore() {},
        ready: () => true,
      } as any,
      loadSessions: () => Promise.resolve(),
      loadCommands: () => Promise.resolve(),
      translate: (key) => key,
      global: {
        config: {},
        path: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
        project: [
          {
            id: "project-id",
            worktree: directory,
            time: { created: 0, updated: 0 },
            sandboxes: [],
          },
        ],
        provider: { all: [], connected: [], default: {} },
      },
      queryClient: new QueryClient(),
    })

    await waitFor(() => store.status === "complete")
    await waitFor(() => store.provider_ready === true)
    await waitFor(() => store.permission_ready === true)

    expect(store.permission[sessionID]?.map((item) => item.id)).toEqual(["perm_live"])
    expect(store.question[sessionID]?.map((item) => item.id)).toEqual(["que_live"])
    expect(store.permission_error).toBe(false)
  })

  test("reconciles resolved permission and question requests after a reconnect snapshot", async () => {
    const sessionID = "ses_resolved"
    const [store, setStore] = createStore(
      baseState({
        permission: { [sessionID]: [permissionRequest("perm_resolved", sessionID)] },
        question: { [sessionID]: [questionRequest("que_resolved", sessionID)] },
      }),
    )

    await bootstrapDirectory({
      directory,
      sdk: {
        config: { get: () => Promise.resolve({ data: {} }) },
        session: { status: () => Promise.resolve({ data: {} }) },
        project: { current: () => Promise.resolve({ data: { id: "project-id" } }) },
        path: { get: () => Promise.resolve({ data: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" } }) },
        vcs: { get: () => Promise.resolve({ data: undefined }) },
        command: { list: () => Promise.resolve({ data: [] }) },
        permission: { list: () => Promise.resolve({ data: [] }) },
        question: { list: () => Promise.resolve({ data: [] }) },
        provider: { list: () => Promise.resolve({ data: { all: [], connected: [], default: {} } }) },
        app: { agents: () => Promise.resolve({ data: [] }) },
      } as any,
      store,
      setStore,
      reconcilePendingRequests: true,
      pendingRequestVersion: () => 0,
      vcsCache: { store: { value: undefined }, setStore() {}, ready: () => true } as any,
      loadSessions: () => Promise.resolve(),
      loadCommands: () => Promise.resolve(),
      translate: (key) => key,
      global: {
        config: {},
        path: { state: "", config: "", worktree: directory, directory, home: "C:/Users/test" },
        project: [{ id: "project-id", worktree: directory, time: { created: 0, updated: 0 }, sandboxes: [] }],
        provider: { all: [], connected: [], default: {} },
      },
      queryClient: new QueryClient(),
    })

    await waitFor(() => store.provider_ready === true)
    await waitFor(() => store.permission_ready === true)

    expect(store.permission).toEqual({})
    expect(store.question).toEqual({})
    expect(store.permission_error).toBe(false)
  })
})
