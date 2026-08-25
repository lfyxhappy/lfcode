import path from "path"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Agent } from "@/agent/agent"
import { GlobalBus } from "@/bus/global"
import { Global } from "@/global"
import { Project } from "@/project"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { ProjectID } from "@/project/schema"
import { Permission } from "@/permission"
import { Provider } from "@/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import {
  AutomationTaskCreate,
  Persistence,
  ScheduledTask,
  ScheduledTaskEvent,
  type AutomationRunType,
  type AutomationTaskCreateType,
  type AutomationTaskType,
} from "@/scheduled-task"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionRunState } from "@/session/run-state"
import { SessionID } from "@/session/schema"
import { Log } from "@/util"

const log = Log.create({ service: "scheduled-task-runtime" })
const WAITING_SESSION_SCAN_MS = 1_000
const GLOBAL_AUTOMATION_EXTENSION = { pluginID: "lfcode-automation", type: "global" } as const
const FULL_AUTOMATION_PERMISSION: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

export type ScheduledTaskRuntime = {
  stop: () => void
}

let activeScheduler: ReturnType<typeof ScheduledTask.Scheduler.create> | undefined
let globalAutomationDirectoryPromise: Promise<string> | undefined

export async function startScheduledTaskRuntime(): Promise<ScheduledTaskRuntime> {
  const scheduler = ScheduledTask.Scheduler.create({
    execute: executeTask,
    onRunUpdate: publishRunUpdate,
    concurrency: () => ScheduledTask.getSettings().concurrency,
  })
  let scanning: Promise<void> | undefined
  const scanWaiting = async () => {
    if (scanning) return scanning
    scanning = requeueWaitingSessions(scheduler).finally(() => {
      scanning = undefined
    })
    return scanning
  }

  await scheduler.start()
  activeScheduler = scheduler
  const timer = setInterval(() => scheduleWaitingScan(scanWaiting), WAITING_SESSION_SCAN_MS)
  scheduleWaitingScan(scanWaiting)

  return {
    stop() {
      clearInterval(timer)
      if (activeScheduler === scheduler) activeScheduler = undefined
      scheduler.stop()
    },
  }
}

/** Wake the process-local scheduler after a manual run is queued. */
export async function wakeScheduledTaskScheduler() {
  try {
    await activeScheduler?.tick()
  } catch (error) {
    // A manual API request should still succeed after the run is durably queued;
    // the scheduler will retry on its next timer tick.
    log.warn("scheduled task manual wake failed", { error })
  }
}

export const wakeScheduledTaskRuntime = wakeScheduledTaskScheduler

/** Resolve defaults once so each task keeps the Agent and model selected at creation time. */
export async function createScheduledTask(input: AutomationTaskCreateType) {
  const task = AutomationTaskCreate.parse(input)
  const directory = await targetDirectory(task)
  const snapshot = await Instance.provide({
    directory,
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    fn: () =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const agents = yield* Agent.Service
          const provider = yield* Provider.Service
          const agentName = task.agent === "main" ? yield* agents.defaultAgent() : task.agent
          const agent = yield* agents.get(agentName)
          if (!agent) throw new Error(`Agent not found: ${agentName}`)
          const model =
            task.model ??
            agent.model ??
            (agent.modelRef
              ? yield* provider
                  .resolveModelRef(agent.modelRef)
                  .pipe(Effect.map((item) => ({ providerID: item.providerID, modelID: item.id })))
              : yield* provider.defaultModel())
          return { agent: agentName, model }
        }),
      ),
  })
  return Persistence.create({ ...task, agent: snapshot.agent, model: snapshot.model })
}

async function executeTask(task: AutomationTaskType, run: AutomationRunType) {
  const target = task.target
  if (target.kind === "session") {
    const sessionID = SessionID.make(target.sessionID)
    const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
    if (session.temporary) throw new Error("Temporary sessions cannot receive scheduled automation messages")
    try {
      return await runInSession(task, run, session.id, session.directory)
    } catch (error) {
      if (error instanceof Session.BusyError) return { status: "waiting_for_session" as const, sessionID: session.id }
      throw error
    }
  }

  const directory = await targetDirectory(task)
  const sessionID = await createSession(directory, task.name)
  return runInSession(task, run, sessionID, directory)
}

async function targetDirectory(task: Pick<AutomationTaskType, "target">) {
  const target = task.target
  if (target.kind === "session") {
    const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(SessionID.make(target.sessionID))))
    if (session.temporary) throw new Error("Temporary sessions cannot receive scheduled automation messages")
    return session.directory
  }
  if (target.kind === "project") return projectDirectory(target.projectID)
  return globalAutomationDirectory()
}

async function projectDirectory(projectID: string) {
  const project = await AppRuntime.runPromise(Project.Service.use((svc) => svc.get(ProjectID.make(projectID))))
  if (!project) throw new Error(`Project not found: ${projectID}`)
  return project.worktree
}

async function globalAutomationDirectory() {
  if (globalAutomationDirectoryPromise) return globalAutomationDirectoryPromise
  const pending = AppRuntime.runPromise(
    Project.Service.use((svc) =>
      svc.createManagedProject({
        extension: GLOBAL_AUTOMATION_EXTENSION,
        worktree: path.join(Global.Path.data, "automation", "session-root"),
        name: "自动化会话",
      }),
    ),
  ).then((project) => project.worktree)
  globalAutomationDirectoryPromise = pending
  try {
    return await pending
  } catch (error) {
    if (globalAutomationDirectoryPromise === pending) globalAutomationDirectoryPromise = undefined
    throw error
  }
}

async function createSession(directory: string, title: string) {
  const session = await Instance.provide({
    directory,
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    fn: () => AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title }))),
  })
  return session.id
}

async function runInSession(task: AutomationTaskType, run: AutomationRunType, sessionID: SessionID, directory: string) {
  return Instance.provide({
    directory,
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    async fn() {
      const associated = Persistence.setRunSession({ id: run.id, owner: run.leaseOwner, attempt: run.attempt, sessionID })
      if (associated) publishRunUpdate(task, associated)
      const abortSignal = await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.reserveAsync(sessionID)))
      const markAwaitingUser = () => {
        const updated = Persistence.markAwaitingUser({
          id: run.id,
          owner: run.leaseOwner,
          attempt: run.attempt,
          sessionID,
        })
        if (updated) publishRunUpdate(task, updated)
      }
      try {
        const message = await AppRuntime.runPromise(
          SessionPrompt.Service.use((svc) =>
            svc.prompt(
              {
                sessionID,
                source: "automation",
                agent: task.agent === "main" ? undefined : task.agent,
                model: task.model
                  ? { providerID: ProviderID.make(task.model.providerID), modelID: ModelID.make(task.model.modelID) }
                  : undefined,
                parts: [{ type: "text", text: task.message }],
                provenance: { taskID: task.id, runID: run.id },
              },
              task.permissionMode === "full"
                ? {
                    abortSignal,
                    permission: FULL_AUTOMATION_PERMISSION,
                    interactive: false,
                    onQuestionRequest: markAwaitingUser,
                  }
                : {
                    abortSignal,
                    interactive: true,
                    onPermissionRequest: markAwaitingUser,
                    onQuestionRequest: markAwaitingUser,
                  },
            ),
          ),
        )
        const result = message.parts
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n")
          .trim()
          .slice(0, 200_000)
        return { sessionID, ...(result ? { result } : {}) }
      } finally {
        await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.releaseAsync(sessionID, abortSignal))).catch(
          (error) => log.warn("automation session reservation release failed", { sessionID, error }),
        )
      }
    },
  })
}

export function publishRunUpdate(task: AutomationTaskType, run: AutomationRunType) {
  const resolved = run.sessionID ? Persistence.resolveSession(run.sessionID) : undefined
  GlobalBus.emit("event", {
    directory: resolved?.directory ?? "global",
    payload: {
      type: ScheduledTaskEvent.RunUpdated.type,
      properties: {
        taskID: task.id,
        taskName: task.name,
        runID: run.id,
        status: run.status,
        notifications: task.notifications,
        late: run.late,
        sessionID: run.sessionID,
        error: run.error,
      },
    },
  })
}

async function requeueWaitingSessions(scheduler: ReturnType<typeof ScheduledTask.Scheduler.create>) {
  const waiting = Persistence.listWaitingForSession()
  const requeued = await Promise.all(
    waiting.map(async (run) => {
      if (!run.sessionID) return false
      try {
        const sessionID = SessionID.make(run.sessionID)
        const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
        await Instance.provide({
          directory: session.directory,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
          fn: () => AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.assertNotBusy(session.id))),
        })
      } catch (error) {
        if (error instanceof Session.BusyError) return false
        log.warn("automation waiting session could not be checked; retrying its run", {
          runID: run.id,
          sessionID: run.sessionID,
          error,
        })
      }
      const updated = Persistence.requeueRun(run.id)
      if (!updated) return false
      const task = Persistence.get(updated.taskID, { includeDeleted: true })
      if (task) publishRunUpdate(task, updated)
      return true
    }),
  )
  if (requeued.some(Boolean)) await scheduler.tick()
}

function scheduleWaitingScan(scanWaiting: () => Promise<void>) {
  void scanWaiting().catch((error) => {
    log.warn("scheduled task waiting-session scan failed", { error })
  })
}
