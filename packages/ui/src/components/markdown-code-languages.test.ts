import { describe, expect, test } from "bun:test"
import { extractMarkdownCodeLanguages } from "./markdown-code-languages"

describe("markdown code block decoration", () => {
  test("keeps fence language labels aligned with rendered code blocks", () => {
    expect(extractMarkdownCodeLanguages('```ts title="src/main.ts"\nconst x = 1\n```\n```\nplain\n```')).toEqual([
      "ts",
      "text",
    ])
  })

  test("does not count interactive HTML placeholders as code blocks", () => {
    expect(extractMarkdownCodeLanguages('```lfcode-html\n<button>Open</button>\n```\n```python\nprint(1)\n```')).toEqual([
      "python",
    ])
  })
})
