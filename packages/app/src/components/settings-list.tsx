import { type Component, type JSX } from "solid-js"

export const SettingsList: Component<{ children: JSX.Element; class?: string }> = (props) => {
  return (
    <div
      data-component="settings-section-card"
      class={`px-5 py-4 ${props.class ?? ""}`.trim()}
    >
      {props.children}
    </div>
  )
}
