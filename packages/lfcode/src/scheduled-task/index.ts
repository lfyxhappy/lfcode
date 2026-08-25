import {
  AutomationModel,
  AutomationNotification,
  AutomationPermissionMode,
  AutomationRun,
  AutomationRunExecution,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationSettings,
  AutomationTarget,
  AutomationTask,
  AutomationTaskCreate,
  AutomationTaskUpdate,
  AutomationTimeZone,
} from "./schema"
import { Persistence } from "./persistence"
import { Scheduler } from "./scheduler"
import { ScheduledTaskEvent } from "./events"

export {
  AutomationModel,
  AutomationNotification,
  AutomationPermissionMode,
  AutomationRun,
  AutomationRunExecution,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationSettings,
  AutomationTarget,
  AutomationTask,
  AutomationTaskCreate,
  AutomationTaskUpdate,
  AutomationTimeZone,
  Persistence,
  Scheduler,
  ScheduledTaskEvent,
}
export type {
  AutomationModel as AutomationModelType,
  AutomationNotification as AutomationNotificationType,
  AutomationPermissionMode as AutomationPermissionModeType,
  AutomationRun as AutomationRunType,
  AutomationRunExecution as AutomationRunExecutionType,
  AutomationRunStatus as AutomationRunStatusType,
  AutomationSchedule as AutomationScheduleType,
  AutomationSettings as AutomationSettingsType,
  AutomationTarget as AutomationTargetType,
  AutomationTask as AutomationTaskType,
  AutomationTaskCreate as AutomationTaskCreateType,
  AutomationTaskUpdate as AutomationTaskUpdateType,
  AutomationTimeZone as AutomationTimeZoneType,
} from "./schema"
export { ScheduledTaskScheduler, type SchedulerOptions } from "./scheduler"
export { type ClaimedRun } from "./persistence"

export const ScheduledTask = {
  list: Persistence.list,
  create: Persistence.create,
  get: Persistence.get,
  update: Persistence.update,
  remove: Persistence.remove,
  pause: Persistence.pause,
  resume: Persistence.resume,
  runNow: Persistence.runNow,
  listRuns: Persistence.listRuns,
  cancelRun: Persistence.cancelRun,
  getSettings: Persistence.getSettings,
  updateSettings: Persistence.updateSettings,
  resolveSession: Persistence.resolveSession,
  Scheduler,
}
