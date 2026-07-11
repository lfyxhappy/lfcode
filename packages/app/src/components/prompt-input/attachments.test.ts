import { describe, expect, test } from "bun:test"
import { transferredFilePaths } from "./attachments"
import { attachmentMime } from "./files"
import { pasteMode } from "./paste"

describe("attachmentMime", () => {
  test("keeps PDFs when the browser reports the mime", async () => {
    const file = new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" })
    expect(await attachmentMime(file)).toBe("application/pdf")
  })

  test("normalizes structured text types to text/plain", async () => {
    const file = new File(['{"ok":true}\n'], "data.json", { type: "application/json" })
    expect(await attachmentMime(file)).toBe("text/plain")
  })

  test("accepts text files even with a misleading browser mime", async () => {
    const file = new File(["export const x = 1\n"], "main.ts", { type: "video/mp2t" })
    expect(await attachmentMime(file)).toBe("text/plain")
  })

  test("rejects binary files", async () => {
    const file = new File([Uint8Array.of(0, 255, 1, 2)], "blob.bin", { type: "application/octet-stream" })
    expect(await attachmentMime(file)).toBeUndefined()
  })
})

describe("pasteMode", () => {
  test("uses native paste for short single-line text", () => {
    expect(pasteMode("hello world")).toBe("native")
  })

  test("uses manual paste for multiline text", () => {
    expect(
      pasteMode(`{
  "ok": true
}`),
    ).toBe("manual")
    expect(pasteMode("a\r\nb")).toBe("manual")
  })

  test("uses manual paste for large text", () => {
    expect(pasteMode("x".repeat(8000))).toBe("manual")
  })
})

describe("transferredFilePaths", () => {
  test("accepts Windows paths and file URIs from Explorer", () => {
    const data = {
      getData(type: string) {
        if (type === "text/uri-list") return "file:///C:/work/demo.ts\r\nfile:///D:/docs/guide.pdf"
        if (type === "text/plain") return "C:\\work\\demo.ts"
        return ""
      },
    }

    expect(transferredFilePaths(data)).toEqual(["C:/work/demo.ts", "D:/docs/guide.pdf"])
  })

  test("does not turn ordinary pasted text into a file attachment", () => {
    expect(
      transferredFilePaths({
        getData: () => "please review this file",
      }),
    ).toEqual([])
  })
})
