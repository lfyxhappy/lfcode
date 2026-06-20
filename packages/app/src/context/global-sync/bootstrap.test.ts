import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import { bootstrapDirectory } from "./bootstrap"

const directory = "C:/repo/project"

const baseState = () =>
  ({
    status: "loading",
    agent: [],
    command: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: false,
    provider: { all: [], connected: [], default: {} },
    config: {},
    path: { state: "", config: "", worktree: "", directory: "", home: "" },
    session: [],
    sessionTotal: 0,
    session_status: {},
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
  }) as State

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
          list: () => Promise.resolve({ data: [] }),
        },
        question: {
          list: () => Promise.resolve({ data: [] }),
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
      vcsCache: {
        store: { value: undefined },
        setStore() {},
        ready: () => true,
      } as any,
      loadSessions: () => Promise.resolve(),
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
  })
})
