---
name: playwright-browser
description: Use when controlling browser pages with Playwright MCP in Lfcode; guides navigation, screenshots, interaction, and reuse of hidden or collapsed embedded side browser targets instead of the Electron app shell.
---

# Lfcode Playwright Browser

Use this skill whenever the task involves Playwright MCP browser tools such as `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, or screenshots in the Lfcode desktop app.

## Target

Lfcode desktop has an embedded side browser implemented as an Electron `<webview>`. It uses the persistent partition `persist:lfcode-browser`.

Playwright automation must target that embedded side browser. Do not navigate, reload, or otherwise replace the Electron app shell window.

## Workflow

1. Treat the Lfcode main window as the application shell, not the browser target.
2. Before navigating, look for an existing embedded side browser target first. A collapsed, hidden, inactive, `inert`, or `display:none` side browser still counts as open when its browser tab or webview target exists.
3. Reuse the existing side browser target when it exists. Do not create duplicate browser tabs just because the side panel is hidden.
4. Create or open a side browser tab only when no embedded browser target exists.
5. Use Playwright browser tools only for the actual web page inside the side browser.
6. After navigation or major UI changes, take a fresh snapshot before clicking element references.
7. If a hidden side browser target is selected but cannot produce a useful snapshot or interaction, bring the side browser panel/tab active, then continue on the same target.
8. If a Playwright action appears to affect the whole Lfcode window, stop using that tab and reopen or retarget the embedded side browser before continuing.

## Guardrails

- Never call `browser_navigate` against the Electron main app shell.
- Never use Playwright to replace the Lfcode UI with an external website.
- External web pages belong in the side browser panel.
- If multiple pages or targets are visible, choose the target that corresponds to the embedded browser webview, not the `Lfcode` application page.
- Hidden side browser targets are valid targets; closed browser tabs are not.
- If you are unsure which target is current, list tabs or inspect a snapshot before taking navigation actions.
