import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent, createSignal, Show, type Component, type JSX } from "solid-js"
import h from "solid-js/h"
import { Dynamic, render } from "solid-js/web/dist/web.js"

type TestReactFactory = {
  createElement: (...args: unknown[]) => unknown
}

const testGlobal = globalThis as unknown as { React?: TestReactFactory }
const originalReact = testGlobal.React
let runtimeInitializationAttempts = 0
let unavailableNotifications = 0

mock.module("./code-diff-runtime", () => ({
  initializeCodeDiffRuntime: async () => {
    runtimeInitializationAttempts += 1
    throw new Error("runtime unavailable")
  },
}))

mock.module("../theme", () => ({
  useTheme: () => ({
    mode: () => "dark" as const,
  }),
}))

const { CodeDiffView } = await import("./code-diff-view")

const flush = async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

function NativeDiff(props: { mode: string }): JSX.Element {
  return h("div", { "data-native-diff": props.mode }, "native diff") as unknown as JSX.Element
}

const NativeDiffDynamic = Dynamic as unknown as Component<{ component: typeof NativeDiff; mode: string }>

function FallbackHarness() {
  const [unavailable, setUnavailable] = createSignal(false)
  return createComponent(Show, {
    get when() {
      return !unavailable()
    },
    keyed: true,
    fallback: createComponent(NativeDiffDynamic, { component: NativeDiff, mode: "diff" }),
    get children() {
      return createComponent(CodeDiffView, {
        path: "src/example.ts",
        before: "const before = true",
        after: "const after = true",
        onUnavailable: () => {
          setUnavailable(true)
          unavailableNotifications += 1
        },
      })
    },
  })
}

describe("CodeDiffView fallback", () => {
  beforeEach(() => {
    testGlobal.React = {
      createElement: h as unknown as (...args: unknown[]) => unknown,
    }
    document.body.innerHTML = ""
    runtimeInitializationAttempts = 0
    unavailableNotifications = 0
  })

  afterAll(() => {
    testGlobal.React = originalReact
  })

  test("renders the caller's native diff branch once when the Monaco runtime is unavailable", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const dispose = render(() => createComponent(FallbackHarness, {}), host)

    await flush()
    await flush()

    expect(host.innerHTML).not.toBe("")
    expect(runtimeInitializationAttempts).toBeGreaterThan(0)
    expect(unavailableNotifications).toBe(1)
    expect(host.querySelector("[data-native-diff]")?.getAttribute("data-native-diff")).toBe("diff")
    expect(host.textContent).toContain("native diff")
    dispose()
  })
})
