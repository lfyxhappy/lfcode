import { afterEach, expect, test } from "bun:test"
import path from "node:path"
import { Server } from "../../src/server/server"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const previousClient = process.env.LFCODE_CLIENT

afterEach(async () => {
  await Instance.disposeAll()
  if (previousClient === undefined) delete process.env.LFCODE_CLIENT
  else process.env.LFCODE_CLIENT = previousClient
})

test("global temporary cleanup is restricted to the desktop client", async () => {
  process.env.LFCODE_CLIENT = "cli"
  const response = await Server.Default().app.request("/global/session/temporary/cleanup", { method: "POST" })
  expect(response.status).toBe(403)
})

test("desktop cleanup route removes temporary sessions", async () => {
  process.env.LFCODE_CLIENT = "desktop"
  await using tmp = await tmpdir({})
  const created = await Instance.provide({
    directory: path.resolve(tmp.path),
    fn: () => AppRuntime.runPromise(Session.Service.use((service) => service.create({ temporary: true }))),
  })

  const response = await Server.Default().app.request("/global/session/temporary/cleanup", { method: "POST" })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ removed: 1 })

  const result = await Instance.provide({
    directory: tmp.path,
    fn: () =>
      AppRuntime.runPromise(Session.Service.use((service) => service.get(created.id))).then(
        () => "present" as const,
        () => "removed" as const,
      ),
  })
  expect(result).toBe("removed")
})
