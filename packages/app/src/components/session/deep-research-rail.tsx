import { Icon } from "@lfcode-ai/ui/icon"
import { showToast } from "@lfcode-ai/ui/toast"
import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { formatServerError } from "@/utils/server-errors"
import { requestSubagentApi, type ActorDispatch, type ResearchSnapshot } from "../subagent-api"

const terminal = new Set(["completed", "failed", "cancelled"])

function isTerminal(dispatch: ActorDispatch) {
  return terminal.has(dispatch.status)
}

function phaseLabel(phase: string | undefined) {
  if (phase === "planning") return "research.rail.phase.planning"
  if (phase === "retrieving") return "research.rail.phase.retrieving"
  if (phase === "verifying") return "research.rail.phase.verifying"
  if (phase === "synthesizing") return "research.rail.phase.synthesizing"
  if (phase === "completed") return "research.rail.phase.completed"
  if (phase === "failed") return "research.rail.phase.failed"
  if (phase === "cancelled") return "research.rail.phase.cancelled"
  return phase ?? "research.rail.phase.planning"
}

function statusTone(status: string) {
  if (status === "running" || status === "queued" || status === "interrupted") return "bg-icon-warning-base"
  if (status === "completed") return "bg-icon-interactive-base"
  if (status === "failed" || status === "cancelled") return "bg-icon-critical-base"
  return "bg-icon-weak-base"
}

function elapsedLabel(research: ResearchSnapshot, status: string) {
  const started = research.startedAt
  if (!started) return ""
  const end = research.completedAt ?? (isTerminal({ status } as ActorDispatch) ? started : Date.now())
  const seconds = Math.max(0, Math.floor((end - started) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function researchTitle(item: ActorDispatch, research: ResearchSnapshot) {
  return research.title ?? research.summary?.match(/^#\s+(.+)$/m)?.[1] ?? item.description
}

export function DeepResearchRail(props: {
  sessionID: string
  directory: string
  dispatches: () => ActorDispatch[]
  onRefresh: () => Promise<void>
  onOpenSubagent: (actorID: string) => void
  showEmpty?: boolean
}) {
  const language = useLanguage()
  const server = useServer()
  const [loaded, setLoaded] = createSignal(false)
  const [actionID, setActionID] = createSignal<string>()
  const connection = () => ({
    base: server.current?.http.url,
    directory: props.directory,
    username: server.current?.http.username,
    password: server.current?.http.password,
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
      await props.onRefresh()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setActionID()
    }
  }

  const items = createMemo(() =>
    props
      .dispatches()
      .filter((item) => item.research?.kind === "deep-research")
      .toSorted((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
  )
  createEffect(() => {
    props.dispatches()
    setLoaded(true)
  })
  const running = createMemo(() => items().filter((item) => item.status === "running"))
  const queued = createMemo(() =>
    items().filter((item) => item.status === "queued" || item.status === "interrupted" || item.manualResume),
  )
  const failed = createMemo(() => items().filter((item) => item.status === "failed" || item.status === "cancelled"))
  const awaiting = createMemo(() =>
    items().filter(
      (item) => isTerminal(item) && item.unread && item.status !== "failed" && item.status !== "cancelled",
    ),
  )
  const visibleCount = createMemo(() => running().length + queued().length + failed().length + awaiting().length)

  const card = (item: ActorDispatch) => {
    const research = item.research!
    return (
      <div
        class="rounded-lg px-1 py-1 transition-colors hover:bg-surface-raised-base-hover"
        data-component="deep-research-card"
      >
        <div class="flex min-w-0 items-start gap-2">
          <span class={`mt-1.5 size-2 shrink-0 rounded-full ${statusTone(item.status)}`} title={item.status} />
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            disabled={!item.actorID}
            data-action="deep-research-open-slice"
            onClick={() => item.actorID && props.onOpenSubagent(item.actorID)}
          >
            <div class="truncate text-12-medium text-text-base">{researchTitle(item, research)}</div>
            <div class="mt-1 flex flex-wrap gap-x-1.5 text-11-regular text-text-weak">
              <span>{language.t(phaseLabel(research.phase))}</span>
              <Show when={research.depth}>
                {(depth) => <span>{language.t("research.rail.depth", { depth: depth() })}</span>}
              </Show>
              <Show when={research.sourceCount !== undefined}>
                <span>{language.t("research.rail.sources", { count: research.sourceCount ?? 0 })}</span>
              </Show>
              <Show when={research.subtaskCount !== undefined}>
                <span>{language.t("research.rail.subtasks", { count: research.subtaskCount ?? 0 })}</span>
              </Show>
              <Show when={elapsedLabel(research, item.status)}>
                {(elapsed) => <span>{language.t("research.rail.elapsed", { value: elapsed() })}</span>}
              </Show>
            </div>
          </button>
        </div>
        <Show when={research.summary}>
          {(summary) => <div class="ml-4 mt-1 line-clamp-2 text-11-regular text-text-weaker">{summary()}</div>}
        </Show>
        <div class="ml-4 mt-1 flex flex-wrap gap-1">
          <Show when={item.actorID}>
            {(actorID) => (
              <button
                type="button"
                data-action="deep-research-open-slice"
                class="rounded-md px-1.5 py-1 text-11-medium text-text-weak hover:bg-surface-base hover:text-text-base"
                onClick={() => props.onOpenSubagent(actorID())}
              >
                {language.t("research.rail.openSlice")}
              </button>
            )}
          </Show>
          <Show when={item.status === "running" || item.status === "queued" || item.status === "interrupted"}>
            <button
              type="button"
              data-action="deep-research-cancel"
              class="rounded-md px-1.5 py-1 text-11-medium text-text-weak hover:bg-surface-base hover:text-text-base disabled:opacity-50"
              disabled={actionID() === item.id}
              onClick={() => void runAction(item.id, "cancel")}
            >
              {language.t("common.cancel")}
            </button>
          </Show>
          <Show when={item.status === "interrupted" || item.manualResume}>
            <button
              type="button"
              data-action="deep-research-resume"
              class="rounded-md px-1.5 py-1 text-11-medium text-text-weak hover:bg-surface-base hover:text-text-base disabled:opacity-50"
              disabled={actionID() === item.id}
              onClick={() => void runAction(item.id, "resume")}
            >
              {language.t("subagent.settings.restore")}
            </button>
          </Show>
          <Show when={isTerminal(item) && item.unread}>
            <button
              type="button"
              data-action="deep-research-receive"
              class="rounded-md px-1.5 py-1 text-11-medium text-text-weak hover:bg-surface-base hover:text-text-base disabled:opacity-50"
              disabled={actionID() === item.id}
              onClick={() => void runAction(item.id, "receive")}
            >
              {language.t("research.rail.receive")}
            </button>
          </Show>
        </div>
      </div>
    )
  }

  return (
    <Show when={props.showEmpty || visibleCount() > 0 || !loaded()}>
      <section
        data-component="deep-research-rail"
        class="mt-3 rounded-xl bg-surface-raised-base p-2"
        aria-live="polite"
      >
        <div class="flex items-center gap-2 px-1 py-1.5 text-13-regular text-text-weak">
          <Icon name="brain" size="small" class="text-icon-weak-base" />
          <span>{language.t("research.rail.title")}</span>
          <span class="ml-auto text-12-regular">{visibleCount()}</span>
        </div>
        <Show when={!loaded()}>
          <div class="px-1 py-2 text-12-regular text-text-weak">{language.t("research.rail.loading")}</div>
        </Show>
        <Show when={loaded() && visibleCount() === 0}>
          <div class="px-1 py-2 text-12-regular text-text-weak">{language.t("research.rail.empty")}</div>
        </Show>
        <ResearchGroup title={language.t("research.rail.group.running")} items={running()} render={card} />
        <ResearchGroup title={language.t("research.rail.group.queued")} items={queued()} render={card} />
        <ResearchGroup title={language.t("research.rail.group.failed")} items={failed()} render={card} />
        <ResearchGroup title={language.t("research.rail.group.awaiting")} items={awaiting()} render={card} />
      </section>
    </Show>
  )
}

function ResearchGroup(props: { title: string; items: ActorDispatch[]; render: (item: ActorDispatch) => JSX.Element }) {
  return (
    <Show when={props.items.length > 0}>
      <div class="mt-2 border-t border-border-weak-base pt-1 first:mt-1 first:border-t-0">
        <div class="px-1 py-1 text-11-medium text-text-weaker">{props.title}</div>
        <For each={props.items}>{(item) => props.render(item)}</For>
      </div>
    </Show>
  )
}
