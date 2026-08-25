import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { loadTavernQuickReplies } from "./quick-replies"

test("reads declared visible entries without importing automation fields", async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), "lfcode-tavern-quick-replies-"))
    try {
      await mkdir(path.join(data, "migration-vault", "sillytavern", "source", "QuickReplies"), { recursive: true })
      await writeFile(path.join(data, "ui.json"), JSON.stringify({ quickReplies: [{ id: "default", name: "Default", source: "QuickReplies/Default.json" }] }))
      await writeFile(path.join(data, "migration-vault", "sillytavern", "source", "QuickReplies", "Default.json"), JSON.stringify({
        injectInput: true,
        qrList: [
          { id: 1, label: "问候", title: "标题", message: "你好 {{char}}", executeOnStartup: true },
          { id: 2, label: "隐藏", message: "不显示", isHidden: true },
        ],
      }))

      assert.deepEqual(await loadTavernQuickReplies(data), [{ id: "default", name: "Default", replies: [{ id: "1", label: "问候", title: "标题", message: "你好 {{char}}", append: true }] }])
    } finally {
      await rm(data, { recursive: true, force: true })
    }
})

test("does not follow traversal paths from the plugin data index", async () => {
    const data = await mkdtemp(path.join(os.tmpdir(), "lfcode-tavern-quick-replies-"))
    try {
      await writeFile(path.join(data, "ui.json"), JSON.stringify({ quickReplies: [{ id: "bad", name: "Bad", source: "../outside.json" }] }))
      await writeFile(path.join(path.dirname(data), "outside.json"), JSON.stringify({ qrList: [{ message: "must not load" }] }))

      assert.deepEqual(await loadTavernQuickReplies(data), [])
    } finally {
      await rm(data, { recursive: true, force: true })
      await rm(path.join(path.dirname(data), "outside.json"), { force: true })
    }
})
