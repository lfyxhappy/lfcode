import { afterEach, describe, expect, mock, test } from "bun:test"
import { emitCodeEditorMetric, getCodeEditorMetricEventName, startCodeEditorMetric } from "./metrics"

describe("code editor metrics helpers", () => {
  afterEach(() => {
    mock.restore()
  })

  test("emits metric events", () => {
    const events: Event[] = []
    const handler = (event: Event) => events.push(event)
    window.addEventListener(getCodeEditorMetricEventName(), handler)

    emitCodeEditorMetric({
      stage: "editor:ready",
      path: "C:\\demo\\main.tsx",
      language: "typescript",
      at: 123,
      duration: 45,
    })

    window.removeEventListener(getCodeEditorMetricEventName(), handler)
    expect(events).toHaveLength(1)
    const detail = (events[0] as CustomEvent).detail
    expect(detail.stage).toBe("editor:ready")
    expect(detail.duration).toBe(45)
  })

  test("measures duration between start and completion", () => {
    const now = mock()
      .mockImplementationOnce(() => 100)
      .mockImplementationOnce(() => 145)
      .mockImplementationOnce(() => 145)
    const original = performance.now
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: now,
    })

    const events: CustomEvent[] = []
    const handler = (event: Event) => events.push(event as CustomEvent)
    window.addEventListener(getCodeEditorMetricEventName(), handler)

    startCodeEditorMetric("runtime:start", {
      path: "C:\\demo\\main.tsx",
      language: "typescript",
    })("runtime:ready")

    window.removeEventListener(getCodeEditorMetricEventName(), handler)
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: original,
    })

    expect(events).toHaveLength(2)
    expect(events[1].detail.duration).toBe(45)
    expect(events[1].detail.stage).toBe("runtime:ready")
  })
})
