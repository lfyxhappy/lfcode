import { createRequire } from "node:module"

const require = createRequire(new URL("../packages/app/node_modules/@playwright/test/index.js", import.meta.url))
const { _electron: electron } = require("playwright")

const root = "C:/算法/小应用/知识库/10_Projects/opencode"
const sidecarUrl = process.env.OPENCODE_TEST_SIDECAR_URL ?? "http://127.0.0.1:2709"
const sidecarAuth = process.env.OPENCODE_TEST_SIDECAR_AUTH ?? ""
const projectDir = process.env.OPENCODE_TEST_PROJECT_DIR ?? root
const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:5173"

const headers = sidecarAuth ? { Authorization: sidecarAuth } : {}

const createSession = async () => {
  const response = await fetch(`${sidecarUrl}/session?directory=${encodeURIComponent(projectDir)}`, {
    method: "POST",
    headers,
  })
  if (!response.ok) {
    throw new Error(`session create failed: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

const waitForRoute = async (page, expected) => {
  await page.waitForFunction(
    (value) => window.location.hash.includes(value) || window.location.pathname.includes(value),
    expected,
    { timeout: 30_000 },
  )
}

const main = async () => {
  const session = await createSession()
  const slug = Buffer.from(session.directory).toString("base64")
  const targetHash = `/${slug}/session/${session.id}`

  const app = await electron.launch({
    executablePath: `${root}/packages/desktop/node_modules/electron/dist/electron.exe`,
    args: ["."],
    cwd: `${root}/packages/desktop`,
    env: {
      ...process.env,
      OPENCODE_DESKTOP_HEADLESS: "1",
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState("domcontentloaded")
    await waitForRoute(page, "/")

    await app.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send("browser-window-open", url)
    }, "https://example.com")

    await waitForRoute(page, targetHash)

    const result = await page.waitForFunction(() => {
      const trigger = document.querySelector('[value^="browser://"]')
      const webview = document.querySelector("webview")
      return trigger && webview
        ? {
            browserTab: trigger.getAttribute("value"),
            webviewSrc: webview.getAttribute("src"),
          }
        : null
    }, undefined, { timeout: 30_000 })

    console.log(JSON.stringify({ ok: true, sessionID: session.id, route: targetHash, result: await result.jsonValue() }))
  } finally {
    await app.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
