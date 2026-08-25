import { describe, expect, test } from "bun:test"
import { deflateSync, inflateSync } from "node:zlib"
import { createTavernCharacter, parseTavernCharacterCardPng, updateTavernCharacter } from "./tavern-character-card"

const encoder = new TextEncoder()
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const card = { spec: "chara_card_v2", data: { name: "Lana", description: "A test card" } }
const payload = btoa(JSON.stringify(card))

describe("Tavern PNG character cards", () => {
  test("creates a standalone editable character without an imported card", () => {
    expect(
      createTavernCharacter({
        id: "new-character",
        name: "  New character  ",
        prompt: " A new prompt ",
        firstMessage: " Welcome ",
        alternateGreetings: "Hello\nHi",
        tags: "original，custom",
      }),
    ).toEqual({
      id: "new-character",
      name: "New character",
      prompt: "A new prompt",
      description: "A new prompt",
      worldbookIDs: [],
      firstMessage: "Welcome",
      alternateGreetings: ["Hello", "Hi"],
      tags: ["original", "custom"],
    })
  })

  test("updates editable character fields without retaining a stale card source", () => {
    expect(
      updateTavernCharacter({
        character: {
          id: "lana",
          name: "Lana",
          prompt: "old",
          worldbookIDs: ["book"],
          avatar: "imports/characters/lana.png",
          expressions: [{ id: "smile", label: "Smile", path: "visuals/lana-smile.png", mime: "image/png" }],
          source: "imports/characters/lana.png",
        },
        name: "  Lana New  ",
        prompt: " New prompt ",
        firstMessage: " Hello ",
        alternateGreetings: "Hi\nWelcome",
        tags: "hero，friend",
      }),
    ).toEqual({
      id: "lana",
      name: "Lana New",
      prompt: "New prompt",
      description: "New prompt",
      worldbookIDs: ["book"],
      firstMessage: "Hello",
      alternateGreetings: ["Hi", "Welcome"],
      tags: ["hero", "friend"],
      avatar: "imports/characters/lana.png",
      expressions: [{ id: "smile", label: "Smile", path: "visuals/lana-smile.png", mime: "image/png" }],
    })
  })

  test("preserves structured V2 character fields when saving an edited card", () => {
    expect(
      updateTavernCharacter({
        character: { id: "lana", name: "Lana", prompt: "old", worldbookIDs: [] },
        name: "Lana",
        prompt: "Description",
        description: "Description",
        personality: "Calm",
        scenario: "A library",
        exampleDialogue: "{{char}}: Welcome.",
        systemPrompt: "Stay in character.",
        postHistoryInstructions: "Keep scenes concise.",
        depthPrompt: "Prioritize recent actions.",
        firstMessage: "Hello",
        alternateGreetings: "",
        tags: "",
      }),
    ).toEqual({
      id: "lana",
      name: "Lana",
      prompt: "Description",
      description: "Description",
      personality: "Calm",
      scenario: "A library",
      exampleDialogue: "{{char}}: Welcome.",
      systemPrompt: "Stay in character.",
      postHistoryInstructions: "Keep scenes concise.",
      depthPrompt: "Prioritize recent actions.",
      worldbookIDs: [],
      firstMessage: "Hello",
    })
  })

  test("reads a chara tEXt payload", async () => {
    const result = await parseTavernCharacterCardPng(
      png(chunk("tEXt", concat(encoder.encode("chara"), Uint8Array.of(0), encoder.encode(payload)))),
    )
    expect(result).toEqual(card)
  })

  test("reads a compressed zTXt payload", async () => {
    const compressed = new Uint8Array(deflateSync(Buffer.from(payload, "latin1")))
    const result = await parseTavernCharacterCardPng(
      png(chunk("zTXt", concat(encoder.encode("chara"), Uint8Array.of(0, 0), compressed))),
      async (input) => new TextDecoder("latin1").decode(inflateSync(input)),
    )
    expect(result).toEqual(card)
  })

  test("reads an uncompressed iTXt payload", async () => {
    const result = await parseTavernCharacterCardPng(
      png(chunk("iTXt", concat(encoder.encode("chara"), Uint8Array.of(0, 0, 0, 0, 0), encoder.encode(payload)))),
    )
    expect(result).toEqual(card)
  })
})

function png(...chunks: Uint8Array[]) {
  return concat(signature, ...chunks, chunk("IEND", new Uint8Array()))
}

function chunk(type: string, data: Uint8Array) {
  const value = new Uint8Array(12 + data.length)
  new DataView(value.buffer).setUint32(0, data.length)
  value.set(encoder.encode(type), 4)
  value.set(data, 8)
  return value
}

function concat(...values: Uint8Array[]) {
  const result = new Uint8Array(values.reduce((length, item) => length + item.length, 0))
  values.reduce((offset, item) => {
    result.set(item, offset)
    return offset + item.length
  }, 0)
  return result
}
