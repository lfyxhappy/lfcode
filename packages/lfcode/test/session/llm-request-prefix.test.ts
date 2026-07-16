import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Effect, Stream } from "effect"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { buildLLMRequestPrefix } from "../../src/session/llm-request-prefix"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"
import { ProviderTest } from "../fake/provider"
import type { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { ToolRegistry } from "../../src/tool"
import { ProviderTransform } from "../../src/provider"
import type { Interface as LLMInterface } from "../../src/session/llm"
import type { Interface as ToolRegistryInterface } from "../../src/tool/registry"
import z from "zod"
import path from "path"
import { Global } from "../../src/global"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

function makeAgent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  } satisfies Agent.Info
}

describe("buildLLMRequestPrefix", () => {
  test("reuses transformed tool schemas for identical inputs", async () => {
    const schemaSpy = spyOn(ProviderTransform, "schema")
    const model = ProviderTest.model({
      id: ModelID.make("gpt-5.2"),
      providerID: ProviderID.make("openai"),
    })
    const agent = makeAgent()
    const toolDefs = [{ id: "search", description: "search", parameters: z.object({ query: z.string() }) }]

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
        const userID = MessageID.ascending()
        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.updateMessage({
              id: userID,
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "build",
              model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
              tools: {},
            }),
          ),
        )
        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.updatePart({
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: userID,
              type: "text",
              text: "hello",
            }),
          ),
        )
        const msgs = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.messages({ sessionID: session.id })),
        )

        const fakeLLM: LLMInterface = {
          stream: () => Stream.empty,
          buildSystemArray: () => Effect.succeed([]),
        }
        const fakeToolRegistry: ToolRegistryInterface = {
          ids: () => Effect.succeed([]),
          all: () => Effect.succeed([]),
          named: () => Effect.succeed({ actor: undefined as never, read: undefined as never }),
          tools: () => Effect.succeed(toolDefs as never),
        }
        const run = () =>
          buildLLMRequestPrefix({
            sessionID: session.id,
            agent,
            model,
            msgs,
            additions: [],
          }).pipe(
            Effect.provideService(LLM.Service, fakeLLM),
            Effect.provideService(ToolRegistry.Service, fakeToolRegistry),
          )

        await AppRuntime.runPromise(run())
        await AppRuntime.runPromise(run())
      },
    })

    expect(schemaSpy).toHaveBeenCalledTimes(1)
  })

  test("two consecutive calls with identical inputs produce deep-equal output", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))

        const userID = MessageID.ascending()
        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.updateMessage({
              id: userID,
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "build",
              model: { providerID: ProviderID.make("test"), modelID: ProviderID.make("test") },
              tools: {},
              mode: "",
            } as unknown as MessageV2.Info),
          ),
        )
        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.updatePart({
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: userID,
              type: "text",
              text: "hello",
            }),
          ),
        )

        const msgs = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.messages({ sessionID: session.id })),
        )

        const model = ProviderTest.model({
          id: ModelID.make("gpt-5.2"),
          providerID: ProviderID.make("openai"),
        })
        const agent = makeAgent()

        const a = await AppRuntime.runPromise(
          buildLLMRequestPrefix({
            sessionID: session.id,
            agent,
            model,
            msgs,
            additions: [],
          }),
        )
        const b = await AppRuntime.runPromise(
          buildLLMRequestPrefix({
            sessionID: session.id,
            agent,
            model,
            msgs,
            additions: [],
          }),
        )

        expect(a.system).toEqual(b.system)
        expect(JSON.stringify(a.tools)).toEqual(JSON.stringify(b.tools))
        expect(a.inheritedMessages).toEqual(b.inheritedMessages)
      },
    })
  })

  test("injects active skill system when the last user message matches skill triggers", async () => {
    await using tmp = await tmpdir({ git: true })
    const originalConfig = Global.Path.config
    Object.assign(Global.Path, { config: tmp.path })

    try {
      await Bun.write(
        path.join(tmp.path, "skills", "archive-extract", "SKILL.md"),
        `---
name: archive-extract
description: 当用户提到解压、解开、改后缀时使用。
---

# 解压技能

按标准流程解压。
`,
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          const userID = MessageID.ascending()
          await AppRuntime.runPromise(
            SessionNs.Service.use((svc) =>
              svc.updateMessage({
                id: userID,
                sessionID: session.id,
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
              svc.updatePart({
                id: PartID.ascending(),
                sessionID: session.id,
                messageID: userID,
                type: "text",
                text: "请先帮我解压这个压缩包。",
              }),
            ),
          )

          const msgs = await AppRuntime.runPromise(
            SessionNs.Service.use((svc) => svc.messages({ sessionID: session.id })),
          )
          const model = ProviderTest.model({
            id: ModelID.make("gpt-5.2"),
            providerID: ProviderID.make("openai"),
          })
          const agent = makeAgent()
          const prefix = await AppRuntime.runPromise(
            buildLLMRequestPrefix({
              sessionID: session.id,
              agent,
              model,
              msgs,
              additions: [],
            }),
          )

          expect(prefix.system.join("\n")).toContain(`<active_skill name="archive-extract" activation="matched user trigger terms">`)
          expect(prefix.system.join("\n")).toContain("# 解压技能")
        },
      })
    } finally {
      Object.assign(Global.Path, { config: originalConfig })
    }
  })

  test("injects active skill system when a skill was manually loaded into the turn", async () => {
    await using tmp = await tmpdir({ git: true })
    const originalConfig = Global.Path.config
    Object.assign(Global.Path, { config: tmp.path })

    try {
      await Bun.write(
        path.join(tmp.path, "skills", "archive-extract", "SKILL.md"),
        `---
name: archive-extract
description: 当用户提到解压时使用。
---

# 解压技能

按标准流程解压。
`,
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({})))
          const userID = MessageID.ascending()
          await AppRuntime.runPromise(
            SessionNs.Service.use((svc) =>
              svc.updateMessage({
                id: userID,
                sessionID: session.id,
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
              svc.updatePart({
                id: PartID.ascending(),
                sessionID: session.id,
                messageID: userID,
                type: "text",
                text: "/archive-extract 解压这个目录",
              }),
            ),
          )
          await AppRuntime.runPromise(
            SessionNs.Service.use((svc) =>
              svc.updatePart({
                id: PartID.ascending(),
                sessionID: session.id,
                messageID: userID,
                type: "text",
                text: `<skill_content name="archive-extract">\n# 解压技能\n按标准流程解压。\n</skill_content>`,
                synthetic: true,
              }),
            ),
          )

          const msgs = await AppRuntime.runPromise(
            SessionNs.Service.use((svc) => svc.messages({ sessionID: session.id })),
          )
          const model = ProviderTest.model({
            id: ModelID.make("gpt-5.2"),
            providerID: ProviderID.make("openai"),
          })
          const agent = makeAgent()
          const prefix = await AppRuntime.runPromise(
            buildLLMRequestPrefix({
              sessionID: session.id,
              agent,
              model,
              msgs,
              additions: [],
            }),
          )

          expect(prefix.system.join("\n")).toContain(`<active_skill name="archive-extract" activation="matched user trigger terms, explicitly loaded">`)
          expect(prefix.system.join("\n")).toContain("Treat every active skill as executable instructions")
        },
      })
    } finally {
      Object.assign(Global.Path, { config: originalConfig })
    }
  })
})
