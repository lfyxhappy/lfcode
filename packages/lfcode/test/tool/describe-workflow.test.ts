import { describe, expect, test } from "bun:test"
import { renderWorkflowCatalog } from "../../src/tool/registry"

describe("workflow catalog description", () => {
  test("lists deep-research with its whenToUse", () => {
    const text = renderWorkflowCatalog()
    expect(text).toContain("deep-research")
    expect(text).toContain("Deep research")
    expect(text).toContain("multi-source")
    expect(text).toContain('name: "deep-research"')
  })

  test("lists compose-orchestrator with its workflow phases", () => {
    const text = renderWorkflowCatalog()
    expect(text).toContain("compose-orchestrator")
    expect(text).toContain("Compose orchestration")
    expect(text).toContain("Inspect")
    expect(text).toContain("Verify")
  })
})
