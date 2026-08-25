import { beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage"
import { HookDefinitionTable, HookRunTable } from "../../src/hook/hook.sql"
import { createHook, getHook, listHookRuns } from "../../src/hook/persistence"
import { dispatchHooks, executeHook, matchesHook } from "../../src/hook/runtime"

beforeEach(() => {
  Database.use((db) => {
    db.delete(HookRunTable).run()
    db.delete(HookDefinitionTable).run()
  })
})

describe("user hooks", () => {
  test("matches safe comma-separated globs without regular expressions", () => {
    const hook = createHook({ name: "tool", scope: "global", events: ["PreToolUse"], matcher: "shell,write?", handler: { type: "command", command: "exit 0" }, lifetime: "permanent" })
    expect(matchesHook(hook, { event: "PreToolUse", tool: "shell" })).toBe(true)
    expect(matchesHook(hook, { event: "PreToolUse", tool: "write1" })).toBe(true)
    expect(matchesHook(hook, { event: "PreToolUse", tool: "write12" })).toBe(false)
    expect(matchesHook(hook, { event: "PreToolUse", tool: "shell.*" })).toBe(false)
  })

  test("runs scopes in global-project-session order and stops after a block", async () => {
    createHook({ name: "global", scope: "global", events: ["PreToolUse"], matcher: "*", handler: { type: "command", command: "echo global" }, lifetime: "permanent" })
    createHook({ name: "project", scope: "project", projectID: "p", events: ["PreToolUse"], matcher: "*", handler: { type: "command", command: "echo project; exit 2", blockOnNonZero: true }, lifetime: "permanent" })
    createHook({ name: "session", scope: "session", sessionID: "s", events: ["PreToolUse"], matcher: "*", handler: { type: "command", command: "echo session" }, lifetime: "permanent" })
    const result = await dispatchHooks({ event: "PreToolUse", projectID: "p", sessionID: "s", tool: "shell" })
    expect(result.blocked).toBe(true)
    expect(result.runs.map((run) => run.summary)).toEqual(["global", "project"])
  })

  test("claims temporary runs before execution and redacts secrets in records", async () => {
    const hook = createHook({ name: "once", scope: "global", events: ["PreToolUse"], matcher: "*", handler: { type: "command", command: "echo ok" }, lifetime: "temporary", expiry: { kind: "once" } })
    await dispatchHooks({ event: "PreToolUse", tool: "shell", payload: { authorization: "top-secret", ordinary: "ok" } })
    await dispatchHooks({ event: "PreToolUse", tool: "shell" })
    expect(getHook(hook.id)?.enabled).toBe(false)
    const runs = listHookRuns({ hookID: hook.id })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.input.authorization).toBe("[redacted]")
  })

  test("preserves Unicode output from PowerShell command handlers", async () => {
    const hook = createHook({
      name: "unicode",
      scope: "global",
      events: ["UserPromptSubmit"],
      matcher: "*",
      handler: { type: "command", command: 'Write-Output "用户刚提交了一条消息"', shell: "powershell" },
      lifetime: "permanent",
    })
    const result = await executeHook(hook, { event: "UserPromptSubmit", payload: {} })
    expect(result.run.status).toBe("completed")
    expect(result.run.summary).toBe("用户刚提交了一条消息")
  })
})
