import { Icon } from "@lfcode-ai/ui/icon"
import { showToast } from "@lfcode-ai/ui/toast"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { formatServerError } from "@/utils/server-errors"
import { startVisiblePolling } from "@/utils/visible-poll"
import { actorDispatches, requestSubagentApi, type ActorDispatch } from "../subagent-api"
import { type VisibleSubagent, SubagentCard } from "./subagent-card"

type SessionActor = VisibleSubagent & { mode: string; visible?: boolean }

const pollMs = 5_000
const terminal = new Set(["completed", "failed", "cancelled"])

function groupLabel(status: string, manualResume?: boolean) {
  if (manualResume && status === "queued") return "subagent.rail.status.interrupted"
  if (status === "running") return "subagent.rail.status.running"
  if (status === "queued") return "subagent.rail.status.queued"
  if (status === "interrupted") return "subagent.rail.status.interrupted"
  if (status === "completed") return "subagent.rail.status.completed"
  if (status === "failed") return "subagent.rail.status.failed"
  if (status === "cancelled") return "subagent.rail.status.cancelled"
  return "subagent.rail.status.queued"
}

function isTerminal(dispatch: ActorDispatch) {
  return terminal.has(dispatch.status)
}

export function SubagentDispatchRail(props: {
  sessionID: string
  directory: string
  actors: () => SessionActor[]
  onOpenSubagent: (actorID: string) => void
  showEmpty?: boolean
}) {
  const language = useLanguage()
  const server = useServer()
  const [dispatches, setDispatches] = createSignal<ActorDispatch[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [actionID, setActionID] = createSignal<string>()
  const connection = () => ({
    base: server.current?.http.url,
    directory: props.directory,
    username: server.current?.http.username,
    password: server.current?.http.password,
  })
  let initial = true
  let lastStatuses = new Map<string, string>()

  const refresh = async () => {
    try {
      const next = actorDispatches(
        await requestSubagentApi<unknown>({
          connection: connection(),
          path: "/actor-dispatch",
          query: { sessionID: props.sessionID },
        }),
      )
      if (!initial) {
        for (const item of next) {
          const previous = lastStatuses.get(item.id)
          if (!isTerminal(item) || previous === item.status) continue
          showToast({
            variant: item.status === "completed" ? "success" : "error",
            title: `${item.description}: ${language.t(groupLabel(item.status))}`,
            description:
              item.status === "completed"
                ? language.t("subagent.rail.resultReady")
                : item.error ?? language.t("subagent.rail.stopped"),
          })
        }
      }
      initial = false
      lastStatuses = new Map(next.map((item) => [item.id, item.status]))
      setDispatches(next)
    } catch (error) {
      if (!loaded()) {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: formatServerError(error, language.t, language.t("common.requestFailed")),
        })
      }
    } finally {
      setLoaded(true)
    }
  }

  createEffect(() => {
    props.sessionID
    initial = true
    lastStatuses = new Map()
    setLoaded(false)
    const stopPolling = startVisiblePolling(refresh, pollMs)
    onCleanup(stopPolling)
  })

  const runAction = async (id: string, action: "cancel" | "resume" | "receive") => {
    if (actionID()) return
    setActionID(id)
    try {
      await requestSubagentApi<unknown>({
        connection: connection(),
        path: `/actor-dispatch/${encodeURIComponent(id)}/${action}`,
        method: "POST",
        query: { sessionID: props.sessionID },
      })
      await refresh()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setActionID(undefined)
    }
  }

  const dispatchActors = createMemo(() =>
    dispatches()
      .filter((dispatch) => !dispatch.research)
      .map((dispatch) => ({
        dispatch,
        actor: {
          actorID: dispatch.actorID ?? `dispatch:${dispatch.id}`,
          description: dispatch.description,
          status: dispatch.status,
          agent: dispatch.agent,
          execution: dispatch.execution,
          unread: dispatch.unread,
        } satisfies VisibleSubagent,
      })),
  )
  const attachedActorIDs = createMemo(() => new Set(dispatches().map((item) => item.actorID).filter((item): item is string => !!item)))
  const directActors = createMemo(() =>
    props
      .actors()
      .filter((actor) => actor.mode === "subagent" && actor.visible !== false && !attachedActorIDs().has(actor.actorID)),
  )
  const running = createMemo(() => dispatchActors().filter((item) => item.dispatch.status === "running"))
  const queued = createMemo(() => dispatchActors().filter((item) => item.dispatch.status === "queued" || item.dispatch.status === "interrupted"))
  const awaitingReceipt = createMemo(() => dispatchActors().filter((item) => isTerminal(item.dispatch) && item.dispatch.unread))
  const completed = createMemo(() => dispatchActors().filter((item) => isTerminal(item.dispatch) && !item.dispatch.unread))
  const count = createMemo(() => dispatchActors().length + directActors().length)

  const card = (item: { dispatch: ActorDispatch; actor: VisibleSubagent }) => (
    <SubagentCard
      sessionID={props.sessionID}
      actor={item.actor}
      statusLabel={language.t(groupLabel(item.dispatch.status, item.dispatch.manualResume))}
      onClick={item.dispatch.actorID ? () => props.onOpenSubagent(item.dispatch.actorID!) : undefined}
      actions={
        <>
          <Show when={item.dispatch.queuePosition}>
            {(position) => (
              <span class="rounded-md px-1.5 py-1 text-11-medium text-text-weaker">
                {language.t("subagent.rail.queuePosition", { position: position() })}
              </span>
            )}
          </Show>
          <Show when={item.dispatch.conflicts.length > 0}>
            <span class="rounded-md bg-status-warning/10 px-1.5 py-1 text-11-medium text-status-warning" title={item.dispatch.conflicts.join(", ")}>
              {language.t("subagent.rail.conflict")}
            </span>
          </Show>
          <Show when={item.dispatch.actorID}>
            {(actorID) => (
              <button
                type="button"
                class="rounded-md px-1.5 py-1 text-11-medium text-text-weak hover:bg-surface-base hover:text-text-base"
                onClick={() => props.onOpenSubagent(actorID())}
              >
                {language.t("subagent.rail.openSlice")}
              </button>
            )}
          </Show>
          <Show when={item.dispatch.status === "running" || item.dispatch.status === "queued"}>
            <button
              type="button"
              class="rounded-md px-1.5 py-1 text-11-medium text-text-weak hover:bg-surface-base hover:text-text-base disabled:opacity-50"
              disabled={actionID() === item.dispatch.id}
              onClick={() => void runAction(item.dispatch.id, "cancel")}
            >
              {language.t("subagent.dispatch.action.cancel")}
            </button>
          </Show>
          <Show when={item.dispatch.status === "interrupted" || item.dispatch.manualResume}>
            <button
              type="button"
              class="rounded-md px-1.5 py-1 text-11-medium text-text-weak hover:bg-surface-base hover:text-text-base disabled:opacity-50"
              disabled={actionID() === item.dispatch.id}
              onClick={() => void runAction(item.dispatch.id, "resume")}
            >
              {language.t("subagent.settings.restore")}
            </button>
          </Show>
          <Show when={isTerminal(item.dispatch) && item.dispatch.unread}>
            <button
              type="button"
              class="rounded-md px-1.5 py-1 text-11-medium text-text-weak hover:bg-surface-base hover:text-text-base disabled:opacity-50"
              disabled={actionID() === item.dispatch.id}
              onClick={() => void runAction(item.dispatch.id, "receive")}
            >
              {language.t("subagent.rail.receive")}
            </button>
          </Show>
        </>
      }
    />
  )

  return (
    <Show when={props.showEmpty || count() > 0 || !loaded()}>
      <section data-component="session-subagents" class="mt-3 rounded-xl bg-surface-raised-base p-2" aria-live="polite">
        <div class="flex items-center gap-2 px-1 py-1.5 text-13-regular text-text-weak">
          <Icon name="brain" size="small" class="text-icon-weak-base" />
          <span>{language.t("subagent.title")}</span>
          <span class="ml-auto text-12-regular">{count()}</span>
        </div>
        <Show when={!loaded()}>
          <div class="px-1 py-2 text-12-regular text-text-weak">{language.t("subagent.rail.loading")}</div>
        </Show>
        <Show when={loaded() && count() === 0}>
          <div class="px-1 py-2 text-12-regular text-text-weak">{language.t("subagent.rail.empty")}</div>
        </Show>
        <Show when={running().length > 0}>
          <DispatchGroup title={language.t("subagent.rail.group.running")} items={running()} render={card} />
        </Show>
        <Show when={queued().length > 0}>
          <DispatchGroup title={language.t("subagent.rail.group.queued")} items={queued()} render={card} />
        </Show>
        <Show when={awaitingReceipt().length > 0}>
          <DispatchGroup title={language.t("subagent.rail.group.unread")} items={awaitingReceipt()} render={card} />
        </Show>
        <Show when={completed().length > 0}>
          <DispatchGroup title={language.t("subagent.rail.group.completed")} items={completed()} render={card} />
        </Show>
        <Show when={directActors().length > 0}>
          <div class="mt-2 border-t border-border-weak-base pt-1">
            <For each={directActors()}>
              {(actor) => <SubagentCard sessionID={props.sessionID} actor={actor} onClick={() => props.onOpenSubagent(actor.actorID)} />}
            </For>
          </div>
        </Show>
      </section>
    </Show>
  )
}

function DispatchGroup(props: {
  title: string
  items: Array<{ dispatch: ActorDispatch; actor: VisibleSubagent }>
  render: (item: { dispatch: ActorDispatch; actor: VisibleSubagent }) => JSX.Element
}) {
  return (
    <div class="mt-2 border-t border-border-weak-base pt-1 first:mt-1 first:border-t-0">
      <div class="px-1 py-1 text-11-medium text-text-weaker">{props.title}</div>
      <For each={props.items}>{(item) => props.render(item)}</For>
    </div>
  )
}
