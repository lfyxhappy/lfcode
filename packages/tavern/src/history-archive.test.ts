import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { archiveTavernHistory } from "./history-archive"

test("archives a Tavern history only below the plugin private imports directory", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "lfcode-tavern-history-"))
  try {
    const archived = await archiveTavernHistory({ data, filename: "chat.jsonl", base64: Buffer.from('{"mes":"hello"}\n').toString("base64") })
    assert.match(archived.path, /^imports\/chats\/[\w-]+-chat\.jsonl$/)
    assert.equal(await readFile(path.join(data, archived.path), "utf8"), '{"mes":"hello"}\n')
    await assert.rejects(() => archiveTavernHistory({ data, filename: "../outside.jsonl", base64: "eA==" }), /JSON or JSONL/)
    await assert.rejects(() => archiveTavernHistory({ data, filename: "chat.txt", base64: "eA==" }), /JSON or JSONL/)
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})
