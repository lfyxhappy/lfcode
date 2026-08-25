import { describe, expect, test } from "bun:test"
import {
  createMessageCodeScratchPath,
  messageCodeFileStatus,
  readMessageCodeFile,
} from "./message-code-block-path"

describe("createMessageCodeScratchPath", () => {
  test("builds a stable scratch file path for generic code blocks", () => {
    expect(
      createMessageCodeScratchPath({
        sessionID: "ses_1",
        messageID: "msg_2",
        partID: "part_3",
        blockIndex: 4,
        language: "typescript",
      }),
    ).toBe(".lfcode/scratch/code/typescript/ses_1/msg_2-part_3-4.ts")
  })
})

describe("message code project file lookup", () => {
  test("starts pending before the asynchronous lookup resolves", () => {
    expect(messageCodeFileStatus()).toBe("pending")
  })

  test("returns exists for a confirmed project file", async () => {
    await expect(
      readMessageCodeFile(async () => ({ data: { exists: true, content: "class Task {}", checksum: "abc" } }), "src/Task.java"),
    ).resolves.toEqual({
      status: "exists",
      data: { exists: true, content: "class Task {}", checksum: "abc" },
    })
  })

  test("returns missing when the SDK reports no file", async () => {
    await expect(readMessageCodeFile(async () => ({ data: { exists: false, content: "" } }), "src/missing.ts")).resolves.toEqual({
      status: "missing",
    })
  })

  test("returns error when file existence cannot be read", async () => {
    await expect(
      readMessageCodeFile(async () => {
        throw new Error("offline")
      }, "src/unavailable.ts"),
    ).resolves.toEqual({ status: "error" })
  })
})
