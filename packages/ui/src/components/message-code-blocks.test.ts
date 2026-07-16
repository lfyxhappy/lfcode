import { describe, expect, test } from "bun:test"
import { splitRenderableCodeBlocks } from "./message-code-blocks"

describe("splitRenderableCodeBlocks", () => {
  test("keeps plain markdown as one segment", () => {
    expect(splitRenderableCodeBlocks("hello")).toEqual([{ type: "markdown", text: "hello" }])
  })

  test("extracts supported fenced blocks and preserves surrounding markdown", () => {
    expect(splitRenderableCodeBlocks("before\n```cpp\nint main() {}\n```\nafter")).toEqual([
      { type: "markdown", text: "before\n" },
      {
        type: "code",
        language: "cpp",
        code: "int main() {}\n",
        raw: "```cpp\nint main() {}\n```",
        blockIndex: 0,
      },
      { type: "markdown", text: "\nafter" },
    ])
  })

  test("extracts non-cpp supported fenced blocks too", () => {
    expect(splitRenderableCodeBlocks("```ts\nconsole.log(1)\n```")).toEqual([
      {
        type: "code",
        language: "ts",
        code: "console.log(1)\n",
        raw: "```ts\nconsole.log(1)\n```",
        blockIndex: 0,
      },
    ])
  })

  test("ignores unsupported fenced blocks", () => {
    expect(splitRenderableCodeBlocks("```bash\necho 1\n```")).toEqual([{ type: "markdown", text: "```bash\necho 1\n```" }])
  })
})
