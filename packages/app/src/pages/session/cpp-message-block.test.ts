import { describe, expect, test } from "bun:test"
import { createCppMessageScratchPath } from "./cpp-message-block-path"

describe("createCppMessageScratchPath", () => {
  test("builds a stable scratch file path for message blocks", () => {
    expect(
      createCppMessageScratchPath({
        sessionID: "ses_1",
        messageID: "msg_2",
        partID: "part_3",
        blockIndex: 4,
      }),
    ).toBe(".lfcode/scratch/cpp/ses_1/msg_2-part_3-4.cpp")
  })
})
