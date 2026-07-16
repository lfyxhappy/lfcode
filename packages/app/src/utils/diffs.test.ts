import { describe, expect, test } from "bun:test"
import type { SnapshotFileDiff } from "@lfcode-ai/sdk/v2"
import type { Message } from "@lfcode-ai/sdk/v2/client"
import { diffs, message } from "./diffs"

const item = {
  file: "src/app.ts",
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  additions: 1,
  deletions: 1,
  status: "modified",
} satisfies SnapshotFileDiff

describe("diffs", () => {
  test("normalizes valid arrays", () => {
    expect(diffs([item])).toEqual([{ ...item, patch: "" }])
  })

  test("merges repeated file diffs into one row", () => {
    expect(
      diffs([
        item,
        {
          ...item,
          patch: "@@ -3 +3 @@\n-older\n+newer\n",
          additions: 2,
          deletions: 3,
        },
      ]),
    ).toEqual([
      {
        ...item,
        patch: "",
        additions: 3,
        deletions: 4,
        status: "modified",
      },
    ])
  })

  test("wraps a single diff object", () => {
    expect(diffs(item)).toEqual([{ ...item, patch: "" }])
  })

  test("reads keyed diff objects", () => {
    expect(diffs({ a: item })).toEqual([{ ...item, patch: "" }])
  })

  test("drops invalid entries", () => {
    expect(
      diffs([
        item,
        { file: "src/bad.ts", additions: 1, deletions: 1 },
        { patch: item.patch, additions: 1, deletions: 1 },
      ]),
    ).toEqual([{ ...item, patch: "" }])
  })
})

describe("message", () => {
  test("normalizes user summaries with object diffs", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: {
        title: "Edit",
        diffs: { a: item },
      },
    } as unknown as Message

    expect(message(input)).toMatchObject({
      summary: {
        title: "Edit",
        diffs: [{ ...item, patch: "" }],
      },
    })
  })

  test("drops invalid user summaries", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: true,
    } as unknown as Message

    expect(message(input)).toMatchObject({ summary: undefined })
  })

  test("merges duplicate summary diffs by file", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: {
        diffs: [
          item,
          {
            ...item,
            patch: "@@ -2 +2 @@\n-old\n+newer\n",
            additions: 5,
            deletions: 2,
            status: "modified",
          },
        ],
      },
    } as unknown as Message

    expect(message(input)).toMatchObject({
      summary: {
        diffs: [
          {
            file: item.file,
            patch: "",
            additions: 6,
            deletions: 3,
            status: "modified",
          },
        ],
      },
    })
  })
})
