import { describe, expect, test } from "bun:test"
import { cycleModelVariant, displayModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./model-variant"

describe("model variant", () => {
  test("resolves configured agent variant when model matches", () => {
    const value = getConfiguredAgentVariant({
      agent: {
        model: { providerID: "openai", modelID: "gpt-5.2" },
        variant: "xhigh",
      },
      model: {
        providerID: "openai",
        modelID: "gpt-5.2",
        variants: { low: {}, high: {}, xhigh: {} },
      },
    })

    expect(value).toBe("xhigh")
  })

  test("ignores configured variant when model does not match", () => {
    const value = getConfiguredAgentVariant({
      agent: {
        model: { providerID: "openai", modelID: "gpt-5.2" },
        variant: "xhigh",
      },
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variants: { low: {}, high: {}, xhigh: {} },
      },
    })

    expect(value).toBeUndefined()
  })

  test("prefers selected variant over configured variant", () => {
    const value = resolveModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: "high",
      configured: "xhigh",
    })

    expect(value).toBe("high")
  })

  test("lets an explicit default override the configured variant", () => {
    const value = resolveModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "xhigh",
    })

    expect(value).toBeUndefined()
  })

  test("displays configured variant when effective variant is inherited", () => {
    const value = displayModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: "xhigh",
    })

    expect(value).toBe("xhigh")
  })

  test("defaults to the highest detected variant when no explicit or configured variant exists", () => {
    const value = displayModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: undefined,
    })

    expect(value).toBe("xhigh")
  })

  test("uses the highest variant for requests when no explicit or configured variant exists", () => {
    const value = resolveModelVariant({
      variants: ["low", "high", "max"],
      selected: undefined,
      configured: undefined,
    })

    expect(value).toBe("max")
  })

  test("uses the highest available variant without requiring max", () => {
    const value = resolveModelVariant({
      variants: ["low", "high"],
      selected: undefined,
      configured: undefined,
    })

    expect(value).toBe("high")
  })

  test("keeps explicit default visible as default", () => {
    const value = displayModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "xhigh",
    })

    expect(value).toBeUndefined()
  })

  test("cycles from configured variant to next", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: "high",
    })

    expect(value).toBe("xhigh")
  })

  test("wraps from configured last variant to first", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: undefined,
      configured: "xhigh",
    })

    expect(value).toBe("low")
  })

  test("cycles from an explicit default to the first variant", () => {
    const value = cycleModelVariant({
      variants: ["low", "high", "xhigh"],
      selected: null,
      configured: "xhigh",
    })

    expect(value).toBe("low")
  })
})
