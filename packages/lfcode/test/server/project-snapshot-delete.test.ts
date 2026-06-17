import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Snapshot } from "../../src/snapshot"
import { Filesystem, Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { provideInstance, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

async function withoutWatcher<T>(fn: () => Promise<T>) {
  if (process.platform !== "win32") return fn()
  const prev = process.env.LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
  process.env.LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
    else process.env.LFCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = prev
  }
}

describe("project snapshot delete endpoint", () => {
  test("removes stored snapshots for the current project id", async () => {
    await withoutWatcher(async () => {
      await using tmp = await tmpdir({ git: true })
      const app = Server.Default().app

      try {
        const current = await app.request("/project/current", {
          headers: {
            "x-lfcode-directory": tmp.path,
          },
        })
        expect(current.status).toBe(200)

        const project = (await current.json()) as { id: string }
        await Effect.runPromise(
          Snapshot.Service.use((svc) => svc.track()).pipe(
            provideInstance(tmp.path),
            Effect.provide(Snapshot.defaultLayer),
          ),
        )

        const snapshotDir = path.join(Global.Path.data, "snapshot", project.id)
        expect(await Filesystem.exists(snapshotDir)).toBe(true)

        const response = await app.request(`/project/${project.id}/snapshot`, {
          method: "DELETE",
          headers: {
            "x-lfcode-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        expect(await Filesystem.exists(snapshotDir)).toBe(false)
      } finally {
        await Instance.disposeAll()
      }
    })
  })
})
