import { describe, expect, test } from "bun:test"
import path from "node:path"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { initProjectors } from "../../src/server/projectors"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

const root = path.join(__dirname, "../..")
void Log.init({ print: false })
initProjectors()

function run<A>(effect: Parameters<typeof AppRuntime.runPromise>[0]) {
  return AppRuntime.runPromise(effect as never) as Promise<A>
}

describe("session fork", () => {
  test("records the parent and preserves the requested message boundary", async () => {
    await using tmp = await tmpdir({})
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const original = await run<Session.Info>(Session.Service.use((service) => service.create()))
        const userID = MessageID.ascending()
        const assistantID = MessageID.ascending()
        await run(
          Session.Service.use((service) =>
            service.updateMessage({
              id: userID,
              sessionID: original.id,
              role: "user",
              time: { created: Date.now() },
              agent: "test",
              model: { providerID: "test", modelID: "test" },
              tools: {},
              mode: "",
            } as unknown as MessageV2.Info),
          ),
        )
        await run(
          Session.Service.use((service) =>
            service.updatePart({
              id: PartID.ascending(),
              sessionID: original.id,
              messageID: userID,
              type: "text",
              text: "before the fork",
            }),
          ),
        )
        await run(
          Session.Service.use((service) =>
            service.updateMessage({
              id: assistantID,
              sessionID: original.id,
              role: "assistant",
              parentID: userID,
              time: { created: Date.now(), completed: Date.now() },
              agent: "test",
              modelID: "test",
              providerID: "test",
              mode: "",
              path: { cwd: tmp.path, root: tmp.path },
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            } as unknown as MessageV2.Info),
          ),
        )

        const exclusive = await run<Session.Info>(
          Session.Service.use((service) => service.fork({ sessionID: original.id, messageID: userID })),
        )
        const inclusive = await run<Session.Info>(
          Session.Service.use((service) => service.fork({ sessionID: original.id, messageID: userID, includeMessage: true })),
        )
        const full = await run<Session.Info>(
          Session.Service.use((service) => service.fork({ sessionID: original.id, messageID: assistantID, includeMessage: true })),
        )

        expect((await run<Session.Info[]>(Session.Service.use((service) => service.children(original.id)))).map((item) => item.id)).toEqual([
          exclusive.id,
          inclusive.id,
          full.id,
        ])
        expect(exclusive.parentID).toBe(original.id)
        expect((await run<MessageV2.WithParts[]>(Session.Service.use((service) => service.messages({ sessionID: exclusive.id })))).map((item) => item.info.id)).toEqual([])
        expect((await run<MessageV2.WithParts[]>(Session.Service.use((service) => service.messages({ sessionID: inclusive.id })))).map((item) => item.info.role)).toEqual(["user"])

        const cloned = await run<MessageV2.WithParts[]>(Session.Service.use((service) => service.messages({ sessionID: full.id })))
        expect(cloned.map((item) => item.info.role)).toEqual(["user", "assistant"])
        expect(cloned[1]?.info.role === "assistant" ? cloned[1].info.parentID : undefined).toBe(cloned[0]?.info.id)
      },
    })
  })
})
