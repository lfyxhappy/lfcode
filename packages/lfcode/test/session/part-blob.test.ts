import { describe, expect, test } from "bun:test"
import { hydrateStoredPart, isStoredBlobPart, storePartData } from "../../src/session/part-blob"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

function filePart(url: string): Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID"> {
  return {
    type: "file",
    mime: "image/png",
    filename: "image.png",
    url,
  }
}

describe("session part blob", () => {
  test("keeps small file parts inline", () => {
    const part = storePartData(filePart("data:image/png;base64,QUJD"))
    expect(part.url).toBe("data:image/png;base64,QUJD")
    expect(isStoredBlobPart(part)).toBe(false)
  })

  test("offloads large file parts and hydrates them back", () => {
    const raw = "data:image/png;base64," + "A".repeat(500_000)
    const stored = storePartData(filePart(raw))
    expect(stored.url.startsWith("lfcode-blob://")).toBe(true)
    expect(isStoredBlobPart(stored)).toBe(true)

    const hydrated = hydrateStoredPart({
      ...stored,
      id: PartID.make("p"),
      sessionID: SessionID.make("s"),
      messageID: MessageID.make("m"),
    } as MessageV2.FilePart)

    expect(hydrated.url).toBe(raw)
  })

  test("keeps reading safely when blob file is missing", () => {
    const raw = "data:image/png;base64," + "B".repeat(500_000)
    const stored = storePartData(filePart(raw))
    expect(isStoredBlobPart(stored)).toBe(true)
    if (!isStoredBlobPart(stored)) throw new Error("expected stored blob part")

    const hydrated = hydrateStoredPart({
      ...stored,
      blob: {
        ...stored.blob,
        path: stored.blob.path + ".missing",
      },
      id: PartID.make("p-missing"),
      sessionID: SessionID.make("s-missing"),
      messageID: MessageID.make("m-missing"),
    } as MessageV2.FilePart)

    expect(hydrated.url).toBe(stored.url)
  })
})
