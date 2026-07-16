import { Show, type Component, type JSX } from "solid-js"

export const SettingsPageShell: Component<{
  title: string
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex h-full flex-col overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{props.title}</h2>
        </div>
      </div>
      <div class="flex w-full flex-col gap-8">{props.children}</div>
    </div>
  )
}

export const SettingsRow: Component<{
  title: string | JSX.Element
  description: string | JSX.Element
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
