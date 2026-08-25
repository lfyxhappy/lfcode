import { describe, expect, test } from "bun:test"
import { normalizeProjectRelativePath, splitRenderableCodeBlocks } from "./message-code-blocks"

describe("splitRenderableCodeBlocks", () => {
  test("keeps plain markdown as one segment", () => {
    expect(splitRenderableCodeBlocks("hello")).toEqual([{ type: "markdown", text: "hello" }])
  })

  test("extracts fenced blocks and preserves surrounding markdown", () => {
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

  test("extracts any language so the caller can keep it as ordinary markdown", () => {
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

  test("keeps an unknown language as a code segment for markdown fallback", () => {
    expect(splitRenderableCodeBlocks("```bash\necho 1\n```")).toEqual([
      {
        type: "code",
        language: "bash",
        code: "echo 1\n",
        raw: "```bash\necho 1\n```",
        blockIndex: 0,
      },
    ])
  })

  test("parses a project-relative title", () => {
    expect(splitRenderableCodeBlocks('```java title="src/Task.java"\nclass Task {}\n```')).toEqual([
      {
        type: "code",
        language: "java",
        code: "class Task {}\n",
        raw: '```java title="src/Task.java"\nclass Task {}\n```',
        title: "src/Task.java",
        projectPath: "src/Task.java",
        blockIndex: 0,
      },
    ])
  })

  test("allows a title-only fence without treating title as a language", () => {
    const [segment] = splitRenderableCodeBlocks('```title="README.md"\n# Notes\n```')
    expect(segment).toMatchObject({ language: "", title: "README.md", projectPath: "README.md" })
  })

  test("normalizes line endings in the fallback fence", () => {
    const [segment] = splitRenderableCodeBlocks("```ts\r\nconst x = 1\r\n```")
    expect(segment).toEqual({
      type: "code",
      language: "ts",
      code: "const x = 1\n",
      raw: "```ts\nconst x = 1\n```",
      blockIndex: 0,
    })
  })

  test("rejects absolute, parent and directory titles", () => {
    expect(normalizeProjectRelativePath("../src/main.ts")).toBeUndefined()
    expect(normalizeProjectRelativePath("C:\\project\\main.ts")).toBeUndefined()
    expect(normalizeProjectRelativePath("C:main.ts")).toBeUndefined()
    expect(normalizeProjectRelativePath("/etc/hosts")).toBeUndefined()
    expect(normalizeProjectRelativePath("src/components/")).toBeUndefined()
    expect(normalizeProjectRelativePath("./src/./main.ts")).toBe("src/main.ts")
  })

  test("keeps multiple ordinary blocks and a titled block in order", () => {
    expect(splitRenderableCodeBlocks('one\n```ts\nconst a = 1\n```\ntwo\n```ts title="src/a.ts"\nconst b = 2\n```\nthree')).toEqual([
      { type: "markdown", text: "one\n" },
      {
        type: "code",
        language: "ts",
        code: "const a = 1\n",
        raw: "```ts\nconst a = 1\n```",
        blockIndex: 0,
      },
      { type: "markdown", text: "\ntwo\n" },
      {
        type: "code",
        language: "ts",
        code: "const b = 2\n",
        raw: '```ts title="src/a.ts"\nconst b = 2\n```',
        title: "src/a.ts",
        projectPath: "src/a.ts",
        blockIndex: 1,
      },
      { type: "markdown", text: "\nthree" },
    ])
  })
})
