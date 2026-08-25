import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates historical built-in themes to lfcode before mount", () => {
    localStorage.setItem("lfcode-theme-id", "nightowl")
    localStorage.setItem("lfcode-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("lfcode-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("lfcode")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(localStorage.getItem("lfcode-theme-id")).toBe("lfcode")
    expect(localStorage.getItem("lfcode-theme-css-light")).toBeNull()
    expect(localStorage.getItem("lfcode-theme-css-dark")).toBeNull()
    expect(document.getElementById("oc-theme-preload")).toBeNull()
  })

  test("uses dark mode before the first browser preference is saved", () => {
    run()

    expect(document.documentElement.dataset.theme).toBe("lfcode")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
  })

  test("keeps cached css for registered extension themes", () => {
    localStorage.setItem("lfcode-theme-id", "plugin-theme")
    localStorage.setItem("lfcode-color-scheme", "light")
    localStorage.setItem("lfcode-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("plugin-theme")
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })
})
