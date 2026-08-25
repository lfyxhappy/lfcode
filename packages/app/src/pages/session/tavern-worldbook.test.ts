import { describe, expect, test } from "bun:test"
import { renderTavernWorldbookSections, renderTavernWorldbooks, updateTavernWorldbook } from "./tavern-worldbook"

describe("Tavern worldbooks", () => {
  test("updates a worldbook as formatted JSON and clears its imported source", () => {
    expect(updateTavernWorldbook({
      worldbook: { id: "book", name: "Old", content: "{}", source: "imports/worldbooks/old.json" },
      name: "  New lore  ",
      content: '{"entries":{"1":{"content":"New"}}}',
    })).toEqual({
      id: "book",
      name: "New lore",
      content: '{\n  "entries": {\n    "1": {\n      "content": "New"\n    }\n  }\n}',
    })
  })

  test("rejects an invalid worldbook edit", () => {
    expect(() => updateTavernWorldbook({ worldbook: { id: "book", name: "Old", content: "{}" }, name: "Old", content: "not json" })).toThrow("世界书必须是有效 JSON")
  })

  test("selects constant and matching entries in priority order", () => {
    const result = renderTavernWorldbooks({
      worldbookIDs: ["book"],
      worldbooks: [{
        id: "book",
        name: "World",
        content: JSON.stringify({
          entries: {
            1: { content: "Always", constant: true, order: 10 },
            2: { content: "Dragon", key: ["dragon"], order: 30 },
            3: { content: "Hidden", key: ["dragon"], keysecondary: ["cave"], selective: true, order: 40 },
            4: { content: "Disabled", constant: true, disable: true, order: 50 },
          },
        }),
      }],
      transcript: [{ role: "user", text: "I enter the dragon cave." }],
    })

    expect(result).toEqual(["Hidden", "Dragon", "Always"])
  })

  test("keeps a legacy plain-text book usable", () => {
    const result = renderTavernWorldbooks({
      worldbookIDs: ["book"],
      worldbooks: [{ id: "book", name: "World", content: "The city never sleeps." }],
      transcript: [],
    })

    expect(result).toEqual(["The city never sleeps."])
  })

  test("respects entry and text budgets", () => {
    const result = renderTavernWorldbooks({
      worldbookIDs: ["book"],
      worldbooks: [{
        id: "book",
        name: "World",
        content: JSON.stringify({ entries: [{ content: "One", constant: true }, { content: "Two", constant: true }] }),
      }],
      transcript: [],
      maxEntries: 1,
      maxCharacters: 10,
    })

    expect(result).toEqual(["One"])
  })

  test("supports recursive, probabilistic, regex, scan-depth, and exclusion-group entries", () => {
    const result = renderTavernWorldbooks({
      worldbookIDs: ["book"],
      worldbooks: [{
        id: "book",
        name: "World",
        content: JSON.stringify({ entries: {
          a: { uid: "a", content: "A dragon guards the archive.", key: ["^dragon$"], use_regex: true, scan_depth: 1, recursive: true, order: 20 },
          b: { uid: "b", content: "Recursive archive lore", key: ["archive"], recursive: true, order: 10 },
          c: { uid: "c", content: "Winning group entry", constant: true, group: "choice", order: 30 },
          d: { uid: "d", content: "Losing group entry", constant: true, group: "choice", order: 10 },
          e: { uid: "e", content: "Probability entry", constant: true, probability: 25 },
        } }),
      }],
      transcript: [{ role: "user", text: "old dragon" }, { role: "assistant", text: "dragon" }],
      random: () => 0.2,
    })

    expect(result).toEqual(["Probability entry", "Winning group entry", "A dragon guards the archive.", "Recursive archive lore"])
  })

  test("rejects unsafe regular expressions and observes a token budget", () => {
    const result = renderTavernWorldbooks({
      worldbookIDs: ["book"],
      worldbooks: [{
        id: "book",
        name: "World",
        content: JSON.stringify({ entries: [
          { content: "Unsafe", key: ["(a+)+"], use_regex: true },
          { content: "Four", constant: true },
          { content: "Five", constant: true },
        ] }),
      }],
      transcript: [{ role: "user", text: "aaaa" }],
      maxTokens: 1,
    })

    expect(result).toEqual(["Four"])
  })

  test("honors SillyTavern useProbability and recursion flags", () => {
    const result = renderTavernWorldbooks({
      worldbookIDs: ["book"],
      worldbooks: [{
        id: "book",
        name: "World",
        content: JSON.stringify({ entries: [
          { uid: "root", content: "Root archive", key: ["root"], excludeRecursion: false },
          { uid: "child", content: "Child", key: ["archive"], excludeRecursion: false, useProbability: false, probability: 0 },
          { uid: "blocked", content: "Blocked", key: ["archive"], excludeRecursion: true },
        ] }),
      }],
      transcript: [{ role: "user", text: "root" }],
      random: () => 0.99,
    })

    expect(result).toEqual(["Root archive", "Child"])
  })

  test("keeps SillyTavern insertion positions and depth available to the prompt builder", () => {
    const input = {
      worldbookIDs: ["book"],
      worldbooks: [{
        id: "book",
        name: "World",
        content: JSON.stringify({ entries: [
          { content: "Before character", constant: true, position: 0 },
          { content: "After character", constant: true, position: 1 },
          { content: "Before examples", constant: true, position: 2 },
          { content: "After examples", constant: true, position: 3 },
          { content: "Before note", constant: true, position: 4 },
          { content: "After note", constant: true, position: 5 },
          { content: "At depth", constant: true, position: 6, depth: 7 },
        ] }),
      }],
      transcript: [],
    }

    expect(renderTavernWorldbookSections(input)).toEqual({
      beforeCharacter: ["Before character"],
      afterCharacter: ["After character"],
      beforeExamples: ["Before examples"],
      afterExamples: ["After examples"],
      beforeAuthorNote: ["Before note"],
      afterAuthorNote: ["After note"],
      depth: [{ content: "At depth", depth: 7 }],
    })
    expect(renderTavernWorldbooks(input)).toEqual([
      "Before character",
      "After character",
      "Before examples",
      "After examples",
      "Before note",
      "After note",
      "At depth",
    ])
  })
})
