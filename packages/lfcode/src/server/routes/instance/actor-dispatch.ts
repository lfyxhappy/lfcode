import { Hono, type Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { ActorDispatch } from "@/actor/dispatch"
import { dispatchRef } from "@/actor/dispatch-ref"
import { spawnRef } from "@/actor/spawn-ref"
import { SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const DispatchID = z.string().min(1).max(128)
const DispatchParams = z.object({ dispatchID: DispatchID })
const DispatchSessionQuery = z.object({ sessionID: SessionID.zod })
const DispatchList = z.object({ items: ActorDispatch.Info.array() }).meta({ ref: "ActorDispatchList" })

export const ActorDispatchRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List background actor dispatches",
        description: "List durable background Actor dispatches for one session.",
        operationId: "actorDispatch.list",
        responses: {
          200: {
            description: "Actor dispatches",
            content: { "application/json": { schema: resolver(DispatchList) } },
          },
          ...errors(400),
        },
      }),
      validator("query", DispatchSessionQuery),
      async (c) =>
        jsonRequest("ActorDispatchRoutes.list", c, function* () {
          const dispatch = requireDispatch()
          const query = c.req.valid("query")
          return { items: (yield* dispatch.list(query.sessionID)).map(toInfo) }
        }),
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get background Actor dispatch configuration",
        description: "Get the per-session background Actor concurrency limit.",
        operationId: "actorDispatch.config.get",
        responses: {
          200: {
            description: "Actor dispatch configuration",
            content: { "application/json": { schema: resolver(ActorDispatch.Config) } },
          },
        },
      }),
      async (c) =>
        jsonRequest("ActorDispatchRoutes.config.get", c, function* () {
          return yield* requireDispatch().config()
        }),
    )
    .put(
      "/config",
      describeRoute({
        summary: "Update background Actor dispatch configuration",
        description: "Set the per-session background Actor concurrency limit from 1 to 8.",
        operationId: "actorDispatch.config.put",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["backgroundConcurrency"],
                properties: {
                  backgroundConcurrency: { type: "integer", minimum: 1, maximum: 8 },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          200: {
            description: "Updated Actor dispatch configuration",
            content: { "application/json": { schema: resolver(ActorDispatch.Config) } },
          },
          ...errors(400),
        },
      }),
      validator("json", ActorDispatch.Config),
      async (c) =>
        jsonRequest("ActorDispatchRoutes.config.put", c, function* () {
          return yield* requireDispatch().setConcurrency(c.req.valid("json").backgroundConcurrency)
        }),
    )
    .post(
      "/:dispatchID/cancel",
      ...actionRoute({
        action: "cancel",
        summary: "Cancel background Actor dispatch",
        description: "Cancel one queued or running background Actor dispatch without focusing the parent session.",
      }),
    )
    .post(
      "/:dispatchID/resume",
      ...actionRoute({
        action: "resume",
        summary: "Resume interrupted Actor dispatch",
        description: "Create a new queued attempt from an interrupted or manually resumable Actor dispatch.",
      }),
    )
    .post(
      "/:dispatchID/receive",
      ...actionRoute({
        action: "receive",
        summary: "Receive Actor dispatch result",
        description: "Mark a completed Actor result as read and add it to the parent session as non-executing context.",
      }),
    ),
)

function actionRoute(input: {
  action: "cancel" | "resume" | "receive"
  summary: string
  description: string
}) {
  return [
    describeRoute({
      summary: input.summary,
      description: input.description,
      operationId: `actorDispatch.${input.action}`,
      responses: {
        200: {
          description: "Actor dispatch",
          content: { "application/json": { schema: resolver(ActorDispatch.Info) } },
        },
        ...errors(400, 404, 409),
      },
    }),
    validator("param", DispatchParams),
    validator("query", DispatchSessionQuery),
    async (c: Context) =>
      jsonRequest(`ActorDispatchRoutes.${input.action}`, c, function* () {
        const dispatch = requireDispatch()
        const params = DispatchParams.parse(c.req.param())
        const query = DispatchSessionQuery.parse(c.req.query())
        const actor = requireActor()

        if (input.action === "cancel") {
          const result = actor.cancelDispatch ? yield* actor.cancelDispatch(query.sessionID, params.dispatchID) : undefined
          return toInfo(requireResult(result, params.dispatchID))
        }

        if (input.action === "receive") {
          const result = actor.receiveDispatch ? yield* actor.receiveDispatch(query.sessionID, params.dispatchID) : undefined
          return toInfo(requireResult(result, params.dispatchID))
        }

        const resumed = actor.resumeDispatch ? yield* actor.resumeDispatch(query.sessionID, params.dispatchID) : undefined
        if (!resumed?.dispatchID) {
          throw new HTTPException(409, { message: `Actor dispatch cannot be resumed: ${params.dispatchID}` })
        }
        const result = yield* dispatch.getForSession(query.sessionID, resumed.dispatchID)
        return toInfo(requireResult(result, resumed.dispatchID))
      }),
  ] as const
}

function requireDispatch() {
  const dispatch = dispatchRef.current
  if (dispatch) return dispatch
  throw new HTTPException(503, { message: "Actor dispatch service is unavailable" })
}

function requireActor() {
  const actor = spawnRef.current
  if (actor) return actor
  throw new HTTPException(503, { message: "Actor service is unavailable" })
}

function requireResult<T>(value: T | undefined, dispatchID: string) {
  if (value) return value
  throw new NotFoundError({ message: `Actor dispatch not found: ${dispatchID}` })
}

function toInfo(record: ActorDispatch.Record) {
  return ActorDispatch.Info.parse(record)
}
