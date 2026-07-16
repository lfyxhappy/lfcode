import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import DropdownMenu from "../packages/app/src/components/code-editor/core/dropdown-menu"

test("controlled code editor menu stays open after pointerdown", async () => {
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(() => {
    const [open, setOpen] = createSignal(false)
    return (
      <DropdownMenu open={open()} onOpenChange={setOpen}>
        <DropdownMenu.Trigger data-testid="trigger">More</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>Content</DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    )
  }, root)

  const trigger = root.querySelector('[data-testid="trigger"]')
  expect(trigger).toBeInstanceOf(HTMLElement)
  trigger?.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerType: "mouse",
    }),
  )
  await new Promise((resolve) => setTimeout(resolve))

  expect(trigger?.hasAttribute("data-expanded")).toBe(true)
  expect(document.body.textContent).toContain("Content")
  dispose()
  root.remove()
})
