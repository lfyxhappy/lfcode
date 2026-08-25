import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { initProjectors } from "../../src/server/projectors"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

const root = path.join(__dirname, "../..")
void Log.init({ print: false })
initProjectors()

function run<A>(effect: Parameters<typeof AppRuntime.runPromise>[0]) {
  return AppRuntime.runPromise(effect as never) as Promise<A>
}

describe("temporary sessions", () => {
  test("persist the temporary flag, inherit it, and clean up recursively", async () => {
    await using tmp = await tmpdir({})
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const normal = await run<Session.Info>(Session.Service.use((service) => service.create()))
        const temporary = await run<Session.Info>(Session.Service.use((service) => service.create({ temporary: true })))
        const child = await run<Session.Info>(
          Session.Service.use((service) => service.create({ parentID: temporary.id })),
        )
        const fork = await run<Session.Info>(
          Session.Service.use((service) => service.fork({ sessionID: temporary.id })),
        )

        expect(normal.temporary).toBe(false)
        expect(temporary.temporary).toBe(true)
        expect(child.temporary).toBe(true)
        expect(fork.temporary).toBe(true)

        const messageID = MessageID.ascending()
        await run(
          Session.Service.use((service) =>
            service.updateMessage({
              id: messageID,
              sessionID: temporary.id,
              role: "user",
              time: { created: Date.now() },
              agent: "test",
              model: { providerID: "test", modelID: "test" },
              tools: {},
              mode: "",
            } as unknown as MessageV2.Info),
          ),
        )
        const partID = PartID.ascending()
        await run(
          Session.Service.use((service) =>
            service.updatePart({
              id: partID,
              sessionID: temporary.id,
              messageID,
              type: "text",
              text: "temporary",
            }),
          ),
        )

        const removed = await run<number>(Session.Service.use((service) => service.cleanupTemporary()))
        expect(removed).toBe(3)

        const remaining = Database.use((db) => db.select().from(SessionTable).all())
        expect(remaining.map((row) => row.id)).toEqual([normal.id])
        expect(
          Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.session_id, temporary.id)).all()),
        ).toEqual([])
        expect(
          Database.use((db) => db.select().from(PartTable).where(eq(PartTable.session_id, temporary.id)).all()),
        ).toEqual([])

        await run(Session.Service.use((service) => service.remove(normal.id)))
      },
    })
  })
})
