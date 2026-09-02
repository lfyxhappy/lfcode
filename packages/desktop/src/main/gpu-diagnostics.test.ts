import { describe, expect, mock, test } from "bun:test"

mock.module("electron", () => ({
  app: {
    commandLine: { appendSwitch: () => undefined },
    getGPUFeatureStatus: () => ({ gpu_compositing: "enabled", webgl: "enabled" }),
    getGPUInfo: async () => ({
      auxAttributes: { glImplementation: "ANGLE (D3D11)", path: "C:/Users/example" },
      machineModelName: "private-model",
    }),
    getAppMetrics: () => [],
  },
}))

const { getGpuDiagnostics, gpuRuntimeStatus, normalizeGpuMode } = await import("./gpu-diagnostics")

describe("GPU diagnostics", () => {
  test("normalizes the controlled GPU mode and keeps auto as the default", () => {
    expect(normalizeGpuMode(undefined)).toBe("auto")
    expect(normalizeGpuMode(" D3D11 ")).toBe("d3d11")
    expect(normalizeGpuMode("software")).toBe("software")
    expect(normalizeGpuMode("disable-gpu")).toBe("auto")
  })

  test("classifies feature status without treating a page error as a global GPU failure", () => {
    expect(gpuRuntimeStatus({ gpu_compositing: "enabled", webgl: "enabled" }, { auxAttributes: { glImplementation: "ANGLE (D3D11)" } })).toBe(
      "hardware",
    )
    expect(gpuRuntimeStatus({ gpu_compositing: "disabled_software" }, undefined)).toBe("fallback")
    expect(gpuRuntimeStatus({ webgl: "unavailable_software" }, { auxAttributes: { glImplementation: "SwiftShader" } })).toBe("fallback")
    expect(gpuRuntimeStatus({}, {})).toBe("unknown")
  })

  test("returns a safe, structured snapshot", async () => {
    const snapshot = await getGpuDiagnostics()
    expect(snapshot).toMatchObject({
      mode: "auto",
      status: "hardware",
      hardwareAcceleration: "enabled",
      hardwareAccelerated: true,
      backend: "ANGLE (D3D11)",
      gpuProcesses: [],
    })
    expect(snapshot.info).not.toHaveProperty("machineModelName")
    expect(snapshot.info).toMatchObject({ auxAttributes: { glImplementation: "ANGLE (D3D11)" } })
    expect(snapshot.info).not.toHaveProperty("auxAttributes.path")
  })
})
