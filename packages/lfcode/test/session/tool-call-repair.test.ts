import { describe, expect, test } from "bun:test"
import {
  describeUnavailableTool,
  findAvailableToolByNormalizedName,
  repairToolCallAlias,
} from "../../src/session/tool-call-repair"

describe("findAvailableToolByNormalizedName", () => {
  test("matches normalized punctuation variants", () => {
    expect(findAvailableToolByNormalizedName(["create_goal", "question"], "Create-Goal")).toBe("create_goal")
  })
})

describe("repairToolCallAlias", () => {
  test("repairs legacy task aliases into the task operation envelope", () => {
    const repaired = repairToolCallAlias({
      requestedToolName: "task_list_op",
      toolInput: JSON.stringify({ status: "open", include_terminal: true }),
      activeTools: ["task", "read"],
    })

    expect(repaired).toEqual({
      type: "repair",
      toolName: "task",
      reason: "legacy task alias task_list_op",
      input: JSON.stringify({
        operation: {
          action: "list",
          status: "open",
          include_terminal: true,
        },
      }),
    })
  })

  test("repairs legacy history aliases", () => {
    const repaired = repairToolCallAlias({
      requestedToolName: "history_search_op",
      toolInput: JSON.stringify({ query: "memory", limit: 5 }),
      activeTools: ["history"],
    })

    expect(repaired).toEqual({
      type: "repair",
      toolName: "history",
      reason: "legacy history alias history_search_op",
      input: JSON.stringify({
        operation: "search",
        query: "memory",
        limit: 5,
      }),
    })
  })

  test("repairs legacy question aliases with a single prompt shape", () => {
    const repaired = repairToolCallAlias({
      requestedToolName: "question_ask_op",
      toolInput: JSON.stringify({
        question: "继续吗？",
        header: "确认",
        options: [{ label: "是", description: "继续执行" }],
        multiple: false,
      }),
      activeTools: ["question"],
    })

    expect(repaired).toEqual({
      type: "repair",
      toolName: "question",
      reason: "legacy question alias question_ask_op",
      input: JSON.stringify({
        questions: [
          {
            question: "继续吗？",
            header: "确认",
            options: [{ label: "是", description: "继续执行" }],
            multiple: false,
          },
        ],
      }),
    })
  })

  test("repairs legacy goal aliases", () => {
    const repaired = repairToolCallAlias({
      requestedToolName: "goal_update_op",
      toolInput: JSON.stringify({ status: "blocked", reason: "need user input" }),
      activeTools: ["update_goal"],
    })

    expect(repaired).toEqual({
      type: "repair",
      toolName: "update_goal",
      reason: "legacy goal alias goal_update_op",
      input: JSON.stringify({ status: "blocked", reason: "need user input" }),
    })
  })

  test("reports when an alias target is unavailable in the current turn", () => {
    const repaired = repairToolCallAlias({
      requestedToolName: "task_list_op",
      toolInput: JSON.stringify({ status: "open" }),
      activeTools: ["read", "bash"],
    })

    expect(repaired).toEqual({
      type: "unavailable",
      toolName: "task",
      reason: "legacy task alias task_list_op",
      input: JSON.stringify({
        operation: {
          action: "list",
          status: "open",
        },
      }),
      error:
        'Tool alias "task_list_op" maps to "task", but "task" is not available in this turn. Available tools: read, bash',
    })
  })

  test("repairs pwsh alias calls into the legacy bash tool when needed", () => {
    const repaired = repairToolCallAlias({
      requestedToolName: "pwsh",
      toolInput: JSON.stringify({ command: "Get-Location", description: "Show cwd" }),
      activeTools: ["read", "bash"],
    })

    expect(repaired).toEqual({
      type: "repair",
      toolName: "bash",
      reason: "shell alias pwsh",
      input: JSON.stringify({ command: "Get-Location", description: "Show cwd" }),
    })
  })

  test("repairs the obsolete process tool name without reintroducing it", () => {
    expect(
      repairToolCallAlias({
        requestedToolName: "background_job",
        toolInput: JSON.stringify({ operation: "get", job_id: "job_123" }),
        activeTools: ["shell_process"],
      }),
    ).toEqual({
      type: "repair",
      toolName: "shell_process",
      reason: "obsolete shell-process alias",
      input: JSON.stringify({ operation: "get", job_id: "job_123" }),
    })

    expect(
      repairToolCallAlias({
        requestedToolName: "write",
        toolInput: JSON.stringify({ filePath: "src/a.ts", content: "export {}" }),
        activeTools: ["edit"],
      }),
    ).toBeUndefined()
  })

  test("repairs legacy glob calls into unified path search", () => {
    const repaired = repairToolCallAlias({
      requestedToolName: "glob",
      toolInput: JSON.stringify({ pattern: "*.ts", path: "src", limit: 20 }),
      activeTools: ["search", "read"],
    })

    expect(repaired).toEqual({
      type: "repair",
      toolName: "search",
      reason: "legacy glob tool replaced by unified search",
      input: JSON.stringify({
        kind: "path",
        query: "*.ts",
        path: "src",
        include: "*.ts",
        limit: 20,
      }),
    })
  })

  test("repairs legacy grep calls into unified content search", () => {
    const repaired = repairToolCallAlias({
      requestedToolName: "grep",
      toolInput: JSON.stringify({ pattern: "TODO", path: "src", include: "*.ts" }),
      activeTools: ["search", "read"],
    })

    expect(repaired).toEqual({
      type: "repair",
      toolName: "search",
      reason: "legacy grep tool replaced by unified search",
      input: JSON.stringify({
        kind: "content",
        query: "TODO",
        path: "src",
        include: "*.ts",
      }),
    })
  })
})

describe("describeUnavailableTool", () => {
  test("includes the active tool list", () => {
    expect(describeUnavailableTool("task_list_op", ["read", "bash"])).toBe(
      'Tool "task_list_op" is not available in this turn. Available tools: read, bash',
    )
  })

  test("guides hidden legacy edit tools to unified edit", () => {
    expect(describeUnavailableTool("symbol_edit", ["read", "edit"])).toBe(
      'Tool "symbol_edit" is not available in this turn. Available tools: read, edit Use "edit" only: operation="replace" for one exact current text block, operation="patch" for multiple hunks/files, or operation="write" for an intentional whole-file replacement.',
    )
  })

  test("adds unified search guidance for legacy glob/grep calls", () => {
    expect(describeUnavailableTool("glob", ["read", "search"])).toBe(
      'Tool "glob" is not available in this turn. Available tools: read, search Use "search" with {"kind":"path","query":"..."} for file discovery.',
    )
    expect(describeUnavailableTool("grep", ["read", "search"])).toBe(
      'Tool "grep" is not available in this turn. Available tools: read, search Use "search" with {"kind":"content","query":"..."} for content search.',
    )
  })
})
