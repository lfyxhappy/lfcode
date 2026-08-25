import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { AutomationNotification, AutomationRunStatus } from "./schema"

export const RunUpdated = BusEvent.define(
  "automation.run.updated",
  z.object({
    taskID: z.string().min(1),
    taskName: z.string().min(1),
    runID: z.string().min(1),
    status: AutomationRunStatus,
    notifications: AutomationNotification,
    late: z.boolean(),
    sessionID: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
  }),
)

export const ScheduledTaskEvent = { RunUpdated }
