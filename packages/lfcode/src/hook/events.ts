import { BusEvent } from "@/bus/bus-event"
import { HookEvent, HookRun } from "./schema"
import z from "zod"

/** Published after a Hook has been selected and executed. Payload is already redacted. */
export const RunCompleted = BusEvent.define(
  "hook.run.completed",
  z.object({
    sessionID: z.string().optional(),
    hookID: z.string(),
    hookName: z.string(),
    event: HookEvent,
    status: HookRun.shape.status,
    durationMs: z.number().int().nonnegative(),
    summary: z.string(),
    timeCreated: z.number().int(),
  }),
)

export * as HookEvents from "./events"
