import { Cron } from "croner"
import { AutomationSchedule, type AutomationSchedule as AutomationScheduleType } from "./schema"

export function scheduleExpression(schedule: AutomationScheduleType) {
  if (schedule.kind === "cron") return schedule.expression
  if (schedule.kind === "hourly") return `${schedule.minute} * * * *`
  if (schedule.kind === "daily") return `${schedule.minute} ${schedule.hour} * * *`
  if (schedule.kind === "weekly") return `${schedule.minute} ${schedule.hour} * * ${schedule.dayOfWeek}`
}

export function validateSchedule(schedule: unknown, timezone: string) {
  const parsed = AutomationSchedule.parse(schedule)
  const expression = scheduleExpression(parsed)
  if (!expression) return parsed
  new Cron(expression, { timezone })
  return parsed
}

export function nextRunAt(input: { schedule: AutomationScheduleType; timezone: string; after?: number }) {
  const after = input.after ?? Date.now()
  if (input.schedule.kind === "once") return input.schedule.at
  if (input.schedule.kind === "interval") {
    const anchorAt = input.schedule.anchorAt ?? after
    if (after < anchorAt) return anchorAt
    const elapsed = after - anchorAt
    return anchorAt + (Math.floor(elapsed / input.schedule.everyMs) + 1) * input.schedule.everyMs
  }
  const expression = scheduleExpression(input.schedule)
  if (!expression) return
  const next = new Cron(expression, { timezone: input.timezone }).nextRun(new Date(after))
  return next?.getTime()
}

export function isRecurring(schedule: AutomationScheduleType) {
  return schedule.kind !== "once"
}
