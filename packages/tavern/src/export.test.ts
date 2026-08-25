import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { exportTavernResource, writeTavernExport } from "./export"

test("exports the original imported PNG character card without changing its bytes", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "lfcode-tavern-export-"))
  try {
    await mkdir(path.join(data, "imports", "characters"), { recursive: true })
    const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3])
    await writeFile(path.join(data, "imports", "characters", "alice.png"), bytes)
    await writeFile(path.join(data, "ui.json"), JSON.stringify({ characters: [{ id: "alice", name: "Alice", source: "imports/characters/alice.png", prompt: "" }], worldbooks: [] }))

    const result = await exportTavernResource({ data, kind: "character", id: "alice" })

    assert.equal(result.filename, "alice.png")
    assert.equal(result.mime, "image/png")
    assert.equal(result.original, true)
    assert.deepEqual(Buffer.from(result.base64, "base64"), bytes)
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})

test("does not read sources outside the resource import directory", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "lfcode-tavern-export-"))
  try {
    await writeFile(path.join(data, "ui.json"), JSON.stringify({ characters: [{ id: "alice", name: "Alice", source: "../private.json", prompt: "角色描述", firstMessage: "你好" }], worldbooks: [] }))

    const result = await exportTavernResource({ data, kind: "character", id: "alice" })
    const card = JSON.parse(Buffer.from(result.base64, "base64").toString("utf8"))

    assert.equal(result.filename, "Alice.json")
    assert.equal(result.original, false)
    assert.equal(card.data.name, "Alice")
    assert.equal(card.data.first_mes, "你好")
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})

test("exports structured V2 character fields after an in-app edit", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "lfcode-tavern-export-"))
  try {
    await writeFile(
      path.join(data, "ui.json"),
      JSON.stringify({
        characters: [
          {
            id: "alice",
            name: "Alice",
            prompt: "Description",
            description: "Description",
            personality: "Warm",
            scenario: "A garden",
            exampleDialogue: "{{char}}: Hello.",
            systemPrompt: "Stay in character.",
            postHistoryInstructions: "Keep continuity.",
            depthPrompt: "Prioritize recent actions.",
          },
        ],
        worldbooks: [],
      }),
    )

    const result = await exportTavernResource({ data, kind: "character", id: "alice" })
    const card = JSON.parse(Buffer.from(result.base64, "base64").toString("utf8"))

    assert.deepEqual(card.data, {
      name: "Alice",
      description: "Description",
      personality: "Warm",
      scenario: "A garden",
      mes_example: "{{char}}: Hello.",
      system_prompt: "Stay in character.",
      post_history_instructions: "Keep continuity.",
      extensions: { depth_prompt: { prompt: "Prioritize recent actions." } },
      first_mes: "",
      alternate_greetings: [],
      tags: [],
    })
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})

test("exports an imported worldbook JSON unchanged", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "lfcode-tavern-export-"))
  try {
    await mkdir(path.join(data, "imports", "worldbooks"), { recursive: true })
    const source = '{"entries":{"1":{"content":"moon"}}}'
    await writeFile(path.join(data, "imports", "worldbooks", "lore.json"), source)
    await writeFile(path.join(data, "ui.json"), JSON.stringify({ characters: [], worldbooks: [{ id: "lore", name: "Lore", source: "imports/worldbooks/lore.json", content: "{}" }] }))

    const result = await exportTavernResource({ data, kind: "worldbook", id: "lore" })

    assert.equal(result.filename, "lore.json")
    assert.equal(result.mime, "application/json")
    assert.equal(Buffer.from(result.base64, "base64").toString("utf8"), source)
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})

test("writes a selected desktop export path atomically", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "lfcode-tavern-export-"))
  try {
    await writeFile(path.join(data, "ui.json"), JSON.stringify({ characters: [{ id: "alice", name: "Alice", prompt: "角色描述" }], worldbooks: [] }))
    const output = path.join(data, "Alice.json")

    const result = await writeTavernExport({ data, kind: "character", id: "alice", output })

    assert.equal(result.filename, "Alice.json")
    assert.equal(result.original, false)
    assert.equal(JSON.parse(await readFile(output, "utf8")).data.name, "Alice")
  } finally {
    await rm(data, { recursive: true, force: true })
  }
})
