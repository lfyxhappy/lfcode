type PluginExtension = {
  pluginID?: string
  type?: string
} | undefined

export function isPluginProjectRoute(input: {
  sessionID?: string
  sessionExtension?: PluginExtension
  projectExtension?: PluginExtension
  pluginID: string
  type: string
}) {
  const extension = input.sessionID ? input.sessionExtension : input.projectExtension
  return extension?.pluginID === input.pluginID && extension.type === input.type
}
