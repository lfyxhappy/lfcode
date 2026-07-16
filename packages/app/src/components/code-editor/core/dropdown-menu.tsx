import { DropdownMenu } from "@lfcode-ai/ui/dropdown-menu"
import type { ComponentProps, ParentProps } from "solid-js"
import { shouldRestoreMenuTrigger } from "./dropdown-menu-focus"

type CloseAutoFocusEvent = Parameters<NonNullable<ComponentProps<typeof DropdownMenu.Content>["onCloseAutoFocus"]>>[0]
type OpenAutoFocusEvent = Parameters<NonNullable<ComponentProps<typeof DropdownMenu.Content>["onOpenAutoFocus"]>>[0]

function activeElementOutsideMenu() {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body || !active.isConnected) return
  if (active.closest('[data-focus-overlay], [role="menu"]')) return
  return active
}

function CodeEditorDropdownMenuRoot(props: ComponentProps<typeof DropdownMenu>) {
  return <DropdownMenu {...props} modal={false} />
}

function CodeEditorDropdownMenuContent(props: ParentProps<ComponentProps<typeof DropdownMenu.Content>>) {
  let closedWithEscape = false
  let trigger: HTMLElement | undefined

  return (
    <DropdownMenu.Content
      {...props}
      data-prevent-autofocus
      data-editable-surface="overlay"
      data-focus-overlay="menu"
      onOpenAutoFocus={(event: OpenAutoFocusEvent) => {
        trigger = activeElementOutsideMenu()
        props.onOpenAutoFocus?.(event)
      }}
      onEscapeKeyDown={(event) => {
        props.onEscapeKeyDown?.(event)
        closedWithEscape = !event.defaultPrevented
      }}
      onCloseAutoFocus={(event: CloseAutoFocusEvent) => {
        props.onCloseAutoFocus?.(event)
        const restore =
          !event.defaultPrevented &&
          shouldRestoreMenuTrigger({
            closedWithEscape,
            trigger,
            activeElement: activeElementOutsideMenu(),
          })
        event.preventDefault()
        if (restore) trigger?.focus({ preventScroll: true })
        closedWithEscape = false
      }}
    />
  )
}

function CodeEditorDropdownMenuSubContent(props: ParentProps<ComponentProps<typeof DropdownMenu.SubContent>>) {
  let closedWithEscape = false
  let trigger: HTMLElement | undefined

  return (
    <DropdownMenu.SubContent
      {...props}
      data-prevent-autofocus
      data-editable-surface="overlay"
      data-focus-overlay="menu"
      onOpenAutoFocus={(event: OpenAutoFocusEvent) => {
        trigger = activeElementOutsideMenu()
        props.onOpenAutoFocus?.(event)
      }}
      onEscapeKeyDown={(event) => {
        props.onEscapeKeyDown?.(event)
        closedWithEscape = !event.defaultPrevented
      }}
      onCloseAutoFocus={(event: CloseAutoFocusEvent) => {
        props.onCloseAutoFocus?.(event)
        const restore =
          !event.defaultPrevented &&
          shouldRestoreMenuTrigger({
            closedWithEscape,
            trigger,
            activeElement: activeElementOutsideMenu(),
          })
        event.preventDefault()
        if (restore) trigger?.focus({ preventScroll: true })
        closedWithEscape = false
      }}
    />
  )
}

const CodeEditorDropdownMenu = Object.assign(CodeEditorDropdownMenuRoot, DropdownMenu, {
  Content: CodeEditorDropdownMenuContent,
  SubContent: CodeEditorDropdownMenuSubContent,
})

export default CodeEditorDropdownMenu
