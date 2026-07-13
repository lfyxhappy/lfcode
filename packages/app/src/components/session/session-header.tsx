import { AppIcon } from "@lfcode-ai/ui/app-icon"
import { Button } from "@lfcode-ai/ui/button"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { Icon } from "@lfcode-ai/ui/icon"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Keybind } from "@lfcode-ai/ui/keybind"
import { Spinner } from "@lfcode-ai/ui/spinner"
import { showToast } from "@lfcode-ai/ui/toast"
import { Tooltip, TooltipKeybind } from "@lfcode-ai/ui/tooltip"
import { getFilename } from "@lfcode-ai/shared/util/path"
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useSearchParams } from "@solidjs/router"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { focusTerminalById } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { messageAgentColor } from "@/utils/agent"
import { decode64 } from "@/utils/base64"
import { formatServerError } from "@/utils/server-errors"
import { Persist, persisted } from "@/utils/persist"
import { StatusPopover } from "../status-popover"
import { MaintenanceStatusPill } from "./maintenance-status-pill"
import { BROWSER_REQUEST_OPEN_EVENT, createBrowserRequestID, DEFAULT_BROWSER_URL } from "@/pages/session/helpers"
import { LINUX_APPS, MAC_APPS, OPEN_APPS, type OpenApp, WINDOWS_APPS } from "./session-open-apps"
type OS = "macos" | "windows" | "linux" | "unknown"

const detectOS = (platform: ReturnType<typeof usePlatform>): OS => {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

const showRequestError = (language: ReturnType<typeof useLanguage>, err: unknown) => {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: formatServerError(err, language.t, language.t("common.requestFailed")),
  })
}

export function SessionHeader() {
  const layout = useLayout()
  const command = useCommand()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const globalSDK = useGlobalSDK()
  const sync = useSync()
  const terminal = useTerminal()
  const { params, view, sessionKey } = useSessionLayout()
  const [searchParams, setSearchParams] = useSearchParams<{ agentID?: string }>()
  const sessionActors = createMemo(() => (params.id ? sync.data.actor[params.id] ?? [] : []))
  const subagents = createMemo(() => sessionActors().filter((actor) => actor.mode === "subagent").toSorted((a, b) => a.time.created - b.time.created))
  const activeView = createMemo(() => {
    const agentID = searchParams.agentID ?? "main"
    if (agentID === "main") return "main"
    if (subagents().some((actor) => actor.actorID === agentID)) return agentID
    return "main"
  })

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))
  const os = createMemo(() => detectOS(platform))
  const isDesktopBeta = platform.platform === "desktop" && import.meta.env.VITE_LFCODE_CHANNEL === "beta"
  const search = createMemo(() => !isDesktopBeta || settings.general.showSearch())
  const tree = createMemo(() => !isDesktopBeta || settings.general.showFileTree())
  const term = createMemo(() => !isDesktopBeta || settings.general.showTerminal())
  const status = createMemo(() => !isDesktopBeta || settings.general.showStatus())

  const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({
    finder: true,
  })

  const apps = createMemo(() => {
    if (os() === "macos") return MAC_APPS
    if (os() === "windows") return WINDOWS_APPS
    return LINUX_APPS
  })

  const fileManager = createMemo(() => {
    if (os() === "macos") return { label: "session.header.open.finder", icon: "finder" as const }
    if (os() === "windows") return { label: "session.header.open.fileExplorer", icon: "file-explorer" as const }
    return { label: "session.header.open.fileManager", icon: "finder" as const }
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!platform.checkAppExists) return

    const list = apps()

    setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

    void Promise.all(
      list.map((app) =>
        Promise.resolve(platform.checkAppExists?.(app.openWith))
          .then((value) => Boolean(value))
          .catch(() => false)
          .then((ok) => [app.id, ok] as const),
      ),
    ).then((entries) => {
      setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
    })
  })

  const options = createMemo(() => {
    return [
      { id: "finder", label: language.t(fileManager().label), icon: fileManager().icon },
      ...apps()
        .filter((app) => exists[app.id])
        .map((app) => ({ ...app, label: language.t(app.label) })),
    ] as const
  })

  const toggleTerminal = () => {
    const next = !view().terminal.opened()
    view().terminal.toggle()
    if (!next) return

    const id = terminal.active()
    if (!id) return
    focusTerminalById(id)
  }

  const openBrowser = () => {
    window.dispatchEvent(
      new CustomEvent(BROWSER_REQUEST_OPEN_EVENT, {
        detail: {
          requestID: createBrowserRequestID(),
          url: DEFAULT_BROWSER_URL,
          sessionKey: sessionKey(),
          sessionID: params.id,
          reason: "human" as const,
        },
        cancelable: true,
      }),
    )
  }

  const [prefs, setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const [menu, setMenu] = createStore({ open: false })
  const [viewMenu, setViewMenu] = createStore({ open: false })
  const [openRequest, setOpenRequest] = createStore({
    app: undefined as OpenApp | undefined,
  })

  const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
  const current = createMemo(
    () =>
      options().find((o) => o.id === prefs.app) ??
      options()[0] ??
      ({ id: "finder", label: fileManager().label, icon: fileManager().icon } as const),
  )
  const opening = createMemo(() => openRequest.app !== undefined)
  const tint = createMemo(() =>
    messageAgentColor(params.id ? sync.data.message[params.id] : undefined, sync.data.agent),
  )

  const selectApp = (app: OpenApp) => {
    if (!options().some((item) => item.id === app)) return
    setPrefs("app", app)
  }

  const openDir = (app: OpenApp) => {
    if (opening() || !canOpen() || !platform.openPath) return
    const directory = projectDirectory()
    if (!directory) return

    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    setOpenRequest("app", app)
    platform
      .openPath(directory, openWith)
      .catch((err: unknown) => showRequestError(language, err))
      .finally(() => {
        setOpenRequest("app", undefined)
      })
  }

  const copyPath = () => {
    const directory = projectDirectory()
    if (!directory) return
    navigator.clipboard
      .writeText(directory)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: directory,
        })
      })
      .catch((err: unknown) => showRequestError(language, err))
  }

  const viewLabel = (agentID: string) => {
    if (agentID === "main") return "返回主对话"
    return subagents().find((actor) => actor.actorID === agentID)?.description ?? agentID
  }

  const destroySubagent = async (actorID: string) => {
    if (!params.id) return
    const actor = subagents().find((item) => item.actorID === actorID)
    if (!actor) return
    if (!window.confirm(`销毁子对话 "${actor.description}"？`)) return
    try {
      await globalSDK.client.session.deleteActor({ sessionID: params.id, actorID })
      if (searchParams.agentID === actorID) setSearchParams({ agentID: undefined })
    } catch (err) {
      showRequestError(language, err)
    }
  }

  const [centerMount, setCenterMount] = createSignal<HTMLElement | null>(null)
  const [rightMount, setRightMount] = createSignal<HTMLElement | null>(null)
  onMount(() => {
    setCenterMount(document.getElementById("lfcode-titlebar-center"))
    setRightMount(document.getElementById("lfcode-titlebar-right"))
  })

  return (
    <>
      <Show when={search() && centerMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="hidden md:flex w-[240px] max-w-full min-w-0 items-center gap-2 justify-between rounded-md border border-border-weak-base bg-surface-panel shadow-none cursor-default"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center overflow-visible">
                <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
                  {language.t("session.header.search.placeholder", {
                    project: name(),
                  })}
                </span>
              </div>

              <Show when={hotkey()}>
                {(keybind) => (
                  <Keybind class="shrink-0 !border-0 !bg-transparent !shadow-none px-0 text-text-weaker">
                    {keybind()}
                  </Keybind>
                )}
              </Show>
            </Button>
          </Portal>
        )}
      </Show>
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-2">
              <Show when={projectDirectory()}>
                <div class="hidden xl:flex items-center">
                  <Show
                    when={canOpen()}
                    fallback={
                      <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-surface-panel overflow-hidden">
                        <Button
                          variant="ghost"
                          class="rounded-none h-full py-0 pr-3 pl-0.5 gap-1.5 border-none shadow-none"
                          onClick={copyPath}
                          aria-label={language.t("session.header.open.copyPath")}
                        >
                          <Icon name="copy" size="small" class="text-icon-base" />
                          <span class="text-12-regular text-text-strong">
                            {language.t("session.header.open.copyPath")}
                          </span>
                        </Button>
                      </div>
                    }
                  >
                    <div class="flex items-center">
                      <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-surface-panel overflow-hidden">
                        <Button
                          variant="ghost"
                          class="rounded-none h-full px-0.5 border-none shadow-none disabled:!cursor-default"
                          classList={{
                            "bg-surface-raised-base-active": opening(),
                          }}
                          onClick={() => openDir(current().id)}
                          disabled={opening()}
                          aria-label={language.t("session.header.open.ariaLabel", { app: current().label })}
                        >
                          <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                            <Show when={opening()} fallback={<AppIcon id={current().icon} />}>
                              <Spinner class="size-3.5" style={{ color: tint() ?? "var(--icon-base)" }} />
                            </Show>
                          </div>
                        </Button>
                        <DropdownMenu
                          gutter={4}
                          placement="bottom-end"
                          open={menu.open}
                          onOpenChange={(open) => setMenu("open", open)}
                        >
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="chevron-down"
                            variant="ghost"
                            disabled={opening()}
                            class="rounded-none h-full w-[20px] p-0 border-none shadow-none data-[expanded]:bg-surface-raised-base-active disabled:!cursor-default"
                            classList={{
                              "bg-surface-raised-base-active": opening(),
                            }}
                            aria-label={language.t("session.header.open.menu")}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="[&_[data-slot=dropdown-menu-item]]:pl-1 [&_[data-slot=dropdown-menu-radio-item]]:pl-1 [&_[data-slot=dropdown-menu-radio-item]+[data-slot=dropdown-menu-radio-item]]:mt-1">
                              <DropdownMenu.Group>
                                <DropdownMenu.GroupLabel class="!px-1 !py-1">
                                  {language.t("session.header.openIn")}
                                </DropdownMenu.GroupLabel>
                                <DropdownMenu.RadioGroup
                                  class="mt-1"
                                  value={current().id}
                                  onChange={(value) => {
                                    if (!OPEN_APPS.includes(value as OpenApp)) return
                                    selectApp(value as OpenApp)
                                  }}
                                >
                                  <For each={options()}>
                                    {(o) => (
                                      <DropdownMenu.RadioItem
                                        value={o.id}
                                        disabled={opening()}
                                        onSelect={() => {
                                          setMenu("open", false)
                                          openDir(o.id)
                                        }}
                                      >
                                        <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                                          <AppIcon id={o.icon} />
                                        </div>
                                        <DropdownMenu.ItemLabel>{o.label}</DropdownMenu.ItemLabel>
                                        <DropdownMenu.ItemIndicator>
                                          <Icon name="check-small" size="small" class="text-icon-weak" />
                                        </DropdownMenu.ItemIndicator>
                                      </DropdownMenu.RadioItem>
                                    )}
                                  </For>
                                </DropdownMenu.RadioGroup>
                              </DropdownMenu.Group>
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setMenu("open", false)
                                  copyPath()
                                }}
                              >
                                <div class="flex size-5 shrink-0 items-center justify-center">
                                  <Icon name="copy" size="small" class="text-icon-weak" />
                                </div>
                                <DropdownMenu.ItemLabel>
                                  {language.t("session.header.open.copyPath")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
              <div class="flex items-center gap-1">
                <MaintenanceStatusPill sessionID={params.id} />
                <Show when={params.id && sessionActors().length > 0}>
                  <DropdownMenu gutter={4} placement="bottom-end" open={viewMenu.open} onOpenChange={(open) => setViewMenu("open", open)}>
                    <DropdownMenu.Trigger
                      as={Button}
                      variant="ghost"
                      class="h-6 max-w-[180px] gap-1.5 px-2 text-12-medium text-text-strong border border-border-weak-base bg-surface-panel shadow-none"
                      aria-label={language.t("session.header.open.menu")}
                    >
                      <span class="truncate">{viewLabel(activeView())}</span>
                      <Icon name="chevron-down" size="small" class="text-icon-weak" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="min-w-[220px]">
                        <DropdownMenu.RadioGroup
                          value={activeView()}
                          onChange={(value) => {
                            setSearchParams({ agentID: value === "main" ? undefined : `${value}` })
                            setViewMenu("open", false)
                          }}
                        >
                          <DropdownMenu.RadioItem value="main" class="font-medium">
                            <DropdownMenu.ItemLabel>返回主对话</DropdownMenu.ItemLabel>
                            <DropdownMenu.ItemIndicator>
                              <Icon name="check-small" size="small" class="text-icon-weak" />
                            </DropdownMenu.ItemIndicator>
                          </DropdownMenu.RadioItem>
                          <For each={subagents()}>
                            {(actor) => (
                              <DropdownMenu.RadioItem value={actor.actorID}>
                                <div class="flex flex-col min-w-0">
                                  <DropdownMenu.ItemLabel class="truncate">{actor.description}</DropdownMenu.ItemLabel>
                                  <div class="text-11-regular text-text-weak">
                                    {actor.actorID} · {actor.status}
                                  </div>
                                </div>
                                <DropdownMenu.ItemIndicator>
                                  <Icon name="check-small" size="small" class="text-icon-weak" />
                                </DropdownMenu.ItemIndicator>
                              </DropdownMenu.RadioItem>
                            )}
                          </For>
                        </DropdownMenu.RadioGroup>
                        <DropdownMenu.Separator />
                        <For each={subagents()}>
                          {(actor) => (
                            <DropdownMenu.Item
                              onSelect={async () => {
                                setViewMenu("open", false)
                                await destroySubagent(actor.actorID)
                              }}
                            >
                              <DropdownMenu.ItemLabel>销毁 {actor.description}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          )}
                        </For>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </Show>
                <Show when={status()}>
                  <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
              <StatusPopover directory={projectDirectory()} sessionID={params.id} />
                  </Tooltip>
                </Show>
                <Show when={term()}>
                  <TooltipKeybind
                    title={language.t("command.terminal.toggle")}
                    keybind={command.keybind("terminal.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="group/terminal-toggle titlebar-icon w-8 h-6 p-0 box-border shrink-0"
                      onClick={toggleTerminal}
                      aria-label={language.t("command.terminal.toggle")}
                      aria-expanded={view().terminal.opened()}
                      aria-controls="terminal-panel"
                    >
                      <Icon size="small" name={view().terminal.opened() ? "terminal-active" : "terminal"} />
                    </Button>
                  </TooltipKeybind>
                </Show>

                <div class="hidden md:flex items-center gap-1 shrink-0">
                  <Tooltip placement="bottom" value={language.t("command.browser.open")}>
                    <Button
                      variant="ghost"
                      class="titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={openBrowser}
                      aria-label={language.t("command.browser.open")}
                      aria-controls="review-panel"
                    >
                      <Icon size="small" name="window-cursor" />
                    </Button>
                  </Tooltip>
                  <Show when={params.id}>
                    <Tooltip placement="bottom" value={language.t("session.header.summary.toggle")}>
                      <Button
                        variant="ghost"
                        class="titlebar-icon w-8 h-6 p-0 box-border"
                        onClick={() => view().summaryCard.toggle()}
                        aria-label={language.t("session.header.summary.toggle")}
                        aria-expanded={view().summaryCard.opened()}
                        aria-controls="session-jobs-rail"
                      >
                        <Icon
                          size="small"
                          name="sliders"
                          classList={{
                            "text-icon-strong": view().summaryCard.opened(),
                            "text-icon-weak": !view().summaryCard.opened(),
                          }}
                        />
                      </Button>
                    </Tooltip>
                  </Show>
                  <TooltipKeybind
                    title={language.t("command.review.toggle")}
                    keybind={command.keybind("review.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="group/review-toggle titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={() => {
                        if (!view().reviewPanel.opened()) view().setReviewEnabled(true)
                        view().reviewPanel.toggle()
                      }}
                      aria-label={language.t("command.review.toggle")}
                      aria-expanded={view().reviewPanel.opened()}
                      aria-controls="review-panel"
                    >
                      <Icon size="small" name={view().reviewPanel.opened() ? "review-active" : "review"} />
                    </Button>
                  </TooltipKeybind>

                  <Show when={tree()}>
                    <TooltipKeybind
                      title={language.t("command.fileTree.toggle")}
                      keybind={command.keybind("fileTree.toggle")}
                    >
                      <Button
                        variant="ghost"
                        class="titlebar-icon w-8 h-6 p-0 box-border"
                        onClick={() => layout.fileTree.toggle()}
                        aria-label={language.t("command.fileTree.toggle")}
                        aria-expanded={layout.fileTree.opened()}
                        aria-controls="file-tree-panel"
                      >
                        <div class="relative flex items-center justify-center size-4">
                          <Icon
                            size="small"
                            name={layout.fileTree.opened() ? "file-tree-active" : "file-tree"}
                            classList={{
                              "text-icon-strong": layout.fileTree.opened(),
                              "text-icon-weak": !layout.fileTree.opened(),
                            }}
                          />
                        </div>
                      </Button>
                    </TooltipKeybind>
                  </Show>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
