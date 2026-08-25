import { describe, expect, test } from "bun:test"
import { resolveTavernPluginAvailability } from "./tavern-plugin-availability"

const plugin = (input: Partial<{
  enabled: boolean
  server: { status: "ready" | "missing" | "unresolved" | "error" }
  runtime: { lifecycle: "active" | "disabled" | "degraded" }
}> = {}) => ({
  enabled: true,
  manifest: { id: "lfcode-tavern" },
  server: { status: "ready" as const },
  runtime: { lifecycle: "active" as const },
  ...input,
})

describe("resolveTavernPluginAvailability", () => {
  test("等待插件目录加载完成后才允许渲染可写会话", () => {
    expect(resolveTavernPluginAvailability({ pending: true })).toEqual({ kind: "checking" })
    expect(resolveTavernPluginAvailability({ plugins: [plugin()] })).toEqual({ kind: "ready" })
  })

  test("插件缺失、禁用、降级或状态请求失败时进入恢复页", () => {
    expect(resolveTavernPluginAvailability({ plugins: [] })).toEqual({ kind: "unavailable", reason: "missing" })
    expect(resolveTavernPluginAvailability({ plugins: [plugin({ enabled: false })] })).toEqual({ kind: "unavailable", reason: "disabled" })
    expect(resolveTavernPluginAvailability({ plugins: [plugin({ runtime: { lifecycle: "degraded" } })] })).toEqual({ kind: "unavailable", reason: "degraded" })
    expect(resolveTavernPluginAvailability({ error: new Error("offline") })).toEqual({ kind: "unavailable", reason: "unreachable" })
  })
})
