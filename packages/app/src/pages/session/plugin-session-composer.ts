export type PluginSessionComposer = {
  pluginID: string
  type: string
  mode: "replace" | "append"
  renderer: "conversation"
  title?: string
  description?: string
  placeholder?: string
  submitLabel?: string
  hiddenComponents?: ("summary" | "jobs-rail" | "side-panel")[]
}

type PluginInspectLike = {
  enabled: boolean
  compatible: boolean
  runtime?: { lifecycle: "active" | "disabled" | "degraded" }
  manifest?: {
    id?: string
    uiContributions?: {
      slot: string
      title?: string
      sessionComposer?: Omit<PluginSessionComposer, "pluginID" | "title">
    }[]
  }
}

export function findPluginSessionComposer(input: {
  session?: { extension?: { pluginID: string; type: string } }
  project?: { extension?: { pluginID: string; type: string } }
  plugins: PluginInspectLike[]
}) {
  // A loaded session is authoritative. Project ownership is only a fallback
  // for the new-session route, before a session exists at all.
  const extension = input.session ? input.session.extension : input.project?.extension
  if (!extension) return
  const projectExtension = input.project?.extension
  if (
    extension.pluginID === "lfcode-tavern" &&
    (projectExtension?.pluginID !== "lfcode-tavern" || projectExtension.type !== "tavern")
  ) {
    return
  }
  const plugin = input.plugins.find(
    (item) =>
      item.enabled &&
      item.compatible &&
      item.runtime?.lifecycle !== "disabled" &&
      item.runtime?.lifecycle !== "degraded" &&
      item.manifest?.id === extension.pluginID,
  )
  const contribution = plugin?.manifest?.uiContributions?.find(
    (item) => item.slot === "desktop-session-composer" && item.sessionComposer?.type === extension.type,
  )
  if (!contribution?.sessionComposer) return
  return {
    pluginID: extension.pluginID,
    title: contribution.title,
    ...contribution.sessionComposer,
  } satisfies PluginSessionComposer
}
