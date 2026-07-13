import { For, Match, Show, Switch, batch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { Button } from "@lfcode-ai/ui/button"
import { IconButton } from "@lfcode-ai/ui/icon-button"
import { Icon } from "@lfcode-ai/ui/icon"
import { TextField } from "@lfcode-ai/ui/text-field"
import { TooltipKeybind } from "@lfcode-ai/ui/tooltip"
import { ResizeHandle } from "@lfcode-ai/ui/resize-handle"
import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { SnapshotFileDiff, VcsFileDiff } from "@lfcode-ai/sdk/v2"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"

import FileTree from "@/components/file-tree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useTerminal } from "@/context/terminal"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import {
  browserTab,
  browserTabID,
  createBrowserTabID,
  createOpenSessionFileTab,
  createSessionTabs,
  DEFAULT_BROWSER_URL,
  formatBrowserTabLabel,
  getTabReorderIndex,
  isBrowserTab,
  isSideChatTab,
  sideChatTabID,
  type Sizing,
} from "@/pages/session/helpers"
import { buildDetachedSidePanelRoute } from "@/pages/session/detached-side-panel"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { BrowserKeepaliveSlot } from "@/pages/session/browser-keepalive-host"
import { SideChatPanel } from "@/pages/session/side-chat-panel"

type LauncherItem = {
  id: "review" | "terminal" | "browser" | "files" | "side-chat"
  label: string
  icon: "brain" | "terminal" | "window-cursor" | "folder" | "prompt"
  keybind: string
  disabled: boolean
}

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  onOpenSideChat: () => void
  onCloseSideChat?: (sessionID: string) => void
  onAddToChat?: (input: { text: string; messageID?: string; sessionID?: string }) => void
  onAskSideChat?: (input: { text: string; messageID?: string; sessionID?: string }) => void
  setActiveSideChatContentRef?: (el: HTMLDivElement | undefined) => void
  setActiveSideChatInputRef?: (el: HTMLDivElement | undefined) => void
}) {
  const layout = useLayout()
  const platform = usePlatform()
  const settings = useSettings()
  const file = useFile()
  const terminal = useTerminal()
  const language = useLanguage()
  const command = useCommand()
  const { params, sessionKey, tabs, view } = useSessionLayout()

  const isDesktop = createMemo(() => platform.platform === "desktop")
  const shown = createMemo(
    () =>
      platform.platform !== "desktop" ||
      import.meta.env.VITE_LFCODE_CHANNEL !== "beta" ||
      settings.general.showFileTree(),
  )

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(() => isDesktop() && shown() && layout.fileTree.opened())
  const open = createMemo(() => reviewOpen() || fileOpen())
  const reviewTab = createMemo(() => isDesktop() && view().reviewEnabled())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return `calc(100% - ${layout.session.width()}px)`
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${layout.fileTree.width()}px` : "0px"))

  const diffFiles = createMemo(() => props.diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of props.diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  let explicitReviewActivation = false
  let explicitReviewActivationTimer: number | undefined
  const markExplicitReviewActivation = () => {
    explicitReviewActivation = true
    if (explicitReviewActivationTimer !== undefined) window.clearTimeout(explicitReviewActivationTimer)
    explicitReviewActivationTimer = window.setTimeout(() => {
      explicitReviewActivation = false
      explicitReviewActivationTimer = undefined
    }, 750)
  }

  const openSessionTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: props.canReview,
    detachedTabs: createMemo(() => layout.detachedPanels.listFor(sessionKey)().map((item) => item.tab)),
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const browserTabs = createMemo(() => openedTabs().filter(isBrowserTab))
  const sideChatTabs = createMemo(() => openedTabs().filter(isSideChatTab))
  const sideChatTitle = (tabID: string) => {
    const index = sideChatTabs().findIndex((tab) => sideChatTabID(tab) === tabID)
    if (index === -1) return language.t("session.sideChat.title")
    return language.t("session.sideChat.indexed", { index: index + 1 })
  }
  const openTab = (tab: string) => {
    if (tab === "review" && !explicitReviewActivation && (isSideChatTab(activeTab()) || isBrowserTab(activeTab()))) {
      return
    }
    if (tab === "context" || isBrowserTab(tab) || isSideChatTab(tab)) {
      openReviewPanel()
      tabs().setActive(tab)
      return
    }
    openSessionTab(tab)
  }

  const closeReviewTab = () => {
    batch(() => {
      view().setReviewEnabled(false)
      tabs().close("review")
    })
  }

  const openReviewTab = () => {
    batch(() => {
      view().setReviewEnabled(true)
      openReviewPanel()
      tabs().setActive("review")
    })
  }

  const openContextTab = () => {
    batch(() => {
      openReviewPanel()
      void tabs().open("context")
      tabs().setActive("context")
    })
  }

  const openBrowserTab = () => {
    const id = createBrowserTabID()
    batch(() => {
      view().browser.open(id, DEFAULT_BROWSER_URL)
      openReviewPanel()
      tabs().setActive(browserTab(id))
    })
  }

  const openTerminalTab = () => {
    if (terminal.all().length > 0) terminal.new()
    view().terminal.open()
  }

  const openSideChatLauncher = () => {
    props.onOpenSideChat()
  }

  const launcherItems = createMemo<LauncherItem[]>(() => [
    {
      id: "review" as const,
      label: "Review",
      icon: "brain",
      keybind: command.keybind("review.toggle"),
      disabled: !props.canReview(),
    },
    {
      id: "terminal" as const,
      label: "Terminal",
      icon: "terminal",
      keybind: "",
      disabled: false,
    },
    {
      id: "browser" as const,
      label: "Browser",
      icon: "window-cursor",
      keybind: command.keybind("browser.open"),
      disabled: false,
    },
    {
      id: "files" as const,
      label: "Files",
      icon: "folder",
      keybind: command.keybind("file.open"),
      disabled: false,
    },
    {
      id: "side-chat" as const,
      label: "Side chat",
      icon: "prompt",
      keybind: "Ctrl+Alt+S",
      disabled: !params.id,
    },
  ])

  const openLauncherItem = (id: LauncherItem["id"]) => {
    if (id === "review") {
      openReviewTab()
      return
    }
    if (id === "terminal") {
      openTerminalTab()
      return
    }
    if (id === "browser") {
      openBrowserTab()
      return
    }
    if (id === "files") {
      showAllFiles()
      return
    }
    openSideChatLauncher()
  }

  onCleanup(() => {
    if (explicitReviewActivationTimer !== undefined) window.clearTimeout(explicitReviewActivationTimer)
    props.setActiveSideChatContentRef?.(undefined)
  })

  createEffect(() => {
    if (isSideChatTab(activeTab())) return
    props.setActiveSideChatContentRef?.(undefined)
  })

  const fileTreeTab = () => layout.fileTree.tab()
  const [allFilesSearch, setAllFilesSearch] = createSignal("")
  const [allFilesMatches, setAllFilesMatches] = createSignal<readonly string[] | undefined>()
  const [allFilesSearchLoading, setAllFilesSearchLoading] = createSignal(false)
  let allFilesSearchRequest = 0

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    layout.fileTree.open()
    layout.fileTree.setTab("all")
  }

  createEffect(() => {
    const query = allFilesSearch().trim()
    const requestID = ++allFilesSearchRequest
    if (!query) {
      setAllFilesMatches(undefined)
      setAllFilesSearchLoading(false)
      return
    }
    setAllFilesSearchLoading(true)
    const timer = window.setTimeout(() => {
      void file
        .searchFilesAndDirectories(query)
        .then((result) => {
          if (requestID !== allFilesSearchRequest) return
          setAllFilesMatches(result)
          setAllFilesSearchLoading(false)
        })
        .catch(() => {
          if (requestID !== allFilesSearchRequest) return
          setAllFilesMatches([])
          setAllFilesSearchLoading(false)
        })
    }, 160)
    onCleanup(() => window.clearTimeout(timer))
  })

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
    dockTargetActive: false,
    tabStripBounds: undefined as DOMRect | undefined,
    tabStripWidth: 0,
    detachPreview: undefined as
      | {
          tab: string
          x: number
          y: number
          width: number
          height: number
          offsetX: number
          offsetY: number
        }
      | undefined,
  })
  const visibleTabCount = createMemo(() => {
    const reviewCount = reviewTab() && props.canReview() ? 1 : 0
    const contextCount = contextOpen() ? 1 : 0
    return reviewCount + contextCount + openedTabs().length
  })
  const tabStripMetrics = createMemo(() => {
    const baseWidth = 176
    const minWidth = 112
    const reservedWidth = 68
    const count = visibleTabCount()
    const stripWidth = store.tabStripWidth
    if (count <= 0 || stripWidth <= 0) {
      return {
        width: baseWidth,
        minWidth,
        scrollable: false,
      }
    }
    const availableWidth = Math.max(stripWidth - reservedWidth, minWidth)
    const fittedWidth = Math.floor(availableWidth / count)
    const width = Math.min(baseWidth, Math.max(minWidth, fittedWidth))
    return {
      width,
      minWidth,
      scrollable: width === minWidth && count * minWidth > availableWidth,
    }
  })

  const detachedForSession = createMemo(() => layout.detachedPanels.listFor(sessionKey)())

  const tabKind = (tab: string) => {
    if (tab === "review") return "review" as const
    if (tab === "context") return "context" as const
    if (isBrowserTab(tab)) return "browser" as const
    return "file" as const
  }

  const tabTitle = (tab: string) => {
    if (tab === "review") return language.t("session.tab.review")
    if (tab === "context") return language.t("session.tab.context")
    if (isBrowserTab(tab)) {
      const id = browserTabID(tab)
      const current = id ? view().browser.get(id) : undefined
      return current ? formatBrowserTabLabel(current.title ?? current.url) : tab
    }
    if (isSideChatTab(tab)) {
      return sideChatTitle(sideChatTabID(tab) ?? "")
    }
    const path = file.pathFromTab(tab)
    return path ? path.split(/[\\/]/).pop() ?? path : tab
  }

  const detachTab = async (tab: string) => {
    if (platform.platform !== "desktop" || !platform.createDetachedSidePanelWindow) return
    if (isSideChatTab(tab)) return
    if (detachedForSession().some((item) => item.tab === tab)) return
    const kind = tabKind(tab)
    const detachedWindowID = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const route = buildDetachedSidePanelRoute({
      detachedWindowID,
      sessionKey: sessionKey(),
      tab,
      kind,
    })
    layout.detachedPanels.detach({
      detachedWindowID,
      sessionKey: sessionKey(),
      tab,
      kind,
      sourceWindowID: -1,
      title: tabTitle(tab),
    })
    await platform
      .createDetachedSidePanelWindow({
        detachedWindowID,
        route,
        sessionKey: sessionKey(),
        tab,
        kind,
        title: tabTitle(tab),
      })
      .catch(() => {
        layout.detachedPanels.redock(detachedWindowID)
      })
  }

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
    setStore("detachPreview", undefined)
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  createEffect(() => {
    if (!platform.onDetachedSidePanelEvent) return
    return platform.onDetachedSidePanelEvent((event) => {
      if (event.type === "sync") {
        layout.detachedPanels.sync(event.records)
        return
      }
      if (event.type === "redock") {
        layout.detachedPanels.redock(event.detachedWindowID, event.placement)
        return
      }
      if (event.type === "prepare-redock") return
      setStore("dockTargetActive", event.active)
    })
  })

  return (
    <Show when={isDesktop()}>
      <aside
        id="review-panel"
        data-component="session-side-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !open(),
        }}
        style={{ width: panelWidth() }}
      >
        <div class="size-full flex border-l border-border-weaker-base">
          <div
            aria-hidden={!reviewOpen()}
            inert={!reviewOpen()}
            class="relative min-w-0 h-full flex-1 overflow-hidden bg-background-base"
            classList={{
              "pointer-events-none": !reviewOpen(),
            }}
          >
            <div class="size-full min-w-0 h-full bg-background-base">
              <DragDropProvider
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                collisionDetector={closestCenter}
              >
                <DragDropSensors />
                <ConstrainDragYAxis />
                <Tabs value={activeTab()} onChange={openTab} class="size-full flex min-h-0 flex-col">
                  <div class="sticky top-0 shrink-0 flex">
                    <Tabs.List
                      data-component="detached-dock-target"
                      data-session-tab-strip="true"
                      data-scrollable={tabStripMetrics().scrollable ? "true" : "false"}
                      data-active={store.dockTargetActive ? "true" : "false"}
                      style={{
                        "--session-side-tab-width": `${tabStripMetrics().width}px`,
                        "--session-side-tab-min-width": `${tabStripMetrics().minWidth}px`,
                      }}
                      ref={(el: HTMLDivElement) => {
                        const stop = createFileTabListSync({ el, contextOpen })
                        const resizeObserver = new ResizeObserver(() => {
                          setStore("tabStripWidth", el.clientWidth)
                        })
                        setStore("tabStripWidth", el.clientWidth)
                        resizeObserver.observe(el)
                        onCleanup(stop)
                        onCleanup(() => resizeObserver.disconnect())
                        createEffect(() => {
                          if (!platform.setDetachedDockTarget || !platform.clearDetachedDockTarget) return
                          const rect = el.getBoundingClientRect()
                          setStore("tabStripBounds", rect)
                          void platform.setDetachedDockTarget({
                            sessionKey: sessionKey(),
                            rect: {
                              x: rect.x,
                              y: rect.y,
                              width: rect.width,
                              height: rect.height,
                            },
                          })
                          onCleanup(() => {
                            void platform.clearDetachedDockTarget?.()
                          })
                        })
                      }}
                      classList={{ "ring-1 ring-border-info-base": store.dockTargetActive }}
                    >
                      <Show when={reviewTab() && props.canReview()}>
                        <Tabs.Trigger
                          value="review"
                          class="[--tabs-trigger-width:112px] [--tabs-trigger-min-width:112px]"
                          closeButton={
                            <TooltipKeybind
                              title={language.t("common.closeTab")}
                              keybind={command.keybind("tab.close")}
                              placement="bottom"
                              gutter={10}
                            >
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                class="h-5 w-5"
                                onClick={closeReviewTab}
                                aria-label={language.t("common.closeTab")}
                              />
                            </TooltipKeybind>
                          }
                          hideCloseButton
                          onPointerDown={markExplicitReviewActivation}
                          onKeyDown={markExplicitReviewActivation}
                          onMiddleClick={closeReviewTab}
                        >
                          <div class="flex items-center gap-1.5">
                            <div>{language.t("session.tab.review")}</div>
                            <Show when={props.hasReview()}>
                              <div>{props.reviewCount()}</div>
                            </Show>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <Show when={contextOpen()}>
                        <Tabs.Trigger
                          value="context"
                          closeButton={
                            <TooltipKeybind
                              title={language.t("common.closeTab")}
                              keybind={command.keybind("tab.close")}
                              placement="bottom"
                              gutter={10}
                            >
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                class="h-5 w-5"
                                onClick={() => tabs().close("context")}
                                aria-label={language.t("common.closeTab")}
                              />
                            </TooltipKeybind>
                          }
                          hideCloseButton
                          onMiddleClick={() => tabs().close("context")}
                        >
                          <div class="flex items-center gap-2">
                            <SessionContextUsage variant="indicator" />
                            <div>{language.t("session.tab.context")}</div>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <SortableProvider ids={openedTabs()}>
                        <For each={openedTabs()}>
                          {(tab) => (
                            <SortableTab
                              tab={tab}
                              onTabClose={tabs().close}
                              detachBounds={() => store.tabStripBounds}
                              onDetachPreviewChange={(value) => {
                                setStore("detachPreview", value)
                              }}
                              onDetach={(next) => {
                                if (isSideChatTab(next)) return
                                void detachTab(next)
                              }}
                              onBrowserTabClose={(tabID) => {
                                layout.view(sessionKey()).browser.close(tabID)
                                tabs().close(browserTab(tabID))
                              }}
                              onSideChatTabClose={(sessionID) => {
                                props.onCloseSideChat?.(sessionID)
                              }}
                              getSideChatTitle={sideChatTitle}
                            />
                          )}
                        </For>
                      </SortableProvider>
                      <div class="bg-background-stronger h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
                        <DropdownMenu gutter={8} placement="bottom-start">
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="plus-small"
                            variant="ghost"
                            iconSize="large"
                            class="rounded-lg text-text-weak hover:bg-surface-hover"
                            aria-label={language.t("common.moreOptions")}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="min-w-[248px] rounded-xl border border-border-weaker-base bg-background-panel p-1.5 shadow-2xl">
                              <div class="flex flex-col gap-1">
                                <For each={launcherItems()}>
                                  {(item) => (
                                    <DropdownMenu.Item
                                      disabled={item.disabled}
                                      onSelect={() => openLauncherItem(item.id)}
                                      class="rounded-lg px-3 py-2 hover:bg-surface-hover"
                                    >
                                      <div class="flex min-w-0 items-center gap-3">
                                        <div class="flex size-4 shrink-0 items-center justify-center text-text-muted">
                                          <Icon name={item.icon as any} size="small" />
                                        </div>
                                        <div class="min-w-0 flex-1 text-13-medium text-text-primary">{item.label}</div>
                                        <Show when={item.keybind}>
                                          <div class="shrink-0 text-12-regular text-text-weak">{item.keybind}</div>
                                        </Show>
                                      </div>
                                    </DropdownMenu.Item>
                                  )}
                                </For>
                                <DropdownMenu.Item onSelect={openContextTab} class="rounded-lg px-3 py-2 hover:bg-surface-hover">
                                  <div class="flex min-w-0 items-center gap-3">
                                    <div class="flex size-4 shrink-0 items-center justify-center text-text-muted">
                                      <Icon name="settings-gear" size="small" />
                                    </div>
                                    <div class="min-w-0 flex-1 text-13-medium text-text-primary">{language.t("session.tab.context")}</div>
                                  </div>
                                </DropdownMenu.Item>
                              </div>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </div>
                    </Tabs.List>
                  </div>

                  <div class="relative flex-1 min-h-0 overflow-hidden">
                    <Show when={reviewTab() && props.canReview() && activeTab() === "review"}>
                      {props.reviewPanel()}
                    </Show>

                    <Show when={activeTab() === "empty"}>
                      <div class="h-full min-h-0 overflow-hidden bg-background-base">
                        <div class="flex h-full items-center justify-center px-6 pb-24">
                          <div class="mx-auto flex w-full max-w-[760px] flex-col gap-2.5">
                            <For each={launcherItems()}>
                              {(item) => (
                                <Button
                                  variant="ghost"
                                  size="large"
                                  disabled={item.disabled}
                                  onClick={() => openLauncherItem(item.id)}
                                  class="h-17 justify-start rounded-[18px] border border-white/4 bg-[#262525] px-5 text-left text-[#f2f2f2] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] hover:bg-[#2a2929]"
                                >
                                  <div class="flex min-w-0 w-full items-center gap-4">
                                    <div class="flex size-6 shrink-0 items-center justify-center text-[#d0d0d0]">
                                      <Icon name={item.icon as any} size="small" />
                                    </div>
                                    <div class="min-w-0 flex-1 text-[16px] font-medium tracking-[-0.01em]">{item.label}</div>
                                    <Show when={item.keybind}>
                                      <div class="shrink-0 rounded-full bg-[#3b3a3a] px-3 py-1 text-[12px] text-[#d2d2d2]">
                                        {item.keybind}
                                      </div>
                                    </Show>
                                  </div>
                                </Button>
                              )}
                            </For>
                          </div>
                        </div>
                      </div>
                    </Show>

                    <Show when={contextOpen() && activeTab() === "context"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <SessionContextTab />
                      </div>
                    </Show>

                    <Show when={activeFileTab()} keyed>
                      {(tab) => <FileTabContent tab={tab} />}
                    </Show>

                    <For each={browserTabs()}>
                      {(tab) => (
                        <div
                          class="size-full min-h-0 overflow-hidden contain-strict"
                          style={{ display: activeTab() === tab ? undefined : "none" }}
                        >
                          <BrowserKeepaliveSlot
                            sessionKey={sessionKey()}
                            tab={tab}
                            visible={reviewOpen() && activeTab() === tab}
                          />
                        </div>
                      )}
                    </For>

                    <For each={sideChatTabs()}>
                      {(tab) => {
                        const id = createMemo(() => sideChatTabID(tab))
                        return (
                          <div
                            class="absolute inset-0 min-h-0 overflow-hidden contain-strict"
                            aria-hidden={activeTab() === tab ? undefined : "true"}
                            inert={activeTab() !== tab}
                            style={{
                              visibility: activeTab() === tab ? "visible" : "hidden",
                              "pointer-events": activeTab() === tab ? "auto" : "none",
                            }}
                          >
                            <SideChatPanel
                              sessionID={id() ?? ""}
                              active={activeTab() === tab}
                              setContentRef={(el) => {
                                if (activeTab() !== tab) return
                                props.setActiveSideChatContentRef?.(el)
                              }}
                              inputRef={(el) => {
                                if (activeTab() !== tab) return
                                props.setActiveSideChatInputRef?.(el)
                              }}
                            />
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Tabs>
                <DragOverlay>
                  <Show when={store.detachPreview ? undefined : store.activeDraggable} keyed>
                    {(tab) => {
                      const path = file.pathFromTab(tab)
                      return (
                        <div data-component="detached-tab-drag-preview">
                          <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
                        </div>
                      )
                    }}
                  </Show>
                </DragOverlay>
                <Show when={store.detachPreview}>
                  {(preview) => {
                    const path = file.pathFromTab(preview().tab)
                    const browserID = browserTabID(preview().tab)
                    const browser = browserID ? view().browser.get(browserID) : undefined
                    return (
                      <div
                        data-component="detached-tab-live-preview"
                        style={{
                          width: `${preview().width}px`,
                          height: `${preview().height}px`,
                          left: `${preview().x - preview().offsetX}px`,
                          top: `${preview().y - preview().offsetY}px`,
                        }}
                      >
                        <Show
                          when={browser}
                          fallback={<Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>}
                        >
                          {(value) => (
                            <div class="flex items-center gap-1.5 min-w-0">
                              <div class="flex size-4 shrink-0 items-center justify-center rounded-sm bg-surface-base">
                                <Icon name="window-cursor" size="small" class="text-text-weak" />
                              </div>
                              <span class="text-14-medium truncate">
                                {formatBrowserTabLabel(value().title ?? value().url)}
                              </span>
                            </div>
                          )}
                        </Show>
                      </div>
                    )
                  }}
                </Show>
              </DragDropProvider>
            </div>
          </div>

          <Show when={shown()}>
            <div
              id="file-tree-panel"
              aria-hidden={!fileOpen()}
              inert={!fileOpen()}
              data-component="session-file-tree"
              class="relative min-w-0 h-full shrink-0 overflow-hidden"
              classList={{
                "pointer-events-none": !fileOpen(),
              }}
              style={{ width: treeWidth() }}
            >
              <div
                class="h-full flex flex-col overflow-hidden group/filetree"
                classList={{ "border-l border-border-weaker-base": reviewOpen() }}
              >
                <Tabs
                  variant="pill"
                  value={fileTreeTab()}
                  onChange={setFileTreeTabValue}
                  class="h-full"
                  data-scope="filetree"
                >
                  <Tabs.List>
                    <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                      {props.reviewCount()}{" "}
                      {language.t(
                        props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other",
                      )}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                      {language.t("session.files.all")}
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
                    <Switch>
                      <Match when={props.hasReview() || !props.diffsReady()}>
                        <Show
                          when={props.diffsReady()}
                          fallback={
                            <div class="px-2 py-2 text-12-regular text-text-weak">
                              {language.t("common.loading")}
                              {language.t("common.loading.ellipsis")}
                            </div>
                          }
                        >
                          <FileTree
                            path=""
                            class="pt-3"
                            allowed={diffFiles()}
                            kinds={kinds()}
                            draggable={false}
                            active={props.activeDiff}
                            onFileClick={(node) => props.focusReviewDiff(node.path)}
                          />
                        </Show>
                      </Match>
                    </Switch>
                  </Tabs.Content>
                  <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                    <Switch>
                      <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                      <Match when={true}>
                        <div class="min-h-0">
                          <div class="sticky top-0 z-10 bg-background-stronger py-3">
                            <div class="flex h-9 items-center gap-2 rounded-lg bg-surface-base px-3">
                              <Icon name="magnifying-glass" class="shrink-0 text-icon-weak-base" />
                              <TextField
                                variant="ghost"
                                type="text"
                                value={allFilesSearch()}
                                onChange={setAllFilesSearch}
                                placeholder={language.t("common.search.placeholder")}
                                class="min-w-0 flex-1"
                              />
                              <Show when={allFilesSearch()}>
                                <IconButton
                                  icon="circle-x"
                                  variant="ghost"
                                  aria-label={language.t("common.clearSearch")}
                                  onClick={() => setAllFilesSearch("")}
                                />
                              </Show>
                            </div>
                          </div>
                          <Show
                            when={!allFilesSearchLoading()}
                            fallback={
                              <div class="px-2 py-2 text-12-regular text-text-weak">
                                {language.t("common.loading")}
                                {language.t("common.loading.ellipsis")}
                              </div>
                            }
                          >
                            <Show
                              when={!allFilesSearch().trim() || (allFilesMatches()?.length ?? 0) > 0}
                              fallback={
                                <div class="px-2 py-2 text-12-regular text-text-weak">{language.t("palette.empty")}</div>
                              }
                            >
                              <FileTree
                                path=""
                                class="pb-3"
                                allowed={allFilesSearch().trim() ? allFilesMatches() : undefined}
                                modified={diffFiles()}
                                kinds={kinds()}
                                onFileClick={(node) => openTab(file.tab(node.path))}
                              />
                            </Show>
                          </Show>
                        </div>
                      </Match>
                    </Switch>
                  </Tabs.Content>
                </Tabs>
              </div>
              <Show when={fileOpen()}>
                <div onPointerDown={() => props.size.start()}>
                  <ResizeHandle
                    direction="horizontal"
                    edge="start"
                    size={layout.fileTree.width()}
                    min={200}
                    max={480}
                    onResize={(width) => {
                      props.size.touch()
                      layout.fileTree.resize(width)
                    }}
                  />
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </aside>
    </Show>
  )
}
