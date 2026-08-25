import { Show, type Component, type JSX } from "solid-js"

export const SettingsPageShell: Component<{
  title: string
  density?: "compact"
  children: JSX.Element
}> = (props) => {
  return (
    <div
      data-component="settings-page"
      data-settings-density={props.density}
      class="flex h-full flex-col overflow-y-auto no-scrollbar bg-background-base px-4 pb-10 sm:px-10 sm:pb-10"
    >
      <div class="sticky top-0 z-10 -mx-4 border-b border-border-weaker-base bg-background-base px-4 sm:-mx-10 sm:px-10">
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-1 py-3">
          <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        </div>
      </div>
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 pt-3">{props.children}</div>
    </div>
  )
}

export const SettingsRow: Component<{
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="settings-row flex flex-wrap items-center gap-4 rounded-md border-b border-border-weak-base px-3 py-3 transition-colors last:border-none hover:bg-surface-raised-base-hover sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}

export const SettingsSection: Component<{
  title: string
  description?: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-col gap-1">
      <h3 class="pb-2 text-14-medium text-text-strong">{props.title}</h3>
      <Show when={props.description}>
        {(value) => <div class="pb-2 text-12-regular text-text-weak">{value()}</div>}
      </Show>
      {props.children}
    </div>
  )
}
