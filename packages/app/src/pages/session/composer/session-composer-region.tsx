import { Show, createEffect, createMemo } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useSpring } from "@lfcode-ai/ui/motion-spring"
import { PromptInput } from "@/components/prompt-input"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import { useSessionKey } from "@/pages/session/session-layout"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import type { FollowupDraft, FollowupMode } from "@/components/prompt-input/submit"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import type { PromptScope } from "@/context/prompt"

export function SessionComposerRegion(props: {
  state: SessionComposerState
  ready: boolean
  centered: boolean
  rightInset?: boolean
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  onResponseSubmit: () => void
  followup?: {
    mode: () => FollowupMode | undefined
    items: { id: string; text: string }[]
    sending?: string
    edit?: { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] }
    onQueue: (draft: FollowupDraft) => void
    onAbort: () => void
    onSend: (id: string) => void
    onEdit: (id: string) => void
    onEditLoaded: () => void
  }
  revert?: {
    items: { id: string; text: string }[]
    restoring?: string
    disabled?: boolean
    onRestore: (id: string) => void
  }
  scope?: PromptScope
  dropRoot?: () => HTMLElement | undefined
  disabledMessage?: string
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const language = useLanguage()
  const route = useSessionKey()
  const sync = useSync()

  const handoffPrompt = createMemo(() => getSessionHandoff(route.sessionKey())?.prompt)
  const info = createMemo(() => (route.params.id ? sync.session.get(route.params.id) : undefined))
  const parentID = createMemo(() => info()?.parentID)
  const child = createMemo(() => !!parentID())
  const showComposer = createMemo(() => !props.state.blocked() || child())

  const previewPrompt = () =>
    prompt
      .current()
      .map((part) => {
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        if (part.type === "image") return `[image:${part.filename}]`
        return part.content
      })
      .join("")
      .trim()

  createEffect(() => {
    if (!prompt.ready()) return
    setSessionHandoff(route.sessionKey(), { prompt: previewPrompt() })
  })

  const [store, setStore] = createStore({
    ready: false,
    height: 320,
    body: undefined as HTMLDivElement | undefined,
  })

  createEffect(() => {
    route.sessionKey()
    setStore("ready", props.ready)
  })

  const open = createMemo(() => store.ready && props.state.dock() && !props.state.closing())
  const progress = useSpring(() => (open() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const value = createMemo(() => Math.max(0, Math.min(1, progress())))
  const dock = createMemo(() => (store.ready && props.state.dock()) || value() > 0.001)
  const rolled = createMemo(() => (props.revert?.items.length ? props.revert : undefined))
  const lift = createMemo(() => (rolled() ? 18 : 36 * value()))
  const full = createMemo(() => Math.max(78, store.height))

  const openParent = () => {
    const id = parentID()
    if (!id) return
    navigate(`/${route.params.dir}/session/${id}`)
  }

  createEffect(() => {
    const el = store.body
    if (!el) return
    const update = () => setStore("height", el.getBoundingClientRect().height)
    createResizeObserver(store.body, update)
    update()
  })

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      class="shrink-0 w-full pb-3 flex flex-col justify-center items-center bg-background-stronger pointer-events-none"
    >
      <Show when={props.state.permissionRequest() || props.state.questionRequest()}>
        <Portal>
          <div data-component="session-request-overlay" role="dialog" aria-modal="true" aria-live="assertive">
            <div data-slot="session-request-overlay-panel">
              <Show
                when={props.state.permissionRequest()}
                keyed
                fallback={
                  <Show when={props.state.questionRequest()} keyed>
                    {(request) => <SessionQuestionDock request={request} onSubmit={props.onResponseSubmit} />}
                  </Show>
                }
              >
                {(request) => (
                  <SessionPermissionDock
                    request={request}
                    responding={props.state.permissionResponding()}
                    onDecide={(response) => {
                      props.onResponseSubmit()
                      props.state.decide(response)
                    }}
                  />
                )}
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
      <div
        class="w-full self-start"
        style={{ width: props.rightInset ? "calc(100% - clamp(336px, 22vw, 440px))" : undefined }}
      >
        <div
          classList={{
            "w-full px-3 pointer-events-auto": true,
            "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
          }}
        >
        <Show when={showComposer()}>
          <Show
            when={prompt.ready()}
            fallback={
              <>
                <Show when={rolled()} keyed>
                  {(revert) => (
                    <div class="pb-2">
                      <SessionRevertDock
                        items={revert.items}
                        restoring={revert.restoring}
                        disabled={revert.disabled}
                        onRestore={revert.onRestore}
                      />
                    </div>
                  )}
                </Show>
                <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                  {handoffPrompt() || language.t("prompt.loading")}
                </div>
              </>
            }
          >
            <Show when={dock()}>
              <div
                classList={{
                  "overflow-hidden": true,
                  "pointer-events-none": value() < 0.98,
                }}
                style={{
                  "max-height": `${full() * value()}px`,
                }}
              >
                <div ref={(el) => setStore("body", el)}>
                  <SessionTodoDock
                    sessionID={route.params.id}
                    todos={props.state.todos()}
                    collapseLabel={language.t("session.todo.collapse")}
                    expandLabel={language.t("session.todo.expand")}
                    dockProgress={value()}
                  />
                </div>
              </div>
            </Show>
            <Show when={rolled()} keyed>
              {(revert) => (
                <div
                  style={{
                    "margin-top": `${-36 * value()}px`,
                  }}
                >
                  <SessionRevertDock
                    items={revert.items}
                    restoring={revert.restoring}
                    disabled={revert.disabled}
                    onRestore={revert.onRestore}
                  />
                </div>
              )}
            </Show>
            <div
              classList={{
                "relative z-10": true,
              }}
              style={{
                "margin-top": `${-lift()}px`,
              }}
            >
              <Show when={props.followup?.items.length}>
                <SessionFollowupDock
                  items={props.followup!.items}
                  sending={props.followup!.sending}
                  onSend={props.followup!.onSend}
                  onEdit={props.followup!.onEdit}
                />
              </Show>
              <Show
                when={child()}
                fallback={
                  <Show when={!props.state.blocked()}>
                    <div class="relative">
                      <div classList={{ "pointer-events-none select-none opacity-60": !!props.disabledMessage }}>
                        <PromptInput
                          ref={props.inputRef}
                          newSessionWorktree={props.newSessionWorktree}
                          onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                          edit={props.followup?.edit}
                          onEditLoaded={props.followup?.onEditLoaded}
                          followupMode={props.followup?.mode}
                          onQueue={props.followup?.onQueue}
                          onAbort={props.followup?.onAbort}
                          onSubmit={props.onSubmit}
                          scope={props.scope}
                          dropRoot={props.dropRoot}
                        />
                      </div>
                      <Show when={props.disabledMessage}>
                        {(message) => (
                          <div class="absolute inset-0 z-10 flex items-center justify-center rounded-[12px] border border-border-weak-base bg-background-base/88 px-4 text-center text-14-regular text-text-weak">
                            {message()}
                          </div>
                        )}
                      </Show>
                    </div>
                  </Show>
                }
              >
                <div
                  ref={props.inputRef}
                  class="w-full rounded-[12px] border border-border-weak-base bg-background-base p-3 text-16-regular text-text-weak"
                >
                  <span>{language.t("session.child.promptDisabled")} </span>
                  <Show when={parentID()}>
                    <button
                      type="button"
                      class="text-text-base transition-colors hover:text-text-strong"
                      onClick={openParent}
                    >
                      {language.t("session.child.backToParent")}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
        </div>
      </div>
    </div>
  )
}
