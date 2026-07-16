import { fileURLToPath } from "node:url"
import { _electron as electron } from "@playwright/test"

const executablePath = "C:/算法/小应用/Lfcode/Lfcode.exe"
const userDataDir = "C:/Users/liangfeng/AppData/Roaming/com.lfyxhappy.lfcode.dev"
const targetSessionID = "ses_11248b8d7ffe2PbKhUXBwEur3r"
const targetDir = encodeURIComponent("C:\\算法\\小应用\\知识库")

const app = await electron.launch({
  executablePath,
  args: [],
  env: {
    ...process.env,
    LFCODE_DISABLE_SINGLE_INSTANCE_LOCK: "1",
    LFCODE_USER_DATA_DIR: userDataDir,
    ComSpec: process.env.ComSpec ?? "C:\\WINDOWS\\system32\\cmd.exe",
    SystemRoot: process.env.SystemRoot ?? "C:\\WINDOWS",
    WINDIR: process.env.WINDIR ?? "C:\\WINDOWS",
  },
})

try {
  const page = await mainWindow(app)
  await page.setViewportSize({ width: 1600, height: 1100 })
  await page.waitForLoadState("domcontentloaded")
  await page.goto(`${page.url().split("#")[0]}#/${targetDir}/session/${targetSessionID}`)
  await page.waitForTimeout(10000)

  const selectors = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".scroll-view__viewport"))
      .filter((node) => node instanceof HTMLDivElement)
      .map((node, index) => ({
        index,
        className: node.className,
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        text: (node.textContent || "").slice(0, 200),
      }))
  })
  console.log("viewports", JSON.stringify(selectors, null, 2))

  const metricsBefore = await timelineMetrics(page)
  console.log("before", metricsBefore)
  await installTimelineProbe(page, metricsBefore.index)

  await page.screenshot({ path: "e2e/test-results/scroll-debug-before.png", fullPage: false })

  const target = page.locator(".scroll-view__viewport").nth(metricsBefore.index)
  await target.hover()
  await page.mouse.wheel(0, 20000)
  await page.waitForTimeout(500)
  const metricsAtBottom = await timelineMetrics(page)
  console.log("at bottom", metricsAtBottom)

  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(100)
  const metricsAfterUp = await timelineMetrics(page)
  console.log("after up 100ms", metricsAfterUp)
  console.log("probe after wheel", await readTimelineProbe(page))

  await page.waitForTimeout(1200)
  const metricsSettled = await timelineMetrics(page)
  console.log("after settle", metricsSettled)
  console.log("probe after settle", await readTimelineProbe(page))

  await target.focus()
  await page.keyboard.press("PageUp")
  await page.waitForTimeout(200)
  console.log("after PageUp", await timelineMetrics(page))
  console.log("probe after PageUp", await readTimelineProbe(page))

  const jsScroll = await page.evaluate((index) => {
    const el = Array.from(document.querySelectorAll(".scroll-view__viewport"))[index]
    if (!(el instanceof HTMLDivElement)) throw new Error("No viewport")
    const max = el.scrollHeight - el.clientHeight
    el.scrollTop = Math.max(0, max - 200)
    return { scrollTop: el.scrollTop, max }
  }, metricsBefore.index)
  console.log("after js scrollTop set", jsScroll)
  await page.waitForTimeout(300)
  console.log("after js settle", await timelineMetrics(page))
  console.log("probe after js", await readTimelineProbe(page))

  await page.screenshot({ path: "e2e/test-results/scroll-debug-after.png", fullPage: false })
} finally {
  await closeApp(app)
}

async function timelineMetrics(page) {
  return page.evaluate(() => {
    const list = Array.from(document.querySelectorAll(".scroll-view__viewport"))
      .filter((node) => node instanceof HTMLDivElement)
      .map((node, index) => ({
        index,
        className: node.className,
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        maxScrollTop: Math.max(0, node.scrollHeight - node.clientHeight),
        text: (node.textContent || "").slice(0, 200),
      }))
      .filter((node) => node.scrollHeight > node.clientHeight + 20)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)

    if (list.length === 0) throw new Error("No scrollable viewport")
    return list[0]
  })
}

async function installTimelineProbe(page, index) {
  await page.evaluate((targetIndex) => {
    const el = Array.from(document.querySelectorAll(".scroll-view__viewport"))[targetIndex]
    if (!(el instanceof HTMLDivElement)) throw new Error("No viewport")
    const store = [] 
    const push = (entry) => {
      store.push({ t: performance.now(), top: el.scrollTop, ...entry })
      if (store.length > 50) store.shift()
    }
    el.addEventListener("wheel", (event) => {
      push({ type: "wheel", deltaY: event.deltaY, target: event.target instanceof HTMLElement ? event.target.tagName : String(event.target) })
    }, { passive: true })
    el.addEventListener("scroll", () => {
      push({ type: "scroll" })
    }, { passive: true })
    const originalScrollTo = el.scrollTo.bind(el)
    el.scrollTo = (...args) => {
      push({ type: "scrollTo", args })
      return originalScrollTo(...args)
    }
    let proto = Object.getPrototypeOf(el)
    let descriptor
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, "scrollTop")
      proto = Object.getPrototypeOf(proto)
    }
    if (descriptor?.get && descriptor?.set) {
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        enumerable: descriptor.enumerable ?? false,
        get() {
          return descriptor.get.call(this)
        },
        set(value) {
          push({
            type: "scrollTop-set",
            value,
            stack: new Error().stack?.split("\n").slice(1, 8).join(" | "),
          })
          return descriptor.set.call(this, value)
        },
      })
    }
    window.__lfScrollProbe = { index: targetIndex, read: () => store.slice() }
  }, index)
}

async function readTimelineProbe(page) {
  return page.evaluate(() => window.__lfScrollProbe?.read?.() ?? [])
}

async function mainWindow(app) {
  const first = await app.firstWindow()
  await first.waitForLoadState("domcontentloaded")
  const existing = app.windows().find((page) => page.url().includes("index.html"))
  if (existing) return existing
  const next = await app.waitForEvent("window")
  await next.waitForLoadState("domcontentloaded")
  return next
}

async function closeApp(app) {
  try {
    await app.evaluate(({ app }) => app.quit())
  } catch {}
}
