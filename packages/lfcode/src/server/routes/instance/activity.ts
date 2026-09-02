import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Activity } from "@/activity"
import { SessionID } from "@/session/schema"
import { jsonRequest } from "./trace"

const ActivityList = z.object({ items: Activity.ActivityInfo.array() }).meta({ ref: "ActivityList" })

export const ActivityRoutes = () =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "List session activities",
      description: "Return the current activity snapshot for a session.",
      operationId: "activity.list",
      responses: {
        200: {
          description: "Activity snapshot",
          content: { "application/json": { schema: resolver(ActivityList) } },
        },
      },
    }),
    validator("query", z.object({ sessionID: SessionID.zod })),
    async (c) =>
      jsonRequest("ActivityRoutes.list", c, function* () {
        const activity = yield* Activity.Service
        return { items: yield* activity.list(c.req.valid("query").sessionID) }
      }),
  )
