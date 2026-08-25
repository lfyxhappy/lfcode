import { Button } from "@lfcode-ai/ui/button"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import { type GlobalSession } from "@lfcode-ai/sdk/v2/client"
import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { formatServerError } from "@/utils/server-errors"
import { archivedSessions, removeSession, sessionProjectLabel } from "./settings-archives-helpers"

const PAGE_SIZE = 50

function dateTime(value: number | undefined, locale: string) {
  if (!value) return ""
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
}

const EmptyState: Component<{ title: string; description: string }> = (props) => (
  <div class="rounded-lg border border-dashed border-border-weak-base px-4 py-10 text-center">
    <div class="text-14-medium text-text-strong">{props.title}</div>
    <div class="pt-1 text-14-regular text-text-weak">{props.description}</div>
  </div>
)

export const SettingsArchives: Component = () => {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const [search, setSearch] = createSignal("")
  const [cursor, setCursor] = createSignal<number | undefined>()
  const [busy, setBusy] = createSignal<string>()
  const [confirmingDelete, setConfirmingDelete] = createSignal<GlobalSession>()
  const [state, setState] = createStore({
    sessions: [] as GlobalSession[],
    hasMore: false,
    nextCursor: undefined as number | undefined,
  })

  const query = createMemo(() => ({
    search: search().trim(),
    cursor: cursor(),
  }))

  const [archiveQuery, { refetch }] = createResource(query, async (input) => {
    const result = await globalSDK.client.experimental.session.list({
      archived: true,
      roots: true,
      limit: PAGE_SIZE,
      search: input.search || undefined,
      cursor: input.cursor,
    })
    const rawSessions = result.data ?? []
    const sessions = archivedSessions(rawSessions)
    setState("sessions", input.cursor ? [...state.sessions, ...sessions] : sessions)
    setState("hasMore", rawSessions.length >= PAGE_SIZE)
    setState("nextCursor", rawSessions.at(-1)?.time.updated)
  })

  const locale = createMemo(() => language.intl())
  const loading = createMemo(() => archiveQuery.loading && !cursor() && state.sessions.length === 0)

  const refresh = () => {
    setCursor(undefined)
    void refetch()
  }

  const loadMore = () => {
    if (!state.nextCursor) return
    setCursor(state.nextCursor)
  }

  const restore = async (session: GlobalSession) => {
    if (busy()) return
    setBusy(session.id)
    try {
      await globalSDK.client.session.update({
        sessionID: session.id,
        directory: session.directory,
        time: { archived: null },
      })
      setState("sessions", (sessions) => removeSession(sessions, session.id))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.archives.toast.restored.title"),
        description: language.t("settings.archives.toast.restored.description", { name: session.title }),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.archives.toast.restoreFailed.title"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const deleteArchived = async (session: GlobalSession) => {
    if (busy()) return
    setBusy(session.id)
    try {
      await globalSDK.client.session.delete({ sessionID: session.id, directory: session.directory })
      setState("sessions", (sessions) => removeSession(sessions, session.id))
      setConfirmingDelete(undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.archives.toast.deleted.title"),
        description: language.t("settings.archives.toast.deleted.description", { name: session.title }),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.archives.toast.deleteFailed.title"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const confirmDelete = (session: GlobalSession) => {
    setConfirmingDelete(session)
  }

  return (
    <div class="no-scrollbar flex h-full flex-col overflow-y-auto px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 border-b border-border-weaker-base bg-background-base">
        <div class="flex max-w-[980px] flex-col gap-4 pb-6 pt-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-16-medium text-text-strong">{language.t("settings.archives.title")}</h2>
              <p class="pt-1 text-14-regular text-text-weak">{language.t("settings.archives.description")}</p>
            </div>
            <Button size="large" variant="secondary" onClick={refresh}>
              <Icon name="reset" />
              {language.t("settings.archives.action.refresh")}
            </Button>
          </div>
          <div class="flex h-9 items-center gap-2 rounded-lg bg-surface-base px-3">
            <Icon name="magnifying-glass" class="flex-shrink-0 text-icon-weak-base" />
            <TextField
              variant="ghost"
              type="text"
              value={search()}
              onChange={(value) => {
                setSearch(value)
                setCursor(undefined)
              }}
              placeholder={language.t("settings.archives.search.placeholder")}
              class="min-w-0 flex-1"
            />
          </div>
        </div>
      </div>

      <div class="max-w-[980px]">
        <Show when={confirmingDelete()}>
          {(session) => (
            <div class="mb-4 rounded-lg border border-border-weak-base bg-surface-base px-4 py-4">
              <div class="text-14-medium text-text-strong">{language.t("settings.archives.delete.title")}</div>
              <p class="pt-1 text-14-regular text-text-base">
                {language.t("settings.archives.delete.confirm", { name: session().title })}
              </p>
              <div class="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmingDelete(undefined)} disabled={busy() === session().id}>
                  {language.t("common.cancel")}
                </Button>
                <Button variant="primary" onClick={() => void deleteArchived(session())} disabled={busy() === session().id}>
                  {language.t("settings.archives.action.delete")}
                </Button>
              </div>
            </div>
          )}
        </Show>
        <Show
          when={state.sessions.length > 0}
          fallback={
            <EmptyState
              title={
                loading() ? language.t("settings.archives.loading") : language.t("settings.archives.empty.title")
              }
              description={language.t("settings.archives.empty.description")}
            />
          }
        >
          <div class="flex flex-col overflow-hidden rounded-lg bg-surface-base">
            <For each={state.sessions}>
              {(session) => (
                <div class="flex flex-col gap-3 border-b border-border-weak-base px-4 py-4 last:border-b-0 md:flex-row md:items-center md:justify-between">
                  <div class="min-w-0">
                    <div class="truncate text-14-medium text-text-strong">{session.title}</div>
                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-12-regular text-text-weak">
                      <span class="truncate">{sessionProjectLabel(session)}</span>
                      <span>{language.t("settings.archives.item.updated", { time: dateTime(session.time.updated, locale()) })}</span>
                      <span>
                        {language.t("settings.archives.item.archived", {
                          time: dateTime(session.time.archived, locale()),
                        })}
                      </span>
                    </div>
                  </div>
                  <div class="flex flex-shrink-0 items-center gap-2">
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => void restore(session)}
                      disabled={busy() === session.id}
                    >
                      {language.t("settings.archives.action.restore")}
                    </Button>
                    <IconButton
                      icon="trash"
                      size="small"
                      variant="ghost"
                      onClick={() => confirmDelete(session)}
                      disabled={busy() === session.id}
                      aria-label={language.t("settings.archives.action.delete")}
                    />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={state.hasMore}>
          <div class="flex justify-center pt-4">
            <Button variant="secondary" onClick={loadMore} disabled={archiveQuery.loading}>
              {language.t("settings.archives.action.loadMore")}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  )
}
