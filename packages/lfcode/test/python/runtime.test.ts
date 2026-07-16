import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  formatPythonCommand,
  managedPythonExecutable,
  resolveBasePythonCommand,
  resolveManagedPythonCommand,
  resolvePythonCommand,
} from "../../src/python/runtime"

const withBundledPython = async (fn: (pythonPath: string) => void | Promise<void>) => {
  const prev = process.env.LFCODE_PYTHON_PATH
  const root = path.join(tmpdir(), `lfcode-python-test-${process.pid}-${Date.now()}`)
  const pythonPath = path.join(root, process.platform === "win32" ? "python.exe" : "python")
  mkdirSync(path.dirname(pythonPath), { recursive: true })
  await Bun.write(pythonPath, "")
  process.env.LFCODE_PYTHON_PATH = pythonPath
  try {
    await fn(pythonPath)
  } finally {
    if (prev === undefined) delete process.env.LFCODE_PYTHON_PATH
    else process.env.LFCODE_PYTHON_PATH = prev
    rmSync(root, { recursive: true, force: true })
  }
}

describe("python runtime", () => {
  test("prefers LFCODE_PYTHON_PATH when provided", async () => {
    await withBundledPython(async (pythonPath) => {
      expect(resolveBasePythonCommand()).toEqual({
        command: pythonPath,
        args: [],
      })
    })
  })

  test("prefers managed python when configured", async () => {
    const prev = process.env.LFCODE_MANAGED_PYTHON_PATH
    const root = path.join(tmpdir(), `lfcode-managed-python-test-${process.pid}-${Date.now()}`)
    const pythonPath = managedPythonExecutable(root)
    mkdirSync(path.dirname(pythonPath), { recursive: true })
    await Bun.write(pythonPath, "")
    process.env.LFCODE_MANAGED_PYTHON_PATH = pythonPath
    try {
      expect(resolveManagedPythonCommand()).toEqual({
        command: pythonPath,
        args: [],
      })
      expect(resolvePythonCommand()).toEqual({
        command: pythonPath,
        args: [],
      })
    } finally {
      if (prev === undefined) delete process.env.LFCODE_MANAGED_PYTHON_PATH
      else process.env.LFCODE_MANAGED_PYTHON_PATH = prev
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("formats python command with args", () => {
    expect(
      formatPythonCommand({
        command: "py.exe",
        args: ["-3"],
      }),
    ).toBe("py.exe -3")
  })
})
