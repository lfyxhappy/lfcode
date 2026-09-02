import { describe, expect, test } from "bun:test"
import { formatExternalAgentPrompt } from "./external-agent"

describe("formatExternalAgentPrompt", () => {
  test("keeps text and renders file, selection, and context references for a terminal agent", () => {
    expect(
      formatExternalAgentPrompt({
        prompt: [
          { type: "text", content: "请修复这个问题", start: 0, end: 7 },
          { type: "file", path: "src/main.ts", content: "@src/main.ts", start: 7, end: 19, selection: { startLine: 4, startChar: 0, endLine: 6, endChar: 0 } },
          { type: "selected-text", text: "const answer = 42", content: "", start: 19, end: 19, comment: "重点检查这里" },
        ],
        context: [
          {
            key: "file:src/app.ts:10:12",
            type: "file",
            path: "src/app.ts",
            selection: { startLine: 10, startChar: 0, endLine: 12, endChar: 0 },
            comment: "这个调用栈相关",
          },
        ],
      }),
    ).toBe(
      "请修复这个问题\n\n[文件] src/main.ts:4-6\n\n[选中文本]\n说明：重点检查这里\n```text\nconst answer = 42\n```\n\n[文件] src/app.ts:10-12\n说明：这个调用栈相关",
    )
  })

  test("does not include image attachments", () => {
    expect(
      formatExternalAgentPrompt({
        prompt: [
          { type: "text", content: "描述截图", start: 0, end: 4 },
          { type: "image", id: "image_1", filename: "screen.png", mime: "image/png", dataUrl: "data:image/png;base64,abc" },
        ],
        context: [],
      }),
    ).toBe("描述截图")
  })

  test("does not inject legacy web references into new external-agent requests", () => {
    expect(
      formatExternalAgentPrompt({
        prompt: [
          { type: "text", content: "继续处理", start: 0, end: 4 },
          {
            type: "web-reference",
            label: "旧网页引用",
            text: "legacy excerpt",
            url: "https://example.com/legacy",
            mode: "selection",
            content: "[web:旧网页引用]",
            start: 4,
            end: 14,
          },
        ],
        context: [],
      }),
    ).toBe("继续处理")
  })
})
