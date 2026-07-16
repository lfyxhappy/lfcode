export function recentPromptPaths(
  tabs: string[],
  active: string | undefined,
  pathFromTab: (tab: string) => string | undefined,
) {
  const order = active ? [active, ...tabs.filter((tab) => tab !== active)] : tabs
  const seen = new Set<string>()
  const paths: string[] = []

  for (const tab of order) {
    const path = pathFromTab(tab)
    if (!path) continue
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }

  return paths
}
