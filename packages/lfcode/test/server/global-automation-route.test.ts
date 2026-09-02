import { describe, expect, test } from "bun:test"
import { generateSpecs } from "hono-openapi"
import z from "zod"
import { SessionID } from "../../src/session/schema"
import { AutomationRun, AutomationTask, type AutomationTaskCreate } from "../../src/scheduled-task"
import { createGlobalAutomationRoutes, type AutomationRouteService } from "../../src/server/routes/global-automation"
import { GlobalRoutes } from "../../src/server/routes/global"

type Task = z.infer<typeof AutomationTask>
type Run = z.infer<typeof AutomationRun>

describe("global automation routes", () => {
  test("validates request bodies and identifiers", async () => {
    const app = createGlobalAutomationRoutes(fakeService())

    const malformed = await request(app, "/", { method: "POST", body: { ...createInput(), message: "", unexpected: true } })
    expect(malformed.status).toBe(400)

    const emptyPatch = await request(app, "/automation_1", { method: "PATCH", body: {} })
    expect(emptyPatch.status).toBe(400)

    const invalidID = await request(app, "/automation.invalid")
    expect(invalidID.status).toBe(400)

    const falseQuery = await request(app, "/?includeDeleted=false")
    expect(falseQuery.status).toBe(200)
  })

  test("generates create and update OpenAPI schemas", async () => {
    const spec = await generateSpecs(createGlobalAutomationRoutes(fakeService()), {
      documentation: { info: { title: "test", version: "1" }, openapi: "3.1.1" },
    })
    expect(spec.paths["/"]?.post?.requestBody).toBeDefined()
    expect(spec.paths["/{id}"]?.patch?.requestBody).toBeDefined()
    expect(JSON.stringify(spec.components?.schemas?.AutomationTaskCreate)).toContain("permissionMode")
    expect(JSON.stringify(spec.components?.schemas?.AutomationTaskPatch)).toContain("sourceSessionID")
  })

  test("creates, updates, pauses, runs, cancels, resolves, and deletes tasks", async () => {
    const service = fakeService()
    const app = createGlobalAutomationRoutes(service)

    const created = await request(app, "/", { method: "POST", body: createInput() })
    expect(created.status).toBe(200)
    const task = AutomationTask.parse(await created.json())
    expect(task.status).toBe("active")
    expect(task.target).toEqual({ kind: "global" })

    const listed = await request(app, "/")
    expect(listed.status).toBe(200)
    expect(AutomationTask.array().parse((await listed.json()).items)).toHaveLength(1)

    const updated = await request(app, `/${task.id}`, { method: "PATCH", body: { message: "Refresh the release notes" } })
    expect(updated.status).toBe(200)
    expect(AutomationTask.parse(await updated.json()).message).toBe("Refresh the release notes")

    const paused = await request(app, `/${task.id}/pause`, { method: "POST" })
    expect(paused.status).toBe(200)
    expect(AutomationTask.parse(await paused.json()).status).toBe("paused")

    const resumed = await request(app, `/${task.id}/resume`, { method: "POST" })
    expect(resumed.status).toBe(200)
    expect(AutomationTask.parse(await resumed.json()).status).toBe("active")

    const run = await request(app, `/${task.id}/run`, { method: "POST" })
    expect(run.status).toBe(200)
    const queued = AutomationRun.parse(await run.json())
    expect(queued.status).toBe("queued")

    const history = await request(app, `/${task.id}/runs`)
    expect(history.status).toBe(200)
    expect(AutomationRun.array().parse((await history.json()).items)).toHaveLength(1)

    const cancelled = await request(app, `/${task.id}/runs/${queued.id}/cancel`, { method: "POST" })
    expect(cancelled.status).toBe(200)
    expect(AutomationRun.parse(await cancelled.json()).status).toBe("cancelled")

    const sessionID = SessionID.descending()
    service.attachSession(queued.id, sessionID)
    const resolution = await request(app, `/session/${sessionID}`)
    expect(resolution.status).toBe(200)
    const resolved = await resolution.json()
    expect(AutomationTask.parse(resolved.task).id).toBe(task.id)
    expect(resolved.directory).toBe("/automation")

    const deleted = await request(app, `/${task.id}`, { method: "DELETE" })
    expect(deleted.status).toBe(200)
    expect(AutomationTask.parse(await deleted.json()).status).toBe("deleted")
    expect(AutomationTask.array().parse((await (await request(app, "/")).json()).items)).toHaveLength(0)

    const deletedHistory = await request(app, `/${task.id}/runs`)
    expect(deletedHistory.status).toBe(200)
    expect(AutomationRun.array().parse((await deletedHistory.json()).items)).toHaveLength(1)
  })

  test("includes the latest run from one batch lookup", async () => {
    const service = fakeService()
    const app = createGlobalAutomationRoutes(service)
    const created = await request(app, "/", { method: "POST", body: createInput() })
    const task = AutomationTask.parse(await created.json())
    const queued = await request(app, `/${task.id}/run`, { method: "POST" })
    const run = AutomationRun.parse(await queued.json())

    const listed = await request(app, "/")
    const item = (await listed.json()).items[0]
    expect(item.latestRun.id).toBe(run.id)
    expect(AutomationTask.parse(item).latestRun?.id).toBe(run.id)
    expect(service.latestRunCalls()).toBe(1)
  })

  test("blocks the automation surface outside the local desktop server", async () => {
    const previousClient = process.env.LFCODE_CLIENT
    const previousWorkspace = process.env.LFCODE_WORKSPACE_ID
    process.env.LFCODE_CLIENT = "cli"
    delete process.env.LFCODE_WORKSPACE_ID
    try {
      const response = await GlobalRoutes().request("/automation/")
      expect(response.status).toBe(403)
    } finally {
      if (previousClient === undefined) delete process.env.LFCODE_CLIENT
      else process.env.LFCODE_CLIENT = previousClient
      if (previousWorkspace === undefined) delete process.env.LFCODE_WORKSPACE_ID
      else process.env.LFCODE_WORKSPACE_ID = previousWorkspace
    }
  })
})

function createInput(): AutomationTaskCreate {
  return {
    name: "Morning project review",
    schedule: { kind: "daily", hour: 9, minute: 0 },
    target: { kind: "global" },
    message: "Review the outstanding project changes.",
    agent: "main",
    model: { providerID: "openai", modelID: "gpt-5" },
    permissionMode: "full",
    timezone: "Asia/Shanghai",
    enabled: true,
    notifications: "all",
  }
}

function fakeService() {
  const tasks = new Map<string, Task>()
  const runs = new Map<string, Run>()
  let nextTask = 1
  let nextRun = 1
  let latestRunLookups = 0
  let settings = { concurrency: 4 }

  const service: AutomationRouteService & { attachSession(runID: string, sessionID: string): void; latestRunCalls(): number } = {
    getSettings() {
      return settings
    },
    updateSettings(input) {
      settings = { concurrency: input.concurrency }
      return settings
    },
    list(input) {
      return [...tasks.values()].filter((task) => input?.includeDeleted || task.status !== "deleted")
    },
    listLatestRuns(taskIDs) {
      latestRunLookups++
      const wanted = new Set(taskIDs)
      const latest = new Map<string, Run>()
      for (const run of runs.values()) {
        if (!wanted.has(run.taskID)) continue
        const current = latest.get(run.taskID)
        if (!current || run.createdAt > current.createdAt || (run.createdAt === current.createdAt && run.id > current.id)) latest.set(run.taskID, run)
      }
      return [...latest.values()]
    },
    create(input) {
      const now = Date.now()
      const task = AutomationTask.parse({
        ...input,
        id: `automation_${nextTask++}`,
        name: input.name ?? "Untitled automation",
        status: input.enabled ? "active" : "paused",
        nextRunAt: now + 60_000,
        createdAt: now,
        updatedAt: now,
      })
      tasks.set(task.id, task)
      return task
    },
    get(id, input) {
      const task = tasks.get(id)
      if (task?.status === "deleted" && !input?.includeDeleted) return undefined
      return task
    },
    update(id, input) {
      const current = tasks.get(id)
      if (!current) return
      const task = AutomationTask.parse({ ...current, ...input, updatedAt: Date.now() })
      tasks.set(id, task)
      return task
    },
    remove(id) {
      const current = tasks.get(id)
      if (!current) return
      const task = AutomationTask.parse({ ...current, enabled: false, status: "deleted", deletedAt: Date.now(), updatedAt: Date.now() })
      tasks.set(id, task)
      return task
    },
    pause(id) {
      const current = tasks.get(id)
      if (!current) return
      const task = AutomationTask.parse({ ...current, enabled: false, status: "paused", updatedAt: Date.now() })
      tasks.set(id, task)
      return task
    },
    resume(id) {
      const current = tasks.get(id)
      if (!current) return
      const task = AutomationTask.parse({ ...current, enabled: true, status: "active", nextRunAt: Date.now() + 60_000, updatedAt: Date.now() })
      tasks.set(id, task)
      return task
    },
    runNow(id) {
      if (!tasks.has(id)) return
      const now = Date.now()
      const run = AutomationRun.parse({
        id: `automation_run_${nextRun++}`,
        taskID: id,
        status: "queued",
        trigger: "manual",
        scheduledFor: now,
        late: false,
        attempt: 1,
        createdAt: now,
        updatedAt: now,
      })
      runs.set(run.id, run)
      return run
    },
    listRuns(id) {
      return [...runs.values()].filter((run) => run.taskID === id)
    },
    cancelRun(id, runID) {
      const current = runs.get(runID)
      if (!current || current.taskID !== id) return
      const run = AutomationRun.parse({ ...current, status: "cancelled", finishedAt: Date.now(), updatedAt: Date.now() })
      runs.set(runID, run)
      return run
    },
    resolveSession(sessionID) {
      const run = [...runs.values()].find((item) => item.sessionID === sessionID)
      if (!run) return
      const task = tasks.get(run.taskID)
      if (!task) return
      return { task, run, directory: "/automation" }
    },
    attachSession(runID, sessionID) {
      const current = runs.get(runID)
      if (!current) throw new Error(`Unknown run: ${runID}`)
      runs.set(runID, AutomationRun.parse({ ...current, sessionID, updatedAt: Date.now() }))
    },
    latestRunCalls() {
      return latestRunLookups
    },
  }
  return service
}

function request(app: ReturnType<typeof createGlobalAutomationRoutes>, input: string, init?: { method?: string; body?: unknown }) {
  return app.request(input, {
    method: init?.method,
    headers: { "content-type": "application/json" },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
}
