import { describe, expect, test } from "bun:test"
import { featuredFor, groupFor, groupedFor, priorityFor, type KeybindMeta } from "./settings-keybinds-logic"

function meta(id: string, title: string): KeybindMeta {
  return {
    title,
    group: groupFor(id),
    priority: priorityFor(id),
  }
}

describe("settings keybind display policy", () => {
  test("keeps browser commands out of the general group", () => {
    expect(groupFor("browser.open")).toBe("Browser")
    expect(groupFor("browser.close")).toBe("Browser")
  })

  test("keeps the featured shortcut entry order independent of localized titles", () => {
    const list = new Map([
      ["terminal.toggle", meta("terminal.toggle", "终端")],
      ["command.palette", meta("command.palette", "命令面板")],
      ["session.new", meta("session.new", "新建会话")],
    ])

    expect(featuredFor(list)).toEqual(["command.palette", "session.new", "terminal.toggle"])
  })

  test("sorts each group by priority, assigned state, then localized title", () => {
    const list = new Map([
      ["settings.open", meta("settings.open", "设置")],
      ["theme.cycle", meta("theme.cycle", "主题")],
      ["sidebar.toggle", meta("sidebar.toggle", "侧边栏")],
    ])

    expect(groupedFor(list, (id) => (id === "theme.cycle" ? "Ctrl+T" : "")).get("General")).toEqual([
      "settings.open",
      "theme.cycle",
      "sidebar.toggle",
    ])
  })
})
