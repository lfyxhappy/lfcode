type TFunction = (key: string) => string

export type MenuAction =
  | {
      key: string
      kind: "item"
      label: string
      disabled?: boolean
      onSelect: () => void
    }
  | {
      key: string
      kind: "separator"
    }

export const menuSeparator = (key: string): MenuAction => ({ key, kind: "separator" })

export const sessionDeeplink = (directory: string, sessionID: string) =>
  `lfcode://open-session?${new URLSearchParams({ directory, sessionID }).toString()}`

export function buildSessionMenuActions(input: {
  t: TFunction
  pinned: boolean
  unread: boolean
  canOpenInExplorer: boolean
  canCopyDeeplink: boolean
  extrasAfterRename?: MenuAction[]
  onTogglePinned: () => void
  onRename: () => void
  onArchive: () => void
  onMarkUnread: () => void
  onOpenInExplorer: () => void
  onCopyWorkingDirectory: () => void
  onCopySessionID: () => void
  onCopyDeeplink: () => void
  onFork: () => void
  onDelete: () => void
}) {
  return [
    {
      key: "pin",
      kind: "item",
      label: input.pinned ? input.t("menu.unpin") : input.t("menu.pin"),
      onSelect: input.onTogglePinned,
    },
    {
      key: "rename",
      kind: "item",
      label: input.t("common.rename"),
      onSelect: input.onRename,
    },
    ...(input.extrasAfterRename ?? []),
    {
      key: "archive",
      kind: "item",
      label: input.t("common.archive"),
      onSelect: input.onArchive,
    },
    {
      key: "mark-unread",
      kind: "item",
      label: input.t("menu.markUnread"),
      disabled: input.unread,
      onSelect: input.onMarkUnread,
    },
    {
      key: "open-explorer",
      kind: "item",
      label: input.t("menu.openInExplorer"),
      disabled: !input.canOpenInExplorer,
      onSelect: input.onOpenInExplorer,
    },
    {
      key: "copy-working-directory",
      kind: "item",
      label: input.t("session.header.open.copyPath"),
      onSelect: input.onCopyWorkingDirectory,
    },
    {
      key: "copy-session-id",
      kind: "item",
      label: input.t("menu.copySessionID"),
      onSelect: input.onCopySessionID,
    },
    {
      key: "copy-deeplink",
      kind: "item",
      label: input.t("menu.copyDeeplink"),
      disabled: !input.canCopyDeeplink,
      onSelect: input.onCopyDeeplink,
    },
    {
      key: "fork",
      kind: "item",
      label: input.t("menu.forkSession"),
      onSelect: input.onFork,
    },
    menuSeparator("session-separator"),
    {
      key: "delete",
      kind: "item",
      label: input.t("common.delete"),
      onSelect: input.onDelete,
    },
  ] satisfies MenuAction[]
}

export function buildProjectMenuActions(input: {
  t: TFunction
  pinned: boolean
  canOpenInExplorer: boolean
  workspacesLabel: string
  clearNotificationsLabel: string
  clearNotificationsDisabled: boolean
  onTogglePinned: () => void
  onOpenInExplorer: () => void
  onRename: () => void
  onToggleWorkspaces: () => void
  onArchiveChats: () => void
  onClearNotifications: () => void
  onRemove: () => void
}) {
  return [
    {
      key: "pin",
      kind: "item",
      label: input.pinned ? input.t("menu.unpinProject") : input.t("menu.pinProject"),
      onSelect: input.onTogglePinned,
    },
    {
      key: "open-explorer",
      kind: "item",
      label: input.t("menu.openInExplorer"),
      disabled: !input.canOpenInExplorer,
      onSelect: input.onOpenInExplorer,
    },
    {
      key: "rename",
      kind: "item",
      label: input.t("common.rename"),
      onSelect: input.onRename,
    },
    {
      key: "workspaces",
      kind: "item",
      label: input.workspacesLabel,
      onSelect: input.onToggleWorkspaces,
    },
    {
      key: "archive-chats",
      kind: "item",
      label: input.t("menu.archiveProjectChats"),
      onSelect: input.onArchiveChats,
    },
    {
      key: "clear-notifications",
      kind: "item",
      label: input.clearNotificationsLabel,
      disabled: input.clearNotificationsDisabled,
      onSelect: input.onClearNotifications,
    },
    menuSeparator("project-separator"),
    {
      key: "remove",
      kind: "item",
      label: input.t("menu.removeProject"),
      onSelect: input.onRemove,
    },
  ] satisfies MenuAction[]
}
