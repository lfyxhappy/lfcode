import { describe, expect, test } from "bun:test"
import { projectLanMessages } from "./lan-message-projection"

describe("LAN message projection", () => {
  test("keeps only display-safe message data", () => {
    const projected = projectLanMessages([
      {
        info: {
          id: "msg_assistant",
          sessionID: "ses_visible",
          parentID: "msg_user",
          role: "assistant",
          time: { created: 1, completed: 2, updated: 3 },
          agent: "build",
          modelID: "gpt-safe",
          providerID: "provider_secret",
          path: { cwd: "C:\\secret\\workspace", root: "C:\\secret" },
          cost: 12,
          tokens: { input: 1, output: 2 },
        },
        parts: [
          { id: "part_text", type: "text", text: "secret response" },
          { id: "part_reasoning", type: "reasoning", text: "secret reasoning" },
          { id: "part_tool", type: "tool", tool: "bash", callID: "call_secret", state: { status: "completed", input: { command: "cmd.exe /c secret" }, output: "secret output", raw: "secret raw", metadata: { path: "C:\\secret" } } },
          { id: "part_file", type: "file", filename: "C:\\secret\\image.png", mime: "image/png", url: "file:///C:/secret/image.png", blob: { path: "C:\\secret\\image.png" } },
          { id: "part_compaction", type: "compaction", snapshot: "secret snapshot" },
          { id: "part_step", type: "step-finish", snapshot: "secret step" },
          { id: "part_unknown", type: "agent", name: "secret agent" },
        ],
      },
    ], (value) => value.replace(/secret/g, "[redacted]"))

    expect(projected).toEqual([
      {
        info: {
          id: "msg_assistant",
          sessionID: "ses_visible",
          parentID: "msg_user",
          role: "assistant",
          time: { created: 1, completed: 2 },
          agent: "build",
          model: "gpt-safe",
        },
        parts: [
          { id: "part_text", type: "text", text: "[redacted] response" },
          { id: "part_reasoning", type: "reasoning", text: "[redacted] reasoning" },
          { id: "part_tool", type: "tool-summary", label: "执行工具", status: "completed" },
          { id: "part_file", type: "attachment", name: "image.png", mime: "image/png" },
          { id: "part_compaction", type: "divider", kind: "compaction" },
          { id: "part_step", type: "divider", kind: "step" },
        ],
      },
    ])

    const serialized = JSON.stringify(projected)
    for (const hidden of ["call_secret", "cmd.exe", "output", "raw", "metadata", "file://", "C:\\secret", "snapshot", "secret agent", "provider_secret", "tokens"]) {
      expect(serialized).not.toContain(hidden)
    }
  })

  test("drops malformed entries and unknown part kinds", () => {
    expect(projectLanMessages([null, { info: {}, parts: [{ type: "tool", state: { status: "invalid" } }] }], (value) => value)).toEqual([
      { info: { role: "message" }, parts: [] },
    ])
    expect(projectLanMessages({ messages: [] }, (value) => value)).toEqual([])
  })

  test("marks only validated inline images as previewable without exposing their URL", () => {
    const image = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]).toString("base64")}`
    const projected = projectLanMessages([{ info: { sessionID: "ses_visible", role: "user" }, parts: [
      { id: "part_image", type: "file", filename: "image.png", mime: "image/png", url: image },
      { id: "part_external", type: "file", filename: "other.png", mime: "image/png", url: "https://example.com/other.png" },
    ] }], (value) => value)

    expect(projected[0]?.parts).toEqual([
      { id: "part_image", type: "attachment", name: "image.png", mime: "image/png", preview: true },
      { id: "part_external", type: "attachment", name: "other.png", mime: "image/png" },
    ])
    expect(JSON.stringify(projected)).not.toContain("data:image")
    expect(JSON.stringify(projected)).not.toContain("example.com")
  })
})
