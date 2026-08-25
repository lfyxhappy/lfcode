import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Global } from "../../src/global"
import { ProviderTest } from "../fake/provider"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import {
  buildLLMRequestPrefix,
  buildSkillCatalogSystem,
  estimateCatalogTokens,
  SKILL_CATALOG_DEFAULT_TOKENS,
  SKILL_CATALOG_MAX_CHARS,
  skillCatalogTokenBudget,
} from "../../src/session/llm-request-prefix"
import { Skill } from "../../src/skill"

afterEach(async () => {
  await Instance.disposeAll()
})

function makeAgent(permission: Agent.Info["permission"] = [{ permission: "*", pattern: "*", action: "allow" }]) {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission,
  } satisfies Agent.Info
}

async function createUserMessage(sessionID: SessionID, text: string) {
  const userID = MessageID.ascending()
  await AppRuntime.runPromise(
    SessionNs.Service.use((svc) =>
      svc.updateMessage({
        id: userID,
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
        tools: {},
        mode: "",
      } as unknown as MessageV2.Info),
    ),
  )
  await AppRuntime.runPromise(
    SessionNs.Service.use((svc) =>
      svc.updatePart({ id: PartID.ascending(), sessionID, messageID: userID, type: "text", text }),
    ),
  )
}

async function buildPrefix(sessionID: SessionID, agent = makeAgent()) {
  const msgs = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.messages({ sessionID })))
  return AppRuntime.runPromise(
    buildLLMRequestPrefix({
      sessionID,
      agent,
      model: ProviderTest.model({ id: ModelID.make("gpt-5.2"), providerID: ProviderID.make("openai") }),
      msgs,
      additions: [],
    }),
  )
}

describe("buildLLMRequestPrefix", () => {
  test("injects the complete standard Skill catalog without preloading a matching Skill body", async () => {
    await using tmp = await tmpdir({ git: true })
    const originalHome = Object.getOwnPropertyDescriptor(Global.Path, "home")
    Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })

    try {
      await Bun.write(
        path.join(tmp.path, ".lfcode", "skills", "archive-extract", "SKILL.md"),
        "---\nname: archive-extract\ndescription: 处理归档。用户提到解压或拍平时使用。\n---\n\n# Archive Extract\n\n按标准流程解压。\n",
      )
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          await createUserMessage(session.id, "请帮我解压这个压缩包。")
          const prefix = await buildPrefix(session.id)
          const system = prefix.system.join("\n")

          expect(system).toContain("<available_skills>")
          expect(system).toContain("<name>archive-extract</name>")
          expect(system).toContain("处理归档。用户提到解压或拍平时使用。")
          expect(system).toContain("MUST call the skill tool with that exact name")
          expect(system).not.toContain("<active_skills>")
          expect(system).not.toContain("# Archive Extract")
        },
      })
    } finally {
      Object.defineProperty(Global.Path, "home", originalHome!)
    }
  })

  test("lists every available Skill even when more than one description relates to the request", async () => {
    await using tmp = await tmpdir({ git: true })
    const originalHome = Object.getOwnPropertyDescriptor(Global.Path, "home")
    Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })

    try {
      await Promise.all([
        Bun.write(
          path.join(tmp.path, ".lfcode", "skills", "archive-extract", "SKILL.md"),
          "---\nname: archive-extract\ndescription: 处理归档。用户提到解压时使用。\n---\n\n# Archive Extract\n",
        ),
        Bun.write(
          path.join(tmp.path, ".lfcode", "skills", "document-reader", "SKILL.md"),
          "---\nname: document-reader\ndescription: 读取文档。用户提到读取文档时使用。\n---\n\n# Document Reader\n",
        ),
      ])
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          await createUserMessage(session.id, "请先解压压缩包，再读取文档。")
          const system = (await buildPrefix(session.id)).system.join("\n")

          expect(system).toContain("<name>archive-extract</name>")
          expect(system).toContain("<name>document-reader</name>")
          expect(system).not.toContain("# Archive Extract")
          expect(system).not.toContain("# Document Reader")
        },
      })
    } finally {
      Object.defineProperty(Global.Path, "home", originalHome!)
    }
  })

  test("excludes Skills denied by the active agent permission", async () => {
    await using tmp = await tmpdir({ git: true })
    const originalHome = Object.getOwnPropertyDescriptor(Global.Path, "home")
    Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })

    try {
      await Bun.write(
        path.join(tmp.path, ".lfcode", "skills", "archive-extract", "SKILL.md"),
        "---\nname: archive-extract\ndescription: 处理归档。用户提到解压时使用。\n---\n\n# Archive Extract\n",
      )
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          await createUserMessage(session.id, "请帮我解压这个压缩包。")
          const prefix = await buildPrefix(session.id, makeAgent([{ permission: "skill", pattern: "archive-extract", action: "deny" }]))
          expect(prefix.system.join("\n")).not.toContain("archive-extract")
        },
      })
    } finally {
      Object.defineProperty(Global.Path, "home", originalHome!)
    }
  })

  test("excludes Skills denied by the effective session or temporary ruleset", async () => {
    await using tmp = await tmpdir({ git: true })
    const originalHome = Object.getOwnPropertyDescriptor(Global.Path, "home")
    Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })

    try {
      await Bun.write(
        path.join(tmp.path, ".lfcode", "skills", "archive-extract", "SKILL.md"),
        "---\nname: archive-extract\ndescription: Extract an archive safely.\n---\n\n# Archive Extract\n",
      )
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          await createUserMessage(session.id, "please extract this archive")
          const msgs = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.messages({ sessionID: session.id })))
          const prefix = await AppRuntime.runPromise(
            buildLLMRequestPrefix({
              sessionID: session.id,
              agent: makeAgent(),
              model: ProviderTest.model({ id: ModelID.make("gpt-5.2"), providerID: ProviderID.make("openai") }),
              msgs,
              additions: [],
              permission: [{ permission: "skill", pattern: "archive-extract", action: "deny" }],
            }),
          )
          expect(prefix.system.join("\n")).not.toContain("archive-extract")
        },
      })
    } finally {
      Object.defineProperty(Global.Path, "home", originalHome!)
    }
  })

  test("does not preload oversized Skill bodies into the catalog", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
        await createUserMessage(session.id, "甲乙")
        await AppRuntime.runPromise(
          Skill.Service.use((skill) =>
            skill.registerPluginSkills({
              pluginID: "active-budget-test",
              skills: Array.from({ length: 2 }, (_, index) => ({
                name: `candidate-${index + 1}`,
                description: "归档工作流。用户提到甲乙时使用。",
                location: path.join(tmp.path, `candidate-${index + 1}`, "SKILL.md"),
                content: `# Skill ${index + 1}\n${"A".repeat(40_000)}`,
              })),
            }),
          ),
        )
        const prefix = await buildPrefix(session.id)
        const system = prefix.system.join("\n")
        expect(system).toContain("<name>candidate-1</name>")
        expect(system).toContain("<name>candidate-2</name>")
        expect(system).not.toContain("<deferred_skills")
        expect(system).not.toContain("# Skill 1")
        expect(system).not.toContain("[Active Skill body truncated by the deterministic context budget.]")
      },
    })
  })

  test("keeps metadata available across user messages without carrying a Skill body", async () => {
    await using tmp = await tmpdir({ git: true })
    const originalHome = Object.getOwnPropertyDescriptor(Global.Path, "home")
    Object.defineProperty(Global.Path, "home", { configurable: true, value: tmp.path })

    try {
      await Bun.write(
        path.join(tmp.path, ".lfcode", "skills", "archive-extract", "SKILL.md"),
        "---\nname: archive-extract\ndescription: 处理归档。用户提到解压时使用。\n---\n\n# Archive Extract\n",
      )
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          await createUserMessage(session.id, "请帮我解压这个压缩包。")
          expect((await buildPrefix(session.id)).system.join("\n")).toContain("<name>archive-extract</name>")

          await createUserMessage(session.id, "谢谢，今天北京天气如何？")
          const laterSystem = (await buildPrefix(session.id)).system.join("\n")
          expect(laterSystem).toContain("<name>archive-extract</name>")
          expect(laterSystem).not.toContain("# Archive Extract")
        },
      })
    } finally {
      Object.defineProperty(Global.Path, "home", originalHome!)
    }
  })

  test("uses a token-safe CJK budget and retains an index beyond detailed entries", () => {
    const catalog = buildSkillCatalogSystem(
      Array.from({ length: 240 }, (_, index) => ({
        name: `skill-${String(index).padStart(3, "0")}`,
        description: `工作流 ${index}：${"解压".repeat(1_000)}`,
        location: `C:/skills/${index}/SKILL.md`,
        content: "# not injected",
      })),
    )
    expect(catalog).toBeDefined()
    expect(catalog!.length).toBeLessThanOrEqual(SKILL_CATALOG_MAX_CHARS)
    expect(estimateCatalogTokens(catalog!)).toBeLessThanOrEqual(SKILL_CATALOG_DEFAULT_TOKENS)
    expect(catalog).toContain('<catalog_diagnostics')
    expect(catalog).toContain('<name>skill-000</name>')
    expect(catalog).toContain("<skill_name_index>")
    expect(catalog).toContain("skill-239")
    expect(catalog).not.toContain("# not injected")
  })

  test("marks discovery as partial when even the compact name index cannot fit", () => {
    const catalog = buildSkillCatalogSystem(
      Array.from({ length: 2_000 }, (_, index) => ({
        name: `very-long-skill-name-${String(index).padStart(4, "0")}`,
        description: "A deliberately short description.",
        location: `C:/skills/${index}/SKILL.md`,
        content: "# not injected",
      })),
    )

    expect(catalog).toContain('discovery="partial"')
    expect(catalog).toContain('names_omitted="')
    expect(catalog).toContain("Do not treat this catalog as exhaustive")
    expect(catalog).not.toContain("very-long-skill-name-1999")
    expect(estimateCatalogTokens(catalog!)).toBeLessThanOrEqual(SKILL_CATALOG_DEFAULT_TOKENS)
  })

  test("scales catalog budget from the model input context rather than a fixed entry count", () => {
    expect(skillCatalogTokenBudget()).toBe(SKILL_CATALOG_DEFAULT_TOKENS)
    expect(skillCatalogTokenBudget({ limit: { context: 16_384, input: 16_384, output: 4_096 } })).toBe(768)
    expect(skillCatalogTokenBudget({ limit: { context: 200_000, input: 200_000, output: 4_096 } })).toBe(8_000)
    expect(skillCatalogTokenBudget({ limit: { context: 1_000_000, input: 1_000_000, output: 4_096 } })).toBe(8_192)
  })
})
