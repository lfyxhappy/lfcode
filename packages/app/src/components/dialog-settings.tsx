import { type Component, type JSX, ErrorBoundary, For, Match, Show, Suspense, Switch, createEffect, createMemo, createSignal, lazy } from "solid-js"
import { Dialog } from "@lfcode-ai/ui/dialog"
import { Tabs } from "@lfcode-ai/ui/tabs"
import { Icon } from "@lfcode-ai/ui/icon"
import { Dynamic } from "solid-js/web"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { nextVisitedSettingsTabs, shouldMountSettingsPanel, type SettingsTab } from "./dialog-settings-logic"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"

const SettingsArchives = lazy(() => import("./settings-archives").then((mod) => ({ default: mod.SettingsArchives })))
const SettingsProviders = lazy(() => import("./settings-providers").then((mod) => ({ default: mod.SettingsProviders })))
const SettingsModels = lazy(() => import("./settings-models").then((mod) => ({ default: mod.SettingsModels })))
const SettingsMcp = lazy(() => import("./settings-mcp").then((mod) => ({ default: mod.SettingsMcp })))
const SettingsUsage = lazy(() => import("./settings-usage").then((mod) => ({ default: mod.SettingsUsage })))
const SettingsSkills = lazy(() => import("./settings-skills").then((mod) => ({ default: mod.SettingsSkills })))

type SettingsPanelRenderers = Partial<Record<SettingsTab, Component>>

const serverTabs = ["archives", "providers", "models", "mcp", "skills", "usage"] as const satisfies SettingsTab[]
const desktopTabs = ["general", "shortcuts"] as const satisfies SettingsTab[]

function SettingsPanelSkeleton() {
  return (
    <div class="h-full w-full px-5 pb-10 pt-5 sm:px-8" data-testid="settings-panel-loading">
      <div class="mx-auto max-w-[1080px] animate-pulse">
        <div class="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_320px]">
          <div class="space-y-4">
            <div class="h-36 rounded-[26px] bg-surface-base" />
            <div class="h-72 rounded-[24px] bg-surface-base" />
            <div class="h-64 rounded-[24px] bg-surface-base" />
          </div>
          <div class="space-y-4">
            <div class="h-44 rounded-[24px] bg-surface-base" />
            <div class="h-72 rounded-[24px] bg-surface-base" />
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsPanelError() {
  const language = useLanguage()
  return (
    <div class="h-full w-full px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="max-w-[980px] pt-6">
        <div class="rounded-lg border border-border-weak-base bg-surface-base px-4 py-4 text-14-regular text-status-warning">
          {language.t("common.requestFailed")}
        </div>
      </div>
    </div>
  )
}

function SettingsPanelBoundary(props: { children: JSX.Element }) {
  return (
    <ErrorBoundary fallback={() => <SettingsPanelError />}>
      <Suspense fallback={<SettingsPanelSkeleton />}>{props.children}</Suspense>
    </ErrorBoundary>
  )
}

function renderLazyPanel(tab: Exclude<SettingsTab, "general" | "shortcuts">) {
  switch (tab) {
    case "archives":
      return SettingsArchives
    case "providers":
      return SettingsProviders
    case "models":
      return SettingsModels
    case "mcp":
      return SettingsMcp
    case "skills":
      return SettingsSkills
    case "usage":
      return SettingsUsage
  }
}

function SettingsPanel(props: {
  tab: SettingsTab
  selected: () => SettingsTab
  visited: () => Set<SettingsTab>
  renderers?: SettingsPanelRenderers
}) {
  const renderer = createMemo(() => props.renderers?.[props.tab])
  const shouldMount = createMemo(() => shouldMountSettingsPanel({ tab: props.tab, selected: props.selected(), visited: props.visited() }))
  const eagerRenderer = createMemo(() => {
    const value = renderer()
    return value ? <Dynamic component={value} /> : undefined
  })
  const lazyRenderer = createMemo<Component | undefined>(() => {
    const value = renderer()
    if (value) return value
    if (props.tab === "general" || props.tab === "shortcuts") return undefined
    return renderLazyPanel(props.tab)
  })

  const isSelected = createMemo(() => props.selected() === props.tab)

  return (
    <Tabs.Content
      value={props.tab}
      class="no-scrollbar min-w-0 settings-tab-content"
      classList={{
        hidden: !isSelected(),
        "flex-1": isSelected(),
      }}
      forceMount={shouldMount()}
    >
      <Show when={shouldMount()}>
        <div class="settings-panel-frame h-full" data-component="settings-panel-frame" data-settings-tab={props.tab}>
          <Switch>
            <Match when={props.tab === "general"}>
              <Show when={eagerRenderer()} fallback={<SettingsGeneral />}>
                {(value) => value()}
              </Show>
            </Match>
            <Match when={props.tab === "shortcuts"}>
              <Show when={eagerRenderer()} fallback={<SettingsKeybinds />}>
                {(value) => value()}
              </Show>
            </Match>
            <Match when={lazyRenderer()}>
              {(value) => (
                <SettingsPanelBoundary>
                  <Dynamic component={value()} />
                </SettingsPanelBoundary>
              )}
            </Match>
          </Switch>
        </div>
      </Show>
    </Tabs.Content>
  )
}

export const SettingsView: Component<{
  defaultValue?: SettingsTab
  tabRenderers?: SettingsPanelRenderers
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const initial = props.defaultValue ?? "general"
  const [selected, setSelected] = createSignal<SettingsTab>(initial)
  const [visited, setVisited] = createSignal(new Set<SettingsTab>(["general", "shortcuts", initial]))
  const version = createMemo(() => (platform.version ? `v${platform.version}` : undefined))

  const tabMeta = createMemo(
    () =>
      ({
        general: { icon: "sliders" as const, label: language.t("settings.tab.general") },
        shortcuts: { icon: "keyboard" as const, label: language.t("settings.tab.shortcuts") },
        archives: { icon: "archive" as const, label: language.t("settings.archives.title") },
        providers: { icon: "providers" as const, label: language.t("settings.providers.title") },
        models: { icon: "models" as const, label: language.t("settings.models.title") },
        mcp: { icon: "server" as const, label: language.t("settings.mcp.title") },
        skills: { icon: "folder-add-left" as const, label: language.t("settings.skills.title") },
        usage: { icon: "status" as const, label: language.t("settings.usage.title") },
      }) satisfies Record<SettingsTab, { icon: Parameters<typeof Icon>[0]["name"]; label: string }>,
  )

  createEffect(() => {
    setVisited((current) => nextVisitedSettingsTabs(current, selected()))
  })

  return (
    <Tabs
      orientation="vertical"
      variant="settings"
      value={selected()}
      onChange={(value) => setSelected(value as SettingsTab)}
      class="h-full w-full settings-dialog"
      data-component="settings-shell"
    >
      <Tabs.List>
        <div class="flex h-full w-full flex-col justify-between" data-component="settings-nav">
          <div class="flex flex-col gap-3 w-full pt-3">
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                <div class="flex flex-col gap-1.5 w-full">
                  <For each={desktopTabs}>
                    {(tab) => (
                      <Tabs.Trigger value={tab}>
                        <Icon name={tabMeta()[tab].icon} />
                        {tabMeta()[tab].label}
                      </Tabs.Trigger>
                    )}
                  </For>
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                <div class="flex flex-col gap-1.5 w-full">
                  <For each={serverTabs}>
                    {(tab) => (
                      <Tabs.Trigger value={tab}>
                        <Icon name={tabMeta()[tab].icon} />
                        {tabMeta()[tab].label}
                      </Tabs.Trigger>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
            <span>{language.t("app.name.desktop")}</span>
            <Show when={version()}>
              {(value) => <span class="text-11-regular">{value()}</span>}
            </Show>
          </div>
        </div>
      </Tabs.List>
      <SettingsPanel tab="general" selected={selected} visited={visited} renderers={props.tabRenderers} />
      <SettingsPanel tab="shortcuts" selected={selected} visited={visited} renderers={props.tabRenderers} />
      <For each={serverTabs}>
        {(tab) => <SettingsPanel tab={tab} selected={selected} visited={visited} renderers={props.tabRenderers} />}
      </For>
    </Tabs>
  )
}

export const DialogSettings: Component<{ defaultValue?: SettingsTab }> = (props) => {
  return (
    <Dialog size="x-large" transition>
      <SettingsView defaultValue={props.defaultValue} />
    </Dialog>
  )
}
