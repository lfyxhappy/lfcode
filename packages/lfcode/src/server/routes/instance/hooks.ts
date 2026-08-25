import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "@/project/instance"
import { clearHookRuns, createHook, deleteHook, getHook, listHookRuns, listHooks, setHookEnabled, updateHook } from "@/hook/persistence"
import { executeHook } from "@/hook/runtime"
import { HookDefinition, HookDefinitionInput, HookEvent, HookRun } from "@/hook/schema"
import { lazy } from "@/util/lazy"

const Query = z.object({ projectID: z.string().optional(), sessionID: z.string().optional(), includeExpired: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(500).optional() })
const id = z.object({ hookID: z.string().min(1) })
const TestInput = z.object({ event: HookEvent, sessionID: z.string().optional(), projectID: z.string().optional(), cwd: z.string().optional(), payload: z.record(z.string(), z.unknown()).optional(), tool: z.string().optional() })
const projectID = (value?: string) => value ?? String(Instance.project.id)

export const HookRoutes = lazy(() => new Hono()
  .get("/", describeRoute({ summary: "List user Hooks", operationId: "hooks.list", responses: { 200: { description: "Hooks", content: { "application/json": { schema: resolver(HookDefinition.array()) } } } } }), validator("query", Query), (c) => { const query = c.req.valid("query"); return c.json(listHooks({ projectID: projectID(query.projectID), sessionID: query.sessionID, includeExpired: query.includeExpired })) })
  .post("/", describeRoute({ summary: "Create user Hook", operationId: "hooks.create", responses: { 200: { description: "Hook", content: { "application/json": { schema: resolver(HookDefinition) } } } } }), validator("json", HookDefinitionInput), (c) => { const input = c.req.valid("json"); return c.json(createHook({ ...input, projectID: input.scope === "project" ? input.projectID ?? projectID() : input.projectID, source: "user" })) })
  .get("/:hookID", describeRoute({ summary: "Get user Hook", operationId: "hooks.get", responses: { 200: { description: "Hook", content: { "application/json": { schema: resolver(HookDefinition) } } } } }), validator("param", id), (c) => { const hook = getHook(c.req.valid("param").hookID); return hook ? c.json(hook) : c.json({ error: "Hook not found" }, 404) })
  .put("/:hookID", describeRoute({ summary: "Update user Hook", operationId: "hooks.update", responses: { 200: { description: "Hook", content: { "application/json": { schema: resolver(HookDefinition) } } } } }), validator("param", id), validator("json", HookDefinitionInput.partial()), (c) => { const hook = updateHook(c.req.valid("param").hookID, c.req.valid("json")); return hook ? c.json(hook) : c.json({ error: "Hook not found" }, 404) })
  .post("/:hookID/enabled", describeRoute({ summary: "Enable or disable user Hook", operationId: "hooks.enabled", responses: { 200: { description: "Hook", content: { "application/json": { schema: resolver(HookDefinition) } } } } }), validator("param", id), validator("json", z.object({ enabled: z.boolean() })), (c) => { const hook = setHookEnabled(c.req.valid("param").hookID, c.req.valid("json").enabled); return hook ? c.json(hook) : c.json({ error: "Hook not found" }, 404) })
  .delete("/:hookID", describeRoute({ summary: "Delete user Hook", operationId: "hooks.delete", responses: { 200: { description: "Deleted" } } }), validator("param", id), (c) => c.json({ deleted: deleteHook(c.req.valid("param").hookID) }))
  .post("/:hookID/test", describeRoute({ summary: "Test user Hook", operationId: "hooks.test", responses: { 200: { description: "Run", content: { "application/json": { schema: resolver(HookRun) } } } } }), validator("param", id), validator("json", TestInput), async (c) => { const hook = getHook(c.req.valid("param").hookID); if (!hook) return c.json({ error: "Hook not found" }, 404); const input = c.req.valid("json"); return c.json((await executeHook(hook, { ...input, projectID: projectID(input.projectID), cwd: input.cwd ?? Instance.worktree })).run) })
  .get("/:hookID/runs", describeRoute({ summary: "List Hook runs", operationId: "hooks.runs.list", responses: { 200: { description: "Runs", content: { "application/json": { schema: resolver(HookRun.array()) } } } } }), validator("param", id), validator("query", Query), (c) => c.json(listHookRuns({ hookID: c.req.valid("param").hookID, limit: c.req.valid("query").limit })))
  .delete("/:hookID/runs", describeRoute({ summary: "Clear Hook runs", operationId: "hooks.runs.clear", responses: { 200: { description: "Cleared" } } }), validator("param", id), (c) => c.json({ cleared: clearHookRuns(c.req.valid("param").hookID) }))
)
