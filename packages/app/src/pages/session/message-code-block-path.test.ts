import { describe, expect, test } from "bun:test"
import { createMessageCodeScratchPath } from "./message-code-block-path"

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
