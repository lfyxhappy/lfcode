import { describe, expect, test } from "bun:test"
import { BuiltinWorkflow } from "../../src/workflow/builtin"
import { parseMeta } from "../../src/workflow/meta"
import { evalScript } from "../../src/workflow/sandbox"

describe("BuiltinWorkflow registry", () => {
  test("lists deep-research with parsed meta", () => {
    const list = BuiltinWorkflow.list()
    const dr = list.find((w) => w.name === "deep-research")
    expect(dr).toBeDefined()
    expect(dr!.description).toContain("Deep research")
    expect(dr!.whenToUse).toContain("multi-source")
  })

  test("lists compose-orchestrator with parsed meta", () => {
    const list = BuiltinWorkflow.list()
    const compose = list.find((w) => w.name === "compose-orchestrator")
    expect(compose).toBeDefined()
    expect(compose!.description).toContain("Compose orchestration")
    expect(compose!.whenToUse).toContain("large")
  })

  test("get returns the script body starting with export const meta", () => {
    const dr = BuiltinWorkflow.get("deep-research")
    expect(dr).toBeDefined()
    expect(dr!.script.startsWith("export const meta")).toBe(true)
  })

  test("get returns the compose orchestrator script body starting with export const meta", () => {
    const compose = BuiltinWorkflow.get("compose-orchestrator")
    expect(compose).toBeDefined()
    expect(compose!.script.startsWith("export const meta")).toBe(true)
  })

  test("get returns undefined for an unknown name", () => {
    expect(BuiltinWorkflow.get("nope")).toBeUndefined()
  })

  test("compose-orchestrator dynamically fans out planned workstreams", async () => {
    const compose = BuiltinWorkflow.get("compose-orchestrator")
    expect(compose).toBeDefined()
    const parsed = parseMeta(compose!.script)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const phases: string[] = []
    const calls: { phase?: string; label?: string }[] = []
    const result = await evalScript(parsed.body, {
      phase: (title) => {
        phases.push(String(title))
        return undefined
      },
      agent: async (_prompt, opts) => {
        const info = opts as { phase?: string; label?: string }
        calls.push({ phase: info.phase, label: info.label })
        if (info.phase === "Inspect") {
          return {
            summary: "inspection",
            files: ["a.ts"],
            symbols: ["alpha"],
            tests: ["a.test.ts"],
            evidence: ["runtime"],
          }
        }
        if (info.phase === "Route") {
          return {
            summary: "large parallel work",
            taskType: "large-project",
            difficulty: "complex",
            strategy: "full-orchestration",
            requiresTaskBoard: true,
            requiresPlan: true,
            requiresReview: true,
            executionShape: "multi-workstream",
          }
        }
        if (info.phase === "Plan") {
          return {
            summary: "plan",
            workstreams: [
              { id: "W1", title: "one", goal: "first", prompt: "first prompt", verification: ["test one"] },
              { id: "W2", title: "two", goal: "second", prompt: "second prompt", verification: ["test two"] },
              { id: "W3", title: "three", goal: "third", prompt: "third prompt", verification: ["test three"] },
            ],
            verification: ["bun test"],
          }
        }
        if (info.phase === "Execute") {
          return `ran ${info.label}`
        }
        if (info.phase === "Review") {
          return { passed: true, summary: "review ok", drift: [], gaps: [] }
        }
        if (info.phase === "Verify") {
          return { passed: true, summary: "verify ok", evidence: ["bun test passed"], remaining: [] }
        }
        throw new Error(`unexpected phase ${info.phase ?? "unknown"}`)
      },
    }, { args: "large task" })
    expect(phases).toEqual(["Inspect", "Route", "Plan", "Execute", "Review", "Verify"])
    expect(calls.filter((call) => call.phase === "Execute").map((call) => call.label)).toEqual([
      "compose:execute-1",
      "compose:execute-2",
      "compose:execute-3",
    ])
    expect((result as { execute: string[] }).execute).toEqual([
      "ran compose:execute-1",
      "ran compose:execute-2",
      "ran compose:execute-3",
    ])
    expect((result as { route: { strategy: string } }).route.strategy).toBe("full-orchestration")
  })

  test("compose-orchestrator fails when verify does not pass", async () => {
    const compose = BuiltinWorkflow.get("compose-orchestrator")
    expect(compose).toBeDefined()
    const parsed = parseMeta(compose!.script)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    await expect(
      evalScript(
        parsed.body,
        {
          phase: () => undefined,
          agent: async (_prompt, opts) => {
            const info = opts as { phase?: string }
            if (info.phase === "Inspect") {
              return {
                summary: "inspection",
                files: ["a.ts"],
                symbols: ["alpha"],
                tests: ["a.test.ts"],
                evidence: ["runtime"],
              }
            }
            if (info.phase === "Route") {
              return {
                summary: "needs full flow",
                taskType: "large-project",
                difficulty: "complex",
                strategy: "full-orchestration",
                requiresTaskBoard: true,
                requiresPlan: true,
                requiresReview: true,
                executionShape: "multi-workstream",
              }
            }
            if (info.phase === "Plan") {
              return {
                summary: "plan",
                workstreams: [{ id: "W1", title: "one", goal: "first", prompt: "first prompt", verification: ["test one"] }],
                verification: ["bun test"],
              }
            }
            if (info.phase === "Execute") return "ran execute"
            if (info.phase === "Review") return { passed: true, summary: "review ok", drift: [], gaps: [] }
            if (info.phase === "Verify") {
              return { passed: false, summary: "verify missing", evidence: ["no tests"], remaining: ["run bun test"] }
            }
            throw new Error(`unexpected phase ${info.phase ?? "unknown"}`)
          },
        },
        { args: "large task" },
      ),
    ).rejects.toThrow("Verify gate failed")
  })

  test("compose-orchestrator routes simple tasks through the light strategy", async () => {
    const compose = BuiltinWorkflow.get("compose-orchestrator")
    expect(compose).toBeDefined()
    const parsed = parseMeta(compose!.script)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const phases: string[] = []
    const calls: { phase?: string; label?: string }[] = []
    const result = await evalScript(parsed.body, {
      phase: (title) => {
        phases.push(String(title))
        return undefined
      },
      agent: async (_prompt, opts) => {
        const info = opts as { phase?: string; label?: string }
        calls.push({ phase: info.phase, label: info.label })
        if (info.phase === "Inspect") {
          return {
            summary: "inspection",
            files: ["button.tsx"],
            symbols: ["Button"],
            tests: ["button.test.tsx"],
            evidence: ["ui"],
          }
        }
        if (info.phase === "Route") {
          return {
            summary: "small localized fix",
            taskType: "bug-fix",
            difficulty: "simple",
            strategy: "direct-execute",
            requiresTaskBoard: false,
            requiresPlan: false,
            requiresReview: false,
            executionShape: "single-shot",
          }
        }
        if (info.phase === "Execute") return `ran ${info.label}`
        if (info.phase === "Verify") {
          return { passed: true, summary: "verify ok", evidence: ["button test passed"], remaining: [] }
        }
        throw new Error(`unexpected phase ${info.phase ?? "unknown"}`)
      },
    }, { args: "simple task" })
    expect(phases).toEqual(["Inspect", "Route", "Execute", "Verify"])
    expect(calls.some((call) => call.phase === "Plan")).toBe(false)
    expect(calls.some((call) => call.phase === "Review")).toBe(false)
    expect((result as { route: { strategy: string } }).route.strategy).toBe("direct-execute")
    expect((result as { review: { passed: boolean } }).review.passed).toBe(true)
  })
})
