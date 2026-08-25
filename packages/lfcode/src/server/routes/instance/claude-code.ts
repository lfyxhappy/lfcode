import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Effect } from "effect"
import z from "zod"
import { ClaudeCode } from "@/claude-code"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { errors } from "../../error"
import { jsonRequest } from "./trace"

const CreateResult = z.object({ session: Session.Info, binding: ClaudeCode.Binding })

export const ClaudeCodeRoutes = () =>
  new Hono()
    .get(
      "/capability",
      describeRoute({
        summary: "Get Claude Code desktop capability",
        operationId: "claudeCode.capability",
        responses: { 200: { description: "Claude Code capability", content: { "application/json": { schema: resolver(ClaudeCode.Capability) } } } },
      }),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.capability", c, function* () {
          const claude = yield* ClaudeCode.Service
          return yield* claude.capability()
        }),
    )
    .post(
      "/",
      describeRoute({
        summary: "Create a Claude Code bound session",
        operationId: "claudeCode.create",
        responses: { 200: { description: "Created Claude Code session", content: { "application/json": { schema: resolver(CreateResult) } } }, ...errors(400) },
      }),
      validator("json", z.object({ title: z.string().optional() }).optional()),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.create", c, function* () {
          const claude = yield* ClaudeCode.Service
          const capability = yield* claude.capability()
          if (!capability.available) throw new Error(`Claude Code unavailable: ${capability.reason}`)
          const session = yield* Session.Service
          const created = yield* session.create({ title: c.req.valid("json")?.title ?? "Claude Code" })
          try {
            const binding = yield* claude.create(created)
            return { session: created, binding }
          } catch (error) {
            yield* session.remove(created.id)
            throw error
          }
        }),
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get a Claude Code session binding",
        operationId: "claudeCode.get",
        responses: { 200: { description: "Claude Code binding", content: { "application/json": { schema: resolver(ClaudeCode.Binding.nullable()) } } }, ...errors(404) },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.get", c, function* () {
          const claude = yield* ClaudeCode.Service
          return (yield* claude.get(c.req.valid("param").sessionID)) ?? null
        }),
    )
    .post(
      "/:sessionID/reset",
      describeRoute({
        summary: "Replace a failed Claude Code conversation binding",
        operationId: "claudeCode.reset",
        responses: { 200: { description: "Reset Claude Code binding", content: { "application/json": { schema: resolver(ClaudeCode.Binding) } } }, ...errors(404) },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.reset", c, function* () {
          const claude = yield* ClaudeCode.Service
          return yield* claude.reset(c.req.valid("param").sessionID)
        }),
    )
    .post(
      "/:sessionID/open",
      describeRoute({
        summary: "Open or resume a Claude Code terminal",
        operationId: "claudeCode.open",
        responses: { 200: { description: "Active Claude Code binding", content: { "application/json": { schema: resolver(ClaudeCode.Binding) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.open", c, function* () {
          const session = yield* Session.Service
          const sessionID = c.req.valid("param").sessionID
          yield* session.get(sessionID)
          const claude = yield* ClaudeCode.Service
          return yield* claude.open(sessionID)
        }),
    )
    .post(
      "/:sessionID/input",
      describeRoute({
        summary: "Send input to an active Claude Code terminal",
        operationId: "claudeCode.input",
        responses: { 200: { description: "Sent", content: { "application/json": { schema: resolver(z.boolean()) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ data: z.string().min(1) })),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.input", c, function* () {
          const claude = yield* ClaudeCode.Service
          yield* claude.input(c.req.valid("param").sessionID, c.req.valid("json").data)
          return true
        }),
    )
    .post(
      "/:sessionID/permission-mode",
      describeRoute({
        summary: "Set Claude Code permission mode by resuming its bound session",
        operationId: "claudeCode.setPermissionMode",
        responses: { 200: { description: "Reopened Claude Code binding", content: { "application/json": { schema: resolver(ClaudeCode.Binding) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ mode: ClaudeCode.PermissionMode })),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.setPermissionMode", c, function* () {
          const claude = yield* ClaudeCode.Service
          return yield* claude.setPermissionMode(c.req.valid("param").sessionID, c.req.valid("json").mode)
        }),
    )
    .post(
      "/:sessionID/key",
      describeRoute({
        summary: "Send a native keyboard sequence to an active Claude Code terminal",
        operationId: "claudeCode.key",
        responses: { 200: { description: "Sent", content: { "application/json": { schema: resolver(z.boolean()) } } }, ...errors(400, 404) },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ data: z.string().min(1).max(32) })),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.key", c, function* () {
          const claude = yield* ClaudeCode.Service
          yield* claude.key(c.req.valid("param").sessionID, c.req.valid("json").data)
          return true
        }),
    )
    .post(
      "/:sessionID/close",
      describeRoute({
        summary: "Close an active Claude Code terminal without deleting its binding",
        operationId: "claudeCode.close",
        responses: { 200: { description: "Closed", content: { "application/json": { schema: resolver(z.boolean()) } } }, ...errors(404) },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) =>
        jsonRequest("ClaudeCodeRoutes.close", c, function* () {
          const claude = yield* ClaudeCode.Service
          yield* claude.close(c.req.valid("param").sessionID)
          return true
        }),
    )
