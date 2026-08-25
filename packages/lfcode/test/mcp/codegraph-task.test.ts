import { describe, expect, test } from "bun:test"
import { classifyCodegraphTask, shouldUseCodegraph } from "../../src/mcp/codegraph-task"

describe("CodeGraph task routing", () => {
  test("routes structured code questions", () => {
    expect(shouldUseCodegraph("分析这个模块的调用链和影响面")).toBe(true)
    expect(classifyCodegraphTask("请重构认证模块并定位符号定义")).toBe("structured-code")
    expect(shouldUseCodegraph("debug why this function is called twice")).toBe(true)
    expect(shouldUseCodegraph("用 codegraph 看依赖关系")).toBe(true)
    expect(shouldUseCodegraph("Analyze the architecture and dependencies of this module")).toBe(true)
    expect(shouldUseCodegraph("Find all callers and references to this symbol")).toBe(true)
  })

  test("keeps exact search, config, docs and logs on normal tools", () => {
    for (const text of [
      "在日志里搜索 error",
      "读取 config.json 并修改配置",
      "精确搜索 README 中的标题",
      "grep this string in the project",
      "检查 dist 构建产物",
    ]) {
      expect(shouldUseCodegraph(text)).toBe(false)
    }
  })
})
