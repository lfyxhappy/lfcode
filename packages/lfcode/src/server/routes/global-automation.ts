import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import type { OpenAPIV3_1 } from "openapi-types"
import z from "zod"
import {
  AutomationRun,
  AutomationSettings,
  AutomationTask,
  AutomationTaskCreate,
  AutomationTaskUpdate,
  ScheduledTask,
} from "@/scheduled-task"
import { createScheduledTask, publishRunUpdate, wakeScheduledTaskScheduler } from "../scheduled-task-runtime"
import { SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage"
import { lazy } from "@/util/lazy"
import { errors } from "../error"

const AutomationID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/)
const RunID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/)
const QueryBoolean = z.enum(["true", "false"]).transform((value) => value === "true")
const TaskParams = z.object({ id: AutomationID }).strict()
const RunParams = z.object({ id: AutomationID, runID: RunID }).strict()
const AutomationTaskPatch = AutomationTaskUpdate.refine((value) => Object.keys(value).length > 0, "At least one field is required").meta({
  ref: "AutomationTaskPatch",
})
const AutomationTaskCreateOpenAPI = z.toJSONSchema(AutomationTaskCreate) as unknown as OpenAPIV3_1.SchemaObject
const AutomationTaskPatchOpenAPI = z.toJSONSchema(AutomationTaskPatch) as unknown as OpenAPIV3_1.SchemaObject
const AutomationSettingsOpenAPI = z.toJSONSchema(AutomationSettings) as unknown as OpenAPIV3_1.SchemaObject

const AutomationList = z.object({ items: AutomationTask.array() }).meta({ ref: "AutomationTaskList" })
const AutomationRunList = z.object({ items: AutomationRun.array() }).meta({ ref: "AutomationRunList" })
const AutomationSessionResolution = z
  .object({ task: AutomationTask, run: AutomationRun.nullable(), directory: z.string().min(1) })
  .meta({ ref: "AutomationSessionResolution" })

export type AutomationRouteService = {
  getSettings(): Promise<z.output<typeof AutomationSettings>> | z.output<typeof AutomationSettings>
  updateSettings(input: z.output<typeof AutomationSettings>): Promise<z.output<typeof AutomationSettings>> | z.output<typeof AutomationSettings>
  list(input?: { includeDeleted?: boolean }): Promise<z.output<typeof AutomationTask>[]> | z.output<typeof AutomationTask>[]
  create(input: z.output<typeof AutomationTaskCreate>): Promise<z.output<typeof AutomationTask>> | z.output<typeof AutomationTask>
  get(
    id: string,
    input?: { includeDeleted?: boolean },
  ): Promise<z.output<typeof AutomationTask> | undefined> | z.output<typeof AutomationTask> | undefined
  update(
    id: string,
    input: z.output<typeof AutomationTaskPatch>,
  ): Promise<z.output<typeof AutomationTask> | undefined> | z.output<typeof AutomationTask> | undefined
  remove(id: string): Promise<z.output<typeof AutomationTask> | undefined> | z.output<typeof AutomationTask> | undefined
  pause(id: string): Promise<z.output<typeof AutomationTask> | undefined> | z.output<typeof AutomationTask> | undefined
  resume(id: string): Promise<z.output<typeof AutomationTask> | undefined> | z.output<typeof AutomationTask> | undefined
  runNow(id: string): Promise<z.output<typeof AutomationRun> | undefined> | z.output<typeof AutomationRun> | undefined
  listRuns(id: string, input?: { limit?: number }): Promise<z.output<typeof AutomationRun>[]> | z.output<typeof AutomationRun>[]
  cancelRun(
    id: string,
    runID: string,
  ): Promise<z.output<typeof AutomationRun> | undefined> | z.output<typeof AutomationRun> | undefined
  resolveSession(
    sessionID: string,
  ): Promise<{ task: z.output<typeof AutomationTask>; run?: z.output<typeof AutomationRun>; directory: string } | undefined> | {
    task: z.output<typeof AutomationTask>
    run?: z.output<typeof AutomationRun>
    directory: string
  } | undefined
}

export const GlobalAutomationRoutes = lazy(() =>
  createGlobalAutomationRoutes({
    ...ScheduledTask,
    // Resolve the Agent and model in the target instance before persisting the task.
    create: createScheduledTask,
  }),
)

export function createGlobalAutomationRoutes(service: AutomationRouteService) {
  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List scheduled automation tasks",
        description: "List durable local scheduled automation tasks. Deleted tasks are omitted unless explicitly requested.",
        operationId: "global.automation.list",
        responses: {
          200: { description: "Scheduled automation tasks", content: { "application/json": { schema: resolver(AutomationList) } } },
          ...errors(400),
        },
      }),
      validator("query", z.object({ includeDeleted: QueryBoolean.optional() }).strict()),
      async (c) => c.json({ items: await service.list(c.req.valid("query")) }),
    )
    .get(
      "/settings",
      describeRoute({
        summary: "Get scheduled automation settings",
        description: "Read the local scheduler concurrency setting.",
        operationId: "global.automation.settings.get",
        responses: {
          200: { description: "Scheduled automation settings", content: { "application/json": { schema: resolver(AutomationSettings) } } },
          ...errors(400),
        },
      }),
      async (c) => c.json(await service.getSettings()),
    )
    .put(
      "/settings",
      describeRoute({
        summary: "Update scheduled automation settings",
        description: "Update the local scheduler concurrency setting between one and eight runs.",
        operationId: "global.automation.settings.update",
        requestBody: {
          required: true,
          content: { "application/json": { schema: AutomationSettingsOpenAPI } },
        },
        responses: {
          200: { description: "Updated scheduled automation settings", content: { "application/json": { schema: resolver(AutomationSettings) } } },
          ...errors(400),
        },
      }),
      validator("json", AutomationSettings),
      async (c) => c.json(await service.updateSettings(c.req.valid("json"))),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create a scheduled automation task",
        description: "Create a local scheduled message for an existing session, a project session, or an isolated global automation session.",
        operationId: "global.automation.create",
        requestBody: {
          required: true,
          content: { "application/json": { schema: AutomationTaskCreateOpenAPI } },
        },
        responses: {
          200: { description: "Created scheduled automation task", content: { "application/json": { schema: resolver(AutomationTask) } } },
          ...errors(400),
        },
      }),
      validator("json", AutomationTaskCreate),
      async (c) => c.json(await service.create(c.req.valid("json"))),
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Resolve an automation session",
        description: "Resolve the scheduled automation task and most recent run associated with a session created by automation.",
        operationId: "global.automation.session.resolve",
        responses: {
          200: { description: "Automation session resolution", content: { "application/json": { schema: resolver(AutomationSessionResolution) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod }).strict()),
      async (c) => {
        const resolution = await service.resolveSession(c.req.valid("param").sessionID)
        if (!resolution) throw new NotFoundError({ message: "Automation session not found" })
        return c.json({ task: resolution.task, run: resolution.run ?? null, directory: resolution.directory })
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get a scheduled automation task",
        operationId: "global.automation.get",
        responses: {
          200: { description: "Scheduled automation task", content: { "application/json": { schema: resolver(AutomationTask) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", TaskParams),
      async (c) => c.json(requireRecord(await service.get(c.req.valid("param").id), "Scheduled automation task")),
    )
    .patch(
      "/:id",
      describeRoute({
        summary: "Update a scheduled automation task",
        description: "Update a task definition and recalculate its next scheduled occurrence.",
        operationId: "global.automation.update",
        requestBody: {
          required: true,
          content: { "application/json": { schema: AutomationTaskPatchOpenAPI } },
        },
        responses: {
          200: { description: "Updated scheduled automation task", content: { "application/json": { schema: resolver(AutomationTask) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", TaskParams),
      validator("json", AutomationTaskPatch),
      async (c) => {
        const id = c.req.valid("param").id
        const before = await service.listRuns(id, { limit: 500 })
        const result = requireRecord(await service.update(id, c.req.valid("json")), "Scheduled automation task")
        await publishChangedRuns(service, id, before)
        return c.json(result)
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete a scheduled automation task",
        description: "Cancel pending runs and soft-delete the task while retaining its run audit history.",
        operationId: "global.automation.delete",
        responses: {
          200: { description: "Deleted scheduled automation task", content: { "application/json": { schema: resolver(AutomationTask) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", TaskParams),
      async (c) => {
        const id = c.req.valid("param").id
        const before = await service.listRuns(id, { limit: 500 })
        const result = requireRecord(await service.remove(id), "Scheduled automation task")
        await publishChangedRuns(service, id, before)
        return c.json(result)
      },
    )
    .post(
      "/:id/pause",
      ...actionRoute(service, {
        action: "pause",
        summary: "Pause a scheduled automation task",
        description: "Pause future occurrences and cancel queued runs without interrupting a run that already started.",
      }),
    )
    .post(
      "/:id/resume",
      ...actionRoute(service, {
        action: "resume",
        summary: "Resume a scheduled automation task",
        description: "Resume future occurrences and calculate the next scheduled execution.",
      }),
    )
    .post(
      "/:id/run",
      describeRoute({
        summary: "Run a scheduled automation task now",
        description: "Queue one immediate automation run without changing the task schedule.",
        operationId: "global.automation.run",
        responses: {
          200: { description: "Queued automation run", content: { "application/json": { schema: resolver(AutomationRun) } } },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", TaskParams),
      async (c) => {
        const id = c.req.valid("param").id
        const result = requireRecord(await service.runNow(id), "Scheduled automation task")
        const task = await service.get(id, { includeDeleted: true })
        if (task) publishRunUpdate(task, result)
        await wakeScheduledTaskScheduler()
        return c.json(result)
      },
    )
    .get(
      "/:id/runs",
      describeRoute({
        summary: "List scheduled automation runs",
        operationId: "global.automation.runs",
        responses: {
          200: { description: "Scheduled automation runs", content: { "application/json": { schema: resolver(AutomationRunList) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", TaskParams),
      validator("query", z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).strict()),
      async (c) => {
        const id = c.req.valid("param").id
        if (!(await service.get(id, { includeDeleted: true }))) throw new NotFoundError({ message: "Scheduled automation task not found" })
        return c.json({ items: await service.listRuns(id, c.req.valid("query")) })
      },
    )
    .post(
      "/:id/runs/:runID/cancel",
      describeRoute({
        summary: "Cancel a queued scheduled automation run",
        description: "Cancel one run that has not started. Running model turns are not interrupted by this endpoint.",
        operationId: "global.automation.run.cancel",
        responses: {
          200: { description: "Cancelled automation run", content: { "application/json": { schema: resolver(AutomationRun) } } },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", RunParams),
      async (c) => {
        const params = c.req.valid("param")
        const previous = (await service.listRuns(params.id, { limit: 500 })).find((run) => run.id === params.runID)
        const result = requireRecord(await service.cancelRun(params.id, params.runID), "Scheduled automation run")
        const task = await service.get(params.id, { includeDeleted: true })
        if (task && (!previous || JSON.stringify(previous) !== JSON.stringify(result))) publishRunUpdate(task, result)
        return c.json(result)
      },
    )
}

function actionRoute(service: AutomationRouteService, input: { action: "pause" | "resume"; summary: string; description: string }) {
  return [
    describeRoute({
      summary: input.summary,
      description: input.description,
      operationId: `global.automation.${input.action}`,
      responses: {
        200: { description: "Scheduled automation task", content: { "application/json": { schema: resolver(AutomationTask) } } },
        ...errors(400, 404),
      },
    }),
    validator("param", TaskParams),
    async (c: Context) => {
      const id = TaskParams.parse(c.req.param()).id
      const before = input.action === "pause" ? await service.listRuns(id, { limit: 500 }) : []
      const result = input.action === "pause" ? await service.pause(id) : await service.resume(id)
      await publishChangedRuns(service, id, before)
      return c.json(requireRecord(result, "Scheduled automation task"))
    },
  ] as const
}

async function publishChangedRuns(service: AutomationRouteService, taskID: string, before: z.output<typeof AutomationRun>[]) {
  if (before.length === 0) return
  const task = await service.get(taskID, { includeDeleted: true })
  if (!task) return
  const previous = new Map(before.map((run) => [run.id, JSON.stringify(run)]))
  const after = await service.listRuns(taskID, { limit: 500 })
  after
    .filter((run) => previous.get(run.id) !== JSON.stringify(run))
    .forEach((run) => publishRunUpdate(task, run))
}

function requireRecord<T>(value: T | undefined, name: string) {
  if (value) return value
  throw new NotFoundError({ message: `${name} not found` })
}
