import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { putTavernVisualAsset, readTavernVisualAssets, removeTavernVisualAsset } from "./visual-assets"

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

test("stores, reads, and removes a Tavern visual only in plugin-private storage", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "lfcode-tavern-visual-"))
  try {
    const stored = await putTavernVisualAsset({ data, filename: "portrait.png", base64: png.toString("base64") })
    assert.match(stored.path, /^visuals\/[\w-]+-portrait\.png$/)
    assert.deepEqual(await readFile(path.join(data, stored.path)), png)
    assert.deepEqual(await readTavernVisualAssets({ data, paths: [stored.path] }), {
      [stored.path]: `data:image/png;base64,${png.toString("base64")}`,
    })
    assert.deepEqual(await removeTavernVisualAsset({ data, path: stored.path }), { deleted: true })
    assert.deepEqual(await readTavernVisualAssets({ data, paths: [stored.path] }), {})
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})

test("rejects invalid image data and paths outside the Tavern visual directory", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "lfcode-tavern-visual-"))
  try {
    await assert.rejects(
      () => putTavernVisualAsset({ data, filename: "portrait.png", base64: "eA==" }),
      /does not match/,
    )
    await assert.rejects(
      () => putTavernVisualAsset({ data, filename: "../portrait.txt", base64: png.toString("base64") }),
      /PNG, JPEG, GIF, or WebP/,
    )
    await assert.rejects(() => removeTavernVisualAsset({ data, path: "../outside.png" }), /invalid/)
    await assert.rejects(() => removeTavernVisualAsset({ data, path: "imports/characters/alice.png" }), /invalid/)
    assert.deepEqual(await readTavernVisualAssets({ data, paths: ["../outside.png"] }), {})
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})

test("reads character avatars from private imports and the frozen migration vault", async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), "lfcode-tavern-visual-"))
  try {
    await mkdir(path.join(data, "imports", "characters"), { recursive: true })
    await mkdir(path.join(data, "migration-vault", "sillytavern", "source", "characters"), { recursive: true })
    await writeFile(path.join(data, "imports", "characters", "alice.png"), png)
    await writeFile(path.join(data, "migration-vault", "sillytavern", "source", "characters", "bob.png"), png)
    const paths = ["imports/characters/alice.png", "characters/bob.png"]
    assert.deepEqual(await readTavernVisualAssets({ data, paths }), {
      "imports/characters/alice.png": `data:image/png;base64,${png.toString("base64")}`,
      "characters/bob.png": `data:image/png;base64,${png.toString("base64")}`,
    })
    assert.deepEqual(await readTavernVisualAssets({ data, paths: ["characters/../outside.png", "characters\\bob.png"] }), {})
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})
