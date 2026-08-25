import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { chooseSearchRoute, buildBrowserSearchURL } from "../../src/research/routing"
import { defaultSourceProfile, matchSourceProfile } from "../../src/research/registry"
import { upsertResearchSettings } from "../../src/research/persistence"
import { WebSearchTool } from "../../src/tool/websearch"
import { Truncate, type Tool } from "../../src/tool"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(FetchHttpClient.layer, Truncate.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer))
const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_websearch_settings"),
  messageID: MessageID.make("msg_websearch_settings"),
  callID: "call_websearch_settings",
  agent: "general",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("V2 web research routing", () => {
  test("uses Bing discovery by default without selecting compatibility providers", () => {
    const result = chooseSearchRoute({ query: "最新版本 🚀" })
    expect(result.route).toBe("browser")
    expect(result.url).toContain("https://www.bing.com/search?q=")
    expect(result.compatProvider).toBeUndefined()
    expect(result.warnings.join(" ")).toContain("using Bing for discovery")
  })

  test("uses a known URL before discovery", () => {
    const result = chooseSearchRoute({ query: "ignored", url: "https://example.com/docs?utm_source=test" })
    expect(result.route).toBe("direct")
    expect(result.url).toBe("https://example.com/docs")
  })

  test("keeps native results when they have verifiable citations", () => {
    const result = chooseSearchRoute({
      query: "release",
      nativeAvailable: true,
      nativeResult: { sources: [{ url: "https://example.com/release", domain: "example.com", sourceTier: "discovery-only" }], warnings: [] },
    })
    expect(result.route).toBe("native")
  })

  test("falls from empty native output to browser URL without Exa/Parallel", () => {
    const result = chooseSearchRoute({
      query: "中文 查询",
      nativeAvailable: true,
      nativeResult: { sources: [], warnings: ["native search returned no verifiable URL sources"] },
      browser: { engine: "bing" },
    })
    expect(result.route).toBe("browser")
    expect(result.url).toContain("https://www.bing.com/search?q=%E4%B8%AD%E6%96%87+%E6%9F%A5%E8%AF%A2")
  })

  test("requires explicit compat provider", () => {
    expect(chooseSearchRoute({ query: "x", route: "compat" }).warnings.join(" ")).toContain("explicitly selected")
    expect(chooseSearchRoute({ query: "x", route: "compat", compatProvider: "parallel" }).compatProvider).toBe("parallel")
  })

  test("builds custom browser URLs with URL encoding", () => {
    const url = buildBrowserSearchURL({ engine: "custom", template: "https://search.example.test/find?query={query}&source=lfcode" }, "a&b 中文")
    expect(new URL(url).searchParams.get("query")).toBe("a&b 中文")
    expect(new URL(url).searchParams.get("source")).toBe("lfcode")
  })
})

describe("registered source identity", () => {
  test("does not treat docs or GitHub as official without a profile", () => {
    expect(matchSourceProfile("https://docs.example.test/guide", [])).toMatchObject({ identity: "discovery" })
    expect(matchSourceProfile("https://github.com/example/project", [])).toMatchObject({ identity: "discovery" })
  })

  test("applies official identity only for a registered profile", () => {
    const profile = {
      ...defaultSourceProfile({ projectID: "project-1", subject: "Example", domain: "example.test" }),
      id: "src-1",
      createdAt: 1,
      updatedAt: 1,
    }
    expect(matchSourceProfile("https://docs.example.test/guide", [profile])).toMatchObject({ identity: "official", evidenceStatus: "metadata_verified" })
  })

  test("requires an explicit repository binding for GitHub official identity", () => {
    const profile = {
      ...defaultSourceProfile({ projectID: "project-1", subject: "Example repo", domain: "github.com" }),
      id: "src-github",
      createdAt: 1,
      updatedAt: 1,
    }
    expect(matchSourceProfile("https://github.com/example/project/issues", [profile])).toMatchObject({ identity: "discovery" })
    expect(
      matchSourceProfile("https://github.com/example/project/issues", [
        { ...profile, officialRepository: "https://github.com/example/project" },
      ]),
    ).toMatchObject({ identity: "official" })
    expect(
      matchSourceProfile("https://github.com/example/project-copy", [
        { ...profile, officialRepository: "https://github.com/example/project" },
      ]),
    ).toMatchObject({ identity: "discovery" })
    expect(matchSourceProfile("https://github.com/example/project", [{ ...profile, officialRepository: "https://github.com/" }])).toMatchObject({
      identity: "discovery",
    })
  })
})

describe("persisted browser search routing", () => {
  it.live("uses Bing when neither project nor tool settings select an engine", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const info = yield* WebSearchTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ query: "中文 查询" }, ctx)
        expect(result.metadata).toMatchObject({ route: "browser" })
        expect(result.output).toContain("https://www.bing.com/search?q=%E4%B8%AD%E6%96%87+%E6%9F%A5%E8%AF%A2")
      }),
    ),
  )

  it.live("gives the project browser setting priority over a tool override", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        upsertResearchSettings(String(Instance.project.id), { browserSearchEngine: "baidu" })
        const info = yield* WebSearchTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ query: "中文 查询", browserEngine: "bing" }, ctx)
        expect(result.metadata).toMatchObject({ route: "browser" })
        expect(result.output).toContain("https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87+%E6%9F%A5%E8%AF%A2")
      }),
    ),
  )
})
