import { describe, expect, test } from "bun:test"
import z from "zod"
import {
  AUTO_SCHEMA_BYTES_THRESHOLD,
  AUTO_TOOL_COUNT_THRESHOLD,
  nativeToolsForPresentation,
  resolvePresentation,
  sdkDeclaration,
} from "../../src/tool/code-mode"

const tool = (id: string) => ({ id, parameters: z.object({ value: z.string() }) })

describe("Code Mode presentation", () => {
  test("keeps a small tool set native in auto mode", () => {
    expect(resolvePresentation({ configured: "auto", tools: [tool("read")] })).toBe("native")
  })

  test("switches auto mode above the visible tool threshold", () => {
    expect(resolvePresentation({ configured: "auto", tools: Array.from({ length: AUTO_TOOL_COUNT_THRESHOLD + 1 }, (_, index) => tool(`tool_${index}`)) })).toBe("code")
  })

  test("switches auto mode above the schema threshold", () => {
    expect(resolvePresentation({ configured: "auto", tools: [{ id: "large", parameters: z.object({ value: z.string().describe("x".repeat(AUTO_SCHEMA_BYTES_THRESHOLD)) }) }] })).toBe("code")
  })

  test("emits callable TypeScript SDK members only for valid identifiers", () => {
    expect(sdkDeclaration([{ id: "read" }, { id: "bad-name" }])).toContain("read(args")
    expect(sdkDeclaration([{ id: "bad-name" }])).not.toContain("bad-name(args")
  })

  test("keeps the complete catalog native when code mode is selected", () => {
    const tools = [
      tool("shell"),
      tool("read"),
      tool("edit"),
      tool("skill"),
      tool("task"),
      tool("browser"),
      tool("mcp_search_tool"),
      tool("mcp_use_tool"),
    ]
    expect(nativeToolsForPresentation("code", tools).map((item) => item.id)).toEqual(tools.map((item) => item.id))
  })

  test("keeps browser and MCP tools native in every presentation", () => {
    const tools = [tool("browser"), tool("mcp_search_tool"), tool("mcp_use_tool")]
    for (const presentation of ["native", "code", "both"] as const) {
      expect(nativeToolsForPresentation(presentation, tools)).toEqual(tools)
    }
  })
})
