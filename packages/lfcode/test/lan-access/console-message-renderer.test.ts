import { expect, test } from "bun:test"
import { Window } from "happy-dom"
import { lanConsoleMessageScript, lanConsoleMessageStyles } from "../../src/lan-access/console-message-renderer"

test("LAN message renderer uses a DOM-only safe markdown surface", () => {
  expect(lanConsoleMessageStyles).toContain(".lan-user-message")
  expect(lanConsoleMessageStyles).toContain(".lan-turn::before")
  expect(lanConsoleMessageStyles).toContain(".lan-markdown")
  expect(lanConsoleMessageStyles).toContain(".lan-tool-summary")
  expect(lanConsoleMessageScript).toContain("function renderLanMessages")
  expect(lanConsoleMessageScript).toContain("document.createElement")
  expect(lanConsoleMessageScript).toContain("lanMessageHref")
  expect(lanConsoleMessageScript).not.toContain("innerHTML")
  expect(lanConsoleMessageScript).not.toContain("eval(")
  expect(() => new Function(lanConsoleMessageScript)).not.toThrow()
})

test("LAN message renderer renders GFM display features without parsing HTML", async () => {
  const window = new Window({ url: "https://lan.local/" })
  Object.assign(window, { SyntaxError })
  const root = window.document.createElement("div")
  window.document.body.append(root)
  const render = new Function("document", "navigator", "URL", "setTimeout", lanConsoleMessageScript + "\nreturn renderLanMessages")(
    window.document,
    window.navigator,
    URL,
    setTimeout,
  ) as (root: unknown, messages: unknown[]) => void

  render(root, [
    {
      info: { id: "msg_user", role: "user", sessionID: "ses_visible", time: { created: 1 } },
      parts: [
        { id: "part_image", type: "attachment", name: "image.png", mime: "image/png", preview: true },
        { id: "part_user", type: "text", text: "用户消息：**同样支持 Markdown**" },
      ],
    },
    {
      info: {
        id: "msg_assistant",
        parentID: "msg_user",
        role: "assistant",
        sessionID: "ses_visible",
        agent: "build",
        model: "gpt-safe",
        time: { created: 2, completed: 65_001 },
      },
      parts: [{
        id: "part_text",
        type: "text",
        text: "# 标题\n\n| 名称 | 数值 |\n| :--- | ---: |\n| A\\|B | ~~旧~~ **新** |\n\n- [x] 已完成\n- [ ] 未完成\n\n```ts\nconst mark = '~~literal~~'\n```\n\n<script>alert(1)</script> [坏链接](javascript:alert(1))",
      }, { id: "part_tool", type: "tool-summary", label: "执行工具", status: "completed" }],
    },
    {
      info: {
        id: "msg_assistant_follow",
        parentID: "msg_user",
        role: "assistant",
        sessionID: "ses_visible",
        time: { created: 65_002, completed: 125_001 },
      },
      parts: [],
    },
  ])

  expect(root.querySelector(".lan-turn-user .lan-user-message")?.textContent).toContain("用户消息")
  expect(root.querySelector(".lan-turn-user")?.getAttribute("aria-label")).toBe("你的消息")
  expect(root.querySelector(".lan-turn-assistant")?.getAttribute("data-lan-label")).toBe("Lfcode")
  expect(root.querySelector(".lan-turn-user .lan-user-message strong")?.textContent).toBe("同样支持 Markdown")
  expect(root.querySelector(".lan-attachment-image img")?.getAttribute("src")).toContain("/lan/v1/sessions/ses_visible/attachments/part_image")
  expect(root.querySelectorAll("table").length).toBe(1)
  expect(root.querySelectorAll("thead th").length).toBe(2)
  expect(root.querySelectorAll("tbody td").length).toBe(2)
  expect(root.querySelector("del")?.textContent).toBe("旧")
  expect(root.querySelectorAll("input[type=checkbox][disabled]").length).toBe(2)
  expect(root.querySelector("pre code")?.textContent).toContain("~~literal~~")
  expect(root.querySelector(".lan-assistant-text script")).toBeNull()
  expect(root.querySelector(".lan-assistant-text img")).toBeNull()
  expect(root.querySelector("a[href^='javascript:']")).toBeNull()
  expect(root.querySelector(".lan-tool-summary[data-status='completed']")?.textContent).toContain("执行工具")
  expect(root.querySelector(".lan-message-meta")?.textContent).toBe("Build · gpt-safe · 2 分 5 秒")
  expect(root.querySelector(".lan-assistant-actions .lan-message-copy")?.textContent).toBe("复制回复")

  const userTurn = root.querySelector(".lan-turn-user")
  const assistantTurn = root.querySelector(".lan-turn-assistant")
  const tool = root.querySelector(".lan-tool-summary")
  render(root, [
    {
      info: { id: "msg_user", role: "user", sessionID: "ses_visible", time: { created: 1 } },
      parts: [
        { id: "part_image", type: "attachment", name: "image.png", mime: "image/png", preview: true },
        { id: "part_user", type: "text", text: "用户消息：**同样支持 Markdown**" },
      ],
    },
    {
      info: {
        id: "msg_assistant",
        parentID: "msg_user",
        role: "assistant",
        sessionID: "ses_visible",
        agent: "build",
        model: "gpt-safe",
        time: { created: 2, completed: 65_001 },
      },
      parts: [
        { id: "part_text", type: "text", text: "更新后的回复" },
        { id: "part_tool", type: "tool-summary", label: "执行工具", status: "completed" },
      ],
    },
    {
      info: {
        id: "msg_assistant_follow",
        parentID: "msg_user",
        role: "assistant",
        sessionID: "ses_visible",
        time: { created: 65_002, completed: 125_001 },
      },
      parts: [],
    },
  ])
  expect(root.querySelector(".lan-turn-user")).toBe(userTurn)
  expect(root.querySelector(".lan-turn-assistant")).toBe(assistantTurn)
  expect(root.querySelector(".lan-tool-summary")).toBe(tool)
  expect(root.querySelector(".lan-assistant-text")?.textContent).toContain("更新后的回复")
  await window.happyDOM.close()
})
