import assert from "node:assert/strict"
import test from "node:test"
import { normalizeTavernMemoryEntry, rankTavernMemories } from "./memory"

test("keeps Tavern memory layers isolated by project and conversation", () => {
  const project = normalizeTavernMemoryEntry({ id: "project", projectID: "character:a", layer: "project", content: "港口约定", createdAt: 1, updatedAt: 1, embedding: [1, 0] })!
  const conversation = normalizeTavernMemoryEntry({ id: "conversation", projectID: "character:a", conversationID: "session:a", layer: "conversation", content: "本次对话的线索", createdAt: 2, updatedAt: 2, embedding: [0.9, 0.1] })!
  const otherConversation = normalizeTavernMemoryEntry({ id: "other-conversation", projectID: "character:a", conversationID: "session:b", layer: "conversation", content: "不应召回", createdAt: 3, updatedAt: 3, embedding: [1, 0] })!
  const otherProject = normalizeTavernMemoryEntry({ id: "other-project", projectID: "character:b", layer: "project", content: "不应跨项目召回", createdAt: 4, updatedAt: 4, embedding: [1, 0] })!
  assert.deepEqual(rankTavernMemories({ entries: [project, conversation, otherConversation, otherProject], projectID: "character:a", conversationID: "session:a", embedding: [1, 0], limit: 8 }).map((item) => item.entry.id), ["project", "conversation"])
})

test("rejects malformed Tavern memory records", () => {
  assert.equal(normalizeTavernMemoryEntry({ id: "missing", projectID: "a", layer: "project" }), undefined)
  assert.equal(normalizeTavernMemoryEntry({ id: "bad", projectID: "a", layer: "project", content: "ok", embedding: [Number.NaN] })?.embedding, undefined)
})
