import { type Component, type JSX, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@lfcode-ai/ui/button"
import { Switch } from "@lfcode-ai/ui/switch"
import { TextField } from "@lfcode-ai/ui/text-field"
import { showToast } from "@lfcode-ai/ui/toast"
import type {
  BrowserCacheOverview,
  BrowserCookieRecord,
  BrowserPasswordStorageState,
  SavedBrowserLoginRecord,
} from "@lfcode-ai/shared/desktop-browser-management"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { normalizeBrowserURL } from "@/pages/session/helpers"
import { BROWSER_LOGINS_UPDATED_EVENT } from "@/utils/browser-events"
import {
  filterBrowserBookmarks,
  filterBrowserCookies,
  groupBrowserCookies,
  normalizeBrowserLoginOrigin,
} from "@/utils/browser-settings"
import { SettingsList } from "./settings-list"

function sortLogins(logins: SavedBrowserLoginRecord[]) {
  return [...logins].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    if (a.origin !== b.origin) return a.origin.localeCompare(b.origin)
    return a.username.localeCompare(b.username)
  })
}

function formatDate(value: number | null, language: ReturnType<typeof useLanguage>) {
  if (!value) return language.t("settings.browser.cookies.session")
  return new Date(value * 1000).toLocaleString()
}

function formatCacheBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export const SettingsBrowser: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const desktop = createMemo(() => platform.platform === "desktop")
  const [bookmarkQuery, setBookmarkQuery] = createSignal("")
  const [cookieQuery, setCookieQuery] = createSignal("")
  const [loginQuery, setLoginQuery] = createSignal("")
  const [bookmarkDraft, setBookmarkDraft] = createStore({
    id: "",
    title: "",
    url: "",
  })
  const [loginDraft, setLoginDraft] = createStore({
    id: "",
    origin: "",
    username: "",
    password: "",
    passwordEncrypted: "",
  })
  const [cookieState, setCookieState] = createStore({
    loading: false,
    error: "",
    items: [] as BrowserCookieRecord[],
  })
  const [loginState, setLoginState] = createStore({
    loading: false,
    error: "",
    items: [] as SavedBrowserLoginRecord[],
  })
  const [cacheState, setCacheState] = createStore({
    loading: false,
    error: "",
    value: {
      cacheSizeBytes: 0,
      indexedEntryCount: 0,
      lastSeenAt: null,
    } as BrowserCacheOverview,
  })
  const [passwordState, setPasswordState] = createSignal<BrowserPasswordStorageState>({ available: false })
  const [passwordStateReady, setPasswordStateReady] = createSignal(false)

  const filteredBookmarks = createMemo(() => filterBrowserBookmarks(settings.browser.bookmarks(), bookmarkQuery()))
  const filteredCookieGroups = createMemo(() => groupBrowserCookies(filterBrowserCookies(cookieState.items, cookieQuery())))
  const filteredLogins = createMemo(() => {
    const term = loginQuery().trim().toLowerCase()
    const items = sortLogins(loginState.items)
    if (!term) return items
    return items.filter((item) => [item.origin, item.username].some((value) => value.toLowerCase().includes(term)))
  })

  const loadCookies = async () => {
    if (!desktop() || !platform.listBrowserCookies) return
    setCookieState("loading", true)
    setCookieState("error", "")
    try {
      setCookieState("items", await platform.listBrowserCookies())
    } catch (error) {
      setCookieState("error", error instanceof Error ? error.message : String(error))
    } finally {
      setCookieState("loading", false)
    }
  }

  const loadCacheOverview = async () => {
    if (!desktop() || !platform.getBrowserCacheOverview) return
    setCacheState("loading", true)
    setCacheState("error", "")
    try {
      setCacheState("value", await platform.getBrowserCacheOverview())
    } catch (error) {
      setCacheState("error", error instanceof Error ? error.message : String(error))
    } finally {
      setCacheState("loading", false)
    }
  }

  const loadLogins = async () => {
    if (!desktop() || !platform.listSavedBrowserLogins) return
    setLoginState("loading", true)
    setLoginState("error", "")
    try {
      const next = await platform.listSavedBrowserLogins()
      setLoginState("items", sortLogins(next))
    } catch (error) {
      setLoginState("error", error instanceof Error ? error.message : String(error))
    } finally {
      setLoginState("loading", false)
    }
  }

  const loadPasswordState = async () => {
    if (!desktop() || !platform.getBrowserPasswordStorageState) {
      setPasswordState({ available: false })
      setPasswordStateReady(true)
      return
    }
    setPasswordState(await platform.getBrowserPasswordStorageState().catch(() => ({ available: false as const })))
    setPasswordStateReady(true)
  }

  onMount(() => {
    void loadCacheOverview()
    void loadPasswordState()
    void loadCookies()
    void loadLogins()

    const refreshLogins = () => {
      void loadLogins()
      void loadPasswordState()
    }
    window.addEventListener(BROWSER_LOGINS_UPDATED_EVENT, refreshLogins)
    onCleanup(() => {
      window.removeEventListener(BROWSER_LOGINS_UPDATED_EVENT, refreshLogins)
    })
  })

  createEffect(() => {
    if (!desktop()) return
    if (!passwordState().available) return
    if (loginState.items.length > 0) return
    void loadLogins()
  })

  const resetBookmarkDraft = () => {
    setBookmarkDraft({
      id: "",
      title: "",
      url: "",
    })
  }

  const saveBookmark = () => {
    if (!normalizeBrowserURL(bookmarkDraft.url)) {
      showToast({
        title: language.t("settings.browser.toast.invalidBookmark.title"),
        description: language.t("settings.browser.toast.invalidBookmark.description"),
        variant: "error",
      })
      return
    }
    const id = bookmarkDraft.id || globalThis.crypto.randomUUID()
    settings.browser.upsertBookmark({ id, title: bookmarkDraft.title, url: bookmarkDraft.url })
    resetBookmarkDraft()
  }

  const removeBookmark = (id: string) => {
    settings.browser.removeBookmark(id)
  }

  const editBookmark = (id: string) => {
    const current = settings.browser.bookmarks().find((item) => item.id === id)
    if (!current) return
    setBookmarkDraft({
      id: current.id,
      title: current.title,
      url: current.url,
    })
  }

  const resetLoginDraft = () => {
    setLoginDraft({
      id: "",
      origin: "",
      username: "",
      password: "",
      passwordEncrypted: "",
    })
  }

  const saveLogin = async () => {
    if (!platform.upsertSavedBrowserLogin) return
    const origin = normalizeBrowserLoginOrigin(loginDraft.origin)
    if (!origin) {
      showToast({
        title: language.t("settings.browser.toast.invalidOrigin.title"),
        description: language.t("settings.browser.toast.invalidOrigin.description"),
        variant: "error",
      })
      return
    }
    if (!loginDraft.password.trim() && !loginDraft.passwordEncrypted) {
      showToast({
        title: language.t("settings.browser.toast.passwordRequired.title"),
        description: language.t("settings.browser.toast.passwordRequired.description"),
        variant: "error",
      })
      return
    }
    const record = await platform
      .upsertSavedBrowserLogin({
        id: loginDraft.id || undefined,
        origin,
        username: loginDraft.username.trim(),
        password: loginDraft.password.trim() || undefined,
        passwordEncrypted: loginDraft.password.trim() ? undefined : loginDraft.passwordEncrypted,
      })
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
        return
      })
    if (!record) return
    setLoginState("items", sortLogins([...loginState.items.filter((item) => item.id !== loginDraft.id), record]))
    resetLoginDraft()
    window.dispatchEvent(new Event(BROWSER_LOGINS_UPDATED_EVENT))
  }

  const editLogin = (id: string) => {
    const current = loginState.items.find((item) => item.id === id)
    if (!current) return
    setLoginDraft({
      id: current.id,
      origin: current.origin,
      username: current.username,
      password: "",
      passwordEncrypted: current.passwordEncrypted,
    })
  }

  const deleteLogin = async (id: string) => {
    if (!platform.deleteSavedBrowserLogin) return
    const ok = await platform.deleteSavedBrowserLogin(id).then(
      () => true,
      (error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
        return false
      },
    )
    if (!ok) return
    setLoginState("items", loginState.items.filter((item) => item.id !== id))
    window.dispatchEvent(new Event(BROWSER_LOGINS_UPDATED_EVENT))
  }

  const deleteCookie = async (cookie: BrowserCookieRecord) => {
    if (!platform.removeBrowserCookie) return
    const ok = await platform.removeBrowserCookie(cookie).then(
      () => true,
      (error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
          variant: "error",
        })
        return false
      },
    )
    if (!ok) return
    setCookieState(
      "items",
      cookieState.items.filter(
        (item) =>
          !(
            item.name === cookie.name &&
            item.domain === cookie.domain &&
            item.path === cookie.path &&
            item.secure === cookie.secure
          ),
      ),
    )
  }

  const clearCookiesByDomain = async (domain: string) => {
    if (!platform.clearBrowserCookiesByDomain) return
    const cleared = await platform.clearBrowserCookiesByDomain(domain).catch((error) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
      return -1
    })
    if (cleared < 0) return
    setCookieState("items", cookieState.items.filter((item) => item.domain.replace(/^\./, "").toLowerCase() !== domain))
  }

  const clearAllCookies = async () => {
    if (!platform.clearAllBrowserCookies) return
    const cleared = await platform.clearAllBrowserCookies().catch((error) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
      return -1
    })
    if (cleared < 0) return
    setCookieState("items", [])
  }

  const clearCache = async () => {
    if (!platform.clearBrowserCache) return
    setCacheState("loading", true)
    setCacheState("error", "")
    try {
      setCacheState("value", await platform.clearBrowserCache())
    } catch (error) {
      setCacheState("error", error instanceof Error ? error.message : String(error))
    } finally {
      setCacheState("loading", false)
    }
  }

  return (
    <div class="h-full w-full px-5 pb-10 pt-5 sm:px-8">
      <div class="mx-auto flex max-w-[1080px] flex-col gap-6">
        <SettingsSection title={language.t("settings.browser.section.bookmarks.title")} description={language.t("settings.browser.section.bookmarks.description")}>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.browser.bookmarks.search.title")}
              description={language.t("settings.browser.bookmarks.search.description")}
            >
              <TextField value={bookmarkQuery()} onChange={setBookmarkQuery} placeholder={language.t("settings.browser.bookmarks.search.placeholder")} />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.browser.bookmarks.editor.title")}
              description={language.t("settings.browser.bookmarks.editor.description")}
            >
              <div class="flex w-full min-w-0 flex-col gap-2 sm:w-[340px]">
                <TextField value={bookmarkDraft.title} onChange={(value) => setBookmarkDraft("title", value)} placeholder={language.t("settings.browser.bookmarks.field.title")} />
                <TextField value={bookmarkDraft.url} onChange={(value) => setBookmarkDraft("url", value)} placeholder={language.t("settings.browser.bookmarks.field.url")} />
                <div class="flex justify-end gap-2">
                  <Show when={bookmarkDraft.id}>
                    <Button variant="secondary" size="small" onClick={resetBookmarkDraft}>
                      {language.t("common.cancel")}
                    </Button>
                  </Show>
                  <Button size="small" onClick={saveBookmark}>
                    {bookmarkDraft.id ? language.t("common.save") : language.t("settings.browser.action.add")}
                  </Button>
                </div>
              </div>
            </SettingsRow>
            <Show
              when={filteredBookmarks().length > 0}
              fallback={<EmptyState>{language.t("settings.browser.bookmarks.empty")}</EmptyState>}
            >
              <For each={filteredBookmarks()}>
                {(bookmark) => (
                  <div class="flex flex-wrap items-center gap-3 border-b border-border-weak-base py-3 last:border-none sm:flex-nowrap">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-14-medium text-text-strong">{bookmark.title}</div>
                      <div class="truncate text-12-regular text-text-weak">{bookmark.url}</div>
                    </div>
                    <div class="flex shrink-0 gap-2">
                      <Button size="small" variant="secondary" onClick={() => platform.openLink(bookmark.url)}>
                        {language.t("settings.browser.action.open")}
                      </Button>
                      <Button size="small" variant="secondary" onClick={() => editBookmark(bookmark.id)}>
                        {language.t("common.edit")}
                      </Button>
                      <Button size="small" variant="secondary" onClick={() => removeBookmark(bookmark.id)}>
                        {language.t("common.delete")}
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </SettingsSection>

        <SettingsSection title={language.t("settings.browser.section.cache.title")} description={language.t("settings.browser.section.cache.description")}>
          <Show when={desktop() && platform.getBrowserCacheOverview && platform.clearBrowserCache} fallback={<UnavailableCard>{language.t("settings.browser.unavailable.cache.web")}</UnavailableCard>}>
            <SettingsList>
              <SettingsRow
                title={language.t("settings.browser.cache.summary.title")}
                description={language.t("settings.browser.cache.summary.description")}
              >
                <div class="flex w-full gap-2 sm:w-auto">
                  <Button size="small" variant="secondary" onClick={() => void loadCacheOverview()} disabled={cacheState.loading}>
                    {language.t("settings.browser.action.refresh")}
                  </Button>
                  <Button size="small" variant="secondary" onClick={() => void clearCache()} disabled={cacheState.loading}>
                    {language.t("settings.browser.action.clearAll")}
                  </Button>
                </div>
              </SettingsRow>
              <Show when={cacheState.error}>
                {(value) => <EmptyState>{value()}</EmptyState>}
              </Show>
              <Show when={!cacheState.error}>
                <div class="rounded-[20px] border border-border-weak-base bg-surface-base px-4 py-3">
                  <div class="grid gap-2 text-12-regular text-text-weak sm:grid-cols-3">
                    <div>
                      <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{language.t("settings.browser.cache.field.size")}</div>
                      <div class="mt-1 text-14-medium text-text-strong">{formatCacheBytes(cacheState.value.cacheSizeBytes)}</div>
                    </div>
                    <div>
                      <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{language.t("settings.browser.cache.field.indexed")}</div>
                      <div class="mt-1 text-14-medium text-text-strong">{cacheState.value.indexedEntryCount}</div>
                    </div>
                    <div>
                      <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">{language.t("settings.browser.cache.field.lastSeen")}</div>
                      <div class="mt-1 text-14-medium text-text-strong">
                        {cacheState.value.lastSeenAt ? new Date(cacheState.value.lastSeenAt).toLocaleString() : language.t("settings.browser.cache.lastSeen.empty")}
                      </div>
                    </div>
                  </div>
                </div>
              </Show>
            </SettingsList>
          </Show>
        </SettingsSection>

        <SettingsSection title={language.t("settings.browser.section.cookies.title")} description={language.t("settings.browser.section.cookies.description")}>
          <Show when={desktop() && platform.listBrowserCookies} fallback={<UnavailableCard>{language.t("settings.browser.unavailable.cookies.web")}</UnavailableCard>}>
            <SettingsList>
              <SettingsRow
                title={language.t("settings.browser.cookies.search.title")}
                description={language.t("settings.browser.cookies.search.description")}
              >
                <div class="flex w-full gap-2 sm:w-[420px]">
                  <TextField value={cookieQuery()} onChange={setCookieQuery} placeholder={language.t("settings.browser.cookies.search.placeholder")} />
                  <Button size="small" variant="secondary" onClick={() => void loadCookies()} disabled={cookieState.loading}>
                    {language.t("settings.browser.action.refresh")}
                  </Button>
                  <Button size="small" variant="secondary" onClick={() => void clearAllCookies()} disabled={cookieState.loading}>
                    {language.t("settings.browser.action.clearAll")}
                  </Button>
                </div>
              </SettingsRow>
              <Show when={cookieState.error}>
                {(value) => <EmptyState>{value()}</EmptyState>}
              </Show>
              <Show
                when={!cookieState.error && filteredCookieGroups().length > 0}
                fallback={<EmptyState>{cookieState.loading ? language.t("common.loading") : language.t("settings.browser.cookies.empty")}</EmptyState>}
              >
                <For each={filteredCookieGroups()}>
                  {(group) => (
                    <div class="border-b border-border-weak-base py-3 last:border-none">
                      <div class="mb-3 flex items-center justify-between gap-3">
                        <div class="text-13-medium text-text-strong">{group.domain}</div>
                        <Button size="small" variant="secondary" onClick={() => void clearCookiesByDomain(group.domain)}>
                          {language.t("settings.browser.action.clearDomain")}
                        </Button>
                      </div>
                      <div class="space-y-2">
                        <For each={group.items}>
                          {(cookie) => (
                            <div class="rounded-xl border border-border-weak-base px-3 py-2">
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="text-13-medium text-text-strong">{cookie.name}</div>
                                <Button size="small" variant="secondary" onClick={() => void deleteCookie(cookie)}>
                                  {language.t("common.delete")}
                                </Button>
                              </div>
                              <div class="mt-2 grid gap-1 text-12-regular text-text-weak sm:grid-cols-2">
                                <div>{language.t("settings.browser.cookies.field.path")}: {cookie.path}</div>
                                <div>{language.t("settings.browser.cookies.field.sameSite")}: {cookie.sameSite}</div>
                                <div>{language.t("settings.browser.cookies.field.secure")}: {cookie.secure ? "true" : "false"}</div>
                                <div>{language.t("settings.browser.cookies.field.httpOnly")}: {cookie.httpOnly ? "true" : "false"}</div>
                                <div>{language.t("settings.browser.cookies.field.session")}: {cookie.session ? "true" : "false"}</div>
                                <div>{language.t("settings.browser.cookies.field.expires")}: {formatDate(cookie.expirationDate, language)}</div>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </SettingsList>
          </Show>
        </SettingsSection>

        <SettingsSection title={language.t("settings.browser.section.autofill.title")} description={language.t("settings.browser.section.autofill.description")}>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.browser.autofill.enabled.title")}
              description={language.t("settings.browser.autofill.enabled.description")}
            >
              <Switch checked={settings.browser.autofillEnabled()} onChange={settings.browser.setAutofillEnabled} />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.browser.autofill.prompt.title")}
              description={language.t("settings.browser.autofill.prompt.description")}
            >
              <Switch checked={settings.browser.promptToSavePasswords()} onChange={settings.browser.setPromptToSavePasswords} />
            </SettingsRow>
          </SettingsList>
        </SettingsSection>

        <SettingsSection title={language.t("settings.browser.section.logins.title")} description={language.t("settings.browser.section.logins.description")}>
          <Show when={desktop()} fallback={<UnavailableCard>{language.t("settings.browser.unavailable.logins.web")}</UnavailableCard>}>
            <Show when={passwordStateReady()} fallback={<UnavailableCard>{language.t("common.loading")}</UnavailableCard>}>
              <Show when={passwordState().available} fallback={<UnavailableCard>{language.t("settings.browser.unavailable.logins.storage")}</UnavailableCard>}>
              <SettingsList>
                <SettingsRow
                  title={language.t("settings.browser.logins.search.title")}
                  description={language.t("settings.browser.logins.search.description")}
                >
                  <div class="flex w-full gap-2 sm:w-[420px]">
                    <TextField value={loginQuery()} onChange={setLoginQuery} placeholder={language.t("settings.browser.logins.search.placeholder")} />
                    <Button size="small" variant="secondary" onClick={() => void loadLogins()} disabled={loginState.loading}>
                      {language.t("settings.browser.action.refresh")}
                    </Button>
                  </div>
                </SettingsRow>
                <SettingsRow
                  title={language.t("settings.browser.logins.editor.title")}
                  description={language.t("settings.browser.logins.editor.description")}
                >
                  <div class="flex w-full min-w-0 flex-col gap-2 sm:w-[360px]">
                    <TextField value={loginDraft.origin} onChange={(value) => setLoginDraft("origin", value)} placeholder={language.t("settings.browser.logins.field.origin")} />
                    <TextField value={loginDraft.username} onChange={(value) => setLoginDraft("username", value)} placeholder={language.t("settings.browser.logins.field.username")} />
                    <TextField type="password" value={loginDraft.password} onChange={(value) => setLoginDraft("password", value)} placeholder={language.t("settings.browser.logins.field.password")} />
                    <div class="flex justify-end gap-2">
                      <Show when={loginDraft.id}>
                        <Button variant="secondary" size="small" onClick={resetLoginDraft}>
                          {language.t("common.cancel")}
                        </Button>
                      </Show>
                      <Button size="small" onClick={() => void saveLogin()}>
                        {loginDraft.id ? language.t("common.save") : language.t("settings.browser.action.add")}
                      </Button>
                    </div>
                  </div>
                </SettingsRow>
                <Show when={loginState.error}>
                  {(value) => <EmptyState>{value()}</EmptyState>}
                </Show>
                <Show
                  when={!loginState.error && filteredLogins().length > 0}
                  fallback={<EmptyState>{loginState.loading ? language.t("common.loading") : language.t("settings.browser.logins.empty")}</EmptyState>}
                >
                  <For each={filteredLogins()}>
                    {(login) => (
                      <div class="flex flex-wrap items-center gap-3 border-b border-border-weak-base py-3 last:border-none sm:flex-nowrap">
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-14-medium text-text-strong">{login.username || language.t("settings.browser.logins.usernameEmpty")}</div>
                          <div class="truncate text-12-regular text-text-weak">{login.origin}</div>
                        </div>
                        <div class="flex shrink-0 gap-2">
                          <Button size="small" variant="secondary" onClick={() => editLogin(login.id)}>
                            {language.t("common.edit")}
                          </Button>
                          <Button size="small" variant="secondary" onClick={() => void deleteLogin(login.id)}>
                            {language.t("common.delete")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </SettingsList>
              </Show>
            </Show>
          </Show>
        </SettingsSection>
      </div>
    </div>
  )
}

const SettingsSection: Component<{
  title: string
  description?: string
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-col gap-2">
      <div>
        <h3 class="pb-1 text-14-medium text-text-strong">{props.title}</h3>
        <Show when={props.description}>
          {(value) => <div class="text-12-regular text-text-weak">{value()}</div>}
        </Show>
      </div>
      {props.children}
    </div>
  )
}

const SettingsRow: Component<{
  title: string
  description: string
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 border-b border-border-weak-base py-3 last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}

const UnavailableCard: Component<{ children: JSX.Element }> = (props) => {
  return (
    <div class="rounded-[24px] border border-border-weak-base bg-surface-base px-5 py-4 text-12-regular text-text-weak">
      {props.children}
    </div>
  )
}

const EmptyState: Component<{ children: JSX.Element }> = (props) => {
  return <div class="py-3 text-12-regular text-text-weak">{props.children}</div>
}
