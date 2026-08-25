import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "dialog.css"), "utf8")

test("short dialogs use intrinsic height inside a viewport bound", () => {
  expect(css).toContain("--dialog-max-height: min(calc(100vh - 16px), 512px)")
  expect(css).toContain("max-height: var(--dialog-max-height)")
  expect(css).not.toMatch(/width: min\(calc\(100vw - 16px\), 640px\);\s+height:/)
  expect(css).not.toContain("justify-items: start")
})

test("large dialog variants retain their fixed workspace height", () => {
  expect(css).toContain('&[data-size="large"]')
  expect(css).toContain('&[data-size="x-large"]')
  expect(css).toContain("height: var(--dialog-max-height)")
})
