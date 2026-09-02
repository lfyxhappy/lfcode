import { describe, expect, test } from "bun:test"
import {
  actorDispatches,
  actorDispatchesFromActivities,
  agentManageResponse,
  agentPresetContextFromSubagent,
  subagentContextFromAgentPreset,
  subagentApiUrl,
} from "./subagent-api"

describe("subagent API adapters", () => {
  test("normalizes managed roles from the route payload", () => {
    expect(
      agentManageResponse({
        items: [
          {
            id: "reviewer",
            native: { scope: "native" },
            isNative: true,
            config: { hidden: false, default_execution: "background" },
          },
        ],
      }),
    ).toEqual({
      items: [
        {
          id: "reviewer",
          native: true,
          config: { hidden: false, default_execution: "background" },
          origins: [],
        },
      ],
    })
  })

  test("preserves the per-scope inheritance chain for role settings", () => {
    expect(
      agentManageResponse({
        items: [
          {
            id: "reviewer",
            isNative: true,
            config: { mode: "subagent" },
            native: { scope: "native", config: { mode: "subagent", hidden: false }, prompt: "native" },
            global: { scope: "global", path: "C:/data/agent/reviewer.md", config: { hidden: true }, prompt: "global" },
            project: { scope: "project", path: "C:/project/.lfcode/agent/reviewer.md", config: { disable: true }, prompt: "project" },
            effective: { name: "reviewer", config: { disable: true }, prompt: "project" },
            sources: [
              { scope: "native" },
              { scope: "global", path: "C:/data/agent/reviewer.md" },
              { scope: "project", path: "C:/project/.lfcode/agent/reviewer.md" },
            ],
            editable: { global: true, project: true, delete: true },
          },
        ],
      }),
    ).toEqual({
      items: [
        {
          id: "reviewer",
          native: true,
          config: { mode: "subagent" },
          origins: [],
          nativeLayer: { scope: "native", config: { mode: "subagent", hidden: false }, prompt: "native" },
          global: { scope: "global", path: "C:/data/agent/reviewer.md", config: { hidden: true }, prompt: "global" },
          project: { scope: "project", path: "C:/project/.lfcode/agent/reviewer.md", config: { disable: true }, prompt: "project" },
          effective: { name: "reviewer", config: { disable: true }, prompt: "project" },
          sources: [
            { scope: "native" },
            { scope: "global", path: "C:/data/agent/reviewer.md" },
            { scope: "project", path: "C:/project/.lfcode/agent/reviewer.md" },
          ],
          editable: { global: true, project: true, delete: true },
        },
      ],
    })
  })

  test("reads dispatch records and preserves conflict-relevant files", () => {
    expect(
      actorDispatches([
        {
          id: "dispatch-1",
          sessionID: "session-1",
          actorID: "actor-1",
          agent: "implementer",
          description: "Update the API",
          status: "queued",
          execution: "background",
          context: "state",
          unread: false,
          queuePosition: 2,
          declaredFiles: ["src/api.ts"],
          actualFiles: ["src/api.test.ts"],
          conflicts: ["dispatch-2"],
          time: { created: 42 },
        },
      ]),
    ).toEqual([
      {
        id: "dispatch-1",
        sessionID: "session-1",
        actorID: "actor-1",
        agent: "implementer",
        description: "Update the API",
        status: "queued",
        execution: "background",
        context: "state",
        unread: false,
        queuePosition: 2,
        declaredFiles: ["src/api.ts"],
        actualFiles: ["src/api.test.ts"],
        conflicts: ["dispatch-2"],
        createdAt: 42,
      },
    ])
  })

  test("keeps the workspace and action parameters when building route URLs", () => {
    const url = new URL(
      subagentApiUrl(
        { base: "http://127.0.0.1:4096", directory: "C:/work/project" },
        "/actor-dispatch/dispatch-1/cancel",
        { sessionID: "session-1" },
      )!,
    )

    expect(url.pathname).toBe("/actor-dispatch/dispatch-1/cancel")
    expect(url.searchParams.get("directory")).toBe("C:/work/project")
    expect(url.searchParams.get("sessionID")).toBe("session-1")
  })

  test("maps activity metadata dispatch without polling the dispatch route", () => {
    expect(
      actorDispatchesFromActivities([
        {
          id: "activity-1",
          sessionID: "session-1",
          kind: "actor-dispatch",
          status: "running",
          createdAt: 42,
          metadata: {
            dispatch: {
              id: "dispatch-1",
              agent: "implementer",
              description: "Update the API",
              status: "queued",
              actorID: "actor-1",
            },
          },
        },
      ]),
    ).toMatchObject([
      {
        id: "activity-1",
        sessionID: "session-1",
        actorID: "actor-1",
        agent: "implementer",
        description: "Update the API",
        status: "running",
      },
    ])
  })

  test("renders a minimum dispatch state when metadata is unavailable", () => {
    expect(
      actorDispatchesFromActivities([
        {
          id: "activity-2",
          sessionID: "session-1",
          kind: "subagent",
          status: "completed",
          title: "Review changes",
          createdAt: 10,
        },
      ]),
    ).toMatchObject([
      {
        id: "activity-2",
        agent: "subagent",
        description: "Review changes",
        status: "completed",
      },
    ])
  })

  test("maps persisted role contexts to dispatch contexts without widening them", () => {
    expect(subagentContextFromAgentPreset("minimal")).toBe("state")
    expect(subagentContextFromAgentPreset("full")).toBe("full")
    expect(subagentContextFromAgentPreset("task")).toBe("none")
    expect(agentPresetContextFromSubagent("state")).toBe("minimal")
    expect(agentPresetContextFromSubagent("full")).toBe("full")
    expect(agentPresetContextFromSubagent("none")).toBe("task")
  })
})
