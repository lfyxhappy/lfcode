import { expect, test } from "bun:test"
import { downloadTavernExport } from "./tavern-export"

test("rejects an incomplete Tavern export response before creating a download", () => {
  expect(() => downloadTavernExport({ base64: "", filename: "card.png", mime: "image/png" })).toThrow("酒馆导出文件无效")
})
