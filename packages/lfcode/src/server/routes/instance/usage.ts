import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "../../error"
import { jsonRequest } from "./trace"
import { SessionUsage } from "@/session/usage"

export const UsageRoutes = () =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "Get usage statistics",
      description: "Return aggregated token, cost, provider, model, trend, and request log usage statistics.",
      operationId: "usage.get",
      responses: {
        200: {
          description: "Usage statistics",
          content: {
            "application/json": {
              schema: resolver(SessionUsage.Response),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "query",
      z.object({
        range: z.enum(["today", "7d", "30d", "all"]).optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
        source: z.literal("lfcode").optional(),
        search: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.coerce.number().int().nonnegative().optional(),
      }),
    ),
    async (c) =>
      jsonRequest("UsageRoutes.get", c, function* () {
        const query = c.req.valid("query")
        return SessionUsage.get(query)
      }),
  )
