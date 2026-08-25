import { describe, expect, test } from "bun:test"
import { extractTextFromHTML } from "../../src/tool/webfetch-html"

describe("webfetch HTML text extraction", () => {
  test("keeps visible content and ignores hidden executable elements", () => {
    const result = extractTextFromHTML(
      "<html><head><style>.hidden { display: none }</style><script>throw new Error('ignore')</script></head><body><h1>Hello &amp; welcome</h1><p>Visible&#32;text</p><iframe>hidden frame</iframe></body></html>",
    )
    expect(result).toBe("Hello & welcome Visible text")
  })
})
