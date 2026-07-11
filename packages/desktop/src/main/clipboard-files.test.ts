import { describe, expect, test } from "bun:test"
import { clipboardFilePaths } from "./clipboard-files"

function fileDrop(paths: string[]) {
  const names = Buffer.from(`${paths.join("\0")}\0\0`, "utf16le")
  const result = Buffer.alloc(20 + names.byteLength)
  result.writeUInt32LE(20, 0)
  result.writeUInt32LE(1, 16)
  names.copy(result, 20)
  return result
}

describe("clipboardFilePaths", () => {
  test("reads Windows FileDrop paths including Unicode paths", () => {
    expect(
      clipboardFilePaths({
        fileDrop: fileDrop(["C:\\work\\readme.md", "C:\\算法\\图片.png"]),
      }),
    ).toEqual(["C:\\work\\readme.md", "C:\\算法\\图片.png"])
  })

  test("uses FileNameW when FileDrop is unavailable", () => {
    expect(clipboardFilePaths({ fileNameWide: Buffer.from("D:\\docs\\report.pdf\0", "utf16le") })).toEqual([
      "D:\\docs\\report.pdf",
    ])
  })
})
