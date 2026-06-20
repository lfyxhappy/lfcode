import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Session as SessionNs } from "../../src/session"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  list(input?: Parameters<typeof SessionNs.list>[0]) {
    return [...SessionNs.list(input)]
  },
}

const wintest = process.platform === "win32" ? test : test.skip

afterEach(async () => {
  await Instance.disposeAll()
})

describe("session.list", () => {
  test("filters by directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await svc.create({})

        await using other = await tmpdir({ git: true })
        const second = await Instance.provide({
          directory: other.path,
          fn: async () => svc.create({}),
        })

        const sessions = [...svc.list({ directory: tmp.path })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  wintest("matches historical project ids for the same Windows directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const current = await svc.create({ title: "current-project-session" })
        const historical = await svc.create({ title: "historical-project-session" })
        const oldProject = ProjectID.make(`proj_alias_${crypto.randomUUID()}`)

        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: oldProject,
              worktree: tmp.path,
              time_created: Date.now(),
              time_updated: Date.now(),
              sandboxes: [],
            })
            .run()
          db.update(SessionTable)
            .set({
              project_id: oldProject,
              directory: tmp.path.replaceAll("\\", "/"),
            })
            .where(eq(SessionTable.id, historical.id))
            .run()
        })

        const ids = [...svc.list({ directory: tmp.path, roots: true })].map((s) => s.id)

        expect(ids).toContain(current.id)
        expect(ids).toContain(historical.id)
      },
    })
  })

  wintest("matches directory aliases across slash styles", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const alternate = tmp.path.replaceAll("\\", "/")
        const first = await svc.create({ title: "native-path-session" })
        const second = await svc.create({ title: "alternate-path-session" })

        Database.use((db) =>
          db
            .update(SessionTable)
            .set({ directory: alternate })
            .where(eq(SessionTable.id, second.id))
            .run(),
        )

        const nativeIds = [...svc.list({ directory: tmp.path })].map((s) => s.id)
        const alternateIds = [...svc.list({ directory: alternate })].map((s) => s.id)

        expect(nativeIds).toContain(first.id)
        expect(nativeIds).toContain(second.id)
        expect(alternateIds).toContain(first.id)
        expect(alternateIds).toContain(second.id)
      },
    })
  })

  test("filters root sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await svc.create({ title: "root-session" })
        const child = await svc.create({ title: "child-session", parentID: root.id })

        const sessions = [...svc.list({ roots: true })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = [...svc.list({ start: futureStart })]
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "unique-search-term-abc" })
        await svc.create({ title: "other-session-xyz" })

        const sessions = [...svc.list({ search: "unique-search" })]
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "session-1" })
        await svc.create({ title: "session-2" })
        await svc.create({ title: "session-3" })

        const sessions = [...svc.list({ limit: 2 })]
        expect(sessions.length).toBe(2)
      },
    })
  })
})
