import { describe, expect, test } from "bun:test"
import { mkdir, writeFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { stageBundledPythonRuntimeFrom } from "./bundled-python"

async function makeSource(root: string) {
  await mkdir(path.join(root, "DLLs"), { recursive: true })
  await mkdir(path.join(root, "Lib", "encodings"), { recursive: true })
  await mkdir(path.join(root, "Lib", "ensurepip"), { recursive: true })
  await mkdir(path.join(root, "Lib", "site-packages", "hugepkg"), { recursive: true })
  await mkdir(path.join(root, "Lib", "test"), { recursive: true })
  await mkdir(path.join(root, "Lib", "tkinter"), { recursive: true })
  await mkdir(path.join(root, "Lib", "venv"), { recursive: true })
  await mkdir(path.join(root, "Lib", "__pycache__"), { recursive: true })
  await mkdir(path.join(root, "Scripts"), { recursive: true })
  await writeFile(path.join(root, "python.exe"), "")
  await writeFile(path.join(root, "python313.dll"), "")
  await writeFile(path.join(root, "vcruntime140.dll"), "")
  await writeFile(path.join(root, "LICENSE.txt"), "license")
  await writeFile(path.join(root, "Lib", "os.py"), "import sys")
  await writeFile(path.join(root, "Lib", "encodings", "__init__.py"), "")
  await writeFile(path.join(root, "Lib", "ensurepip", "__init__.py"), "")
  await writeFile(path.join(root, "Lib", "site-packages", "hugepkg", "__init__.py"), "")
  await writeFile(path.join(root, "Lib", "test", "test_os.py"), "")
  await writeFile(path.join(root, "Lib", "tkinter", "__init__.py"), "")
  await writeFile(path.join(root, "Lib", "venv", "__init__.py"), "")
}

describe("bundled python staging", () => {
  test("keeps runtime essentials and strips heavy optional trees", async () => {
    const root = path.join(tmpdir(), `lfcode-bundled-python-${process.pid}-${Date.now()}`)
    const source = path.join(root, "source")
    const target = path.join(root, "target")
    try {
      await makeSource(source)
      await stageBundledPythonRuntimeFrom(source, target)
      expect(await Bun.file(path.join(target, "python.exe")).exists()).toBe(true)
      expect(await Bun.file(path.join(target, "Lib", "os.py")).exists()).toBe(true)
      expect(await Bun.file(path.join(target, "Lib", "encodings", "__init__.py")).exists()).toBe(true)
      expect(await Bun.file(path.join(target, "Lib", "ensurepip", "__init__.py")).exists()).toBe(true)
      expect(await Bun.file(path.join(target, "Lib", "venv", "__init__.py")).exists()).toBe(true)
      expect((await stat(path.join(target, "Lib", "site-packages"))).isDirectory()).toBe(true)
      expect(await Bun.file(path.join(target, "Lib", "site-packages", "hugepkg", "__init__.py")).exists()).toBe(false)
      expect(await Bun.file(path.join(target, "Lib", "test", "test_os.py")).exists()).toBe(false)
      expect(await Bun.file(path.join(target, "Lib", "tkinter", "__init__.py")).exists()).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
