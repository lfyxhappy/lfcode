import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

describe("cpp routes", () => {
  test("POST /cpp/prepare-terminal-run returns a pwsh compile+run payload", async () => {
    await using tmp = await tmpdir()
    const previous = process.env.LFCODE_CXX_PATH
    const compiler = path.join(tmp.path, "bin", process.platform === "win32" ? "g++.exe" : "g++")
    await fs.mkdir(path.dirname(compiler), { recursive: true })
    await fs.writeFile(compiler, "", "utf8")
    process.env.LFCODE_CXX_PATH = compiler

    try {
      const source = path.join(tmp.path, "main.cpp")
      await fs.writeFile(source, "int main(){ return 0; }\n", "utf8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const app = Server.Default().app
          const response = await app.request(`/cpp/prepare-terminal-run?directory=${encodeURIComponent(tmp.path)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              path: "main.cpp",
              args: ["hello"],
            }),
          })
          expect(response.status).toBe(200)
          const data = await response.json()
          const payload = "data" in data ? data.data : data
          expect(payload.cwd).toBe(tmp.path)
          expect(payload.sourcePath).toBe(source)
          expect(payload.outputPath).toContain(path.join(".lfcode", "build", "cpp"))
          expect(payload.terminalTitle).toBe("C++ Run")
          expect(payload.command).toContain("& '")
          expect(payload.command).toContain("-std=c++20")
          expect(payload.command).toContain("if ($?)")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.LFCODE_CXX_PATH
      else process.env.LFCODE_CXX_PATH = previous
    }
  })

  test("POST /cpp/prepare-terminal-run rejects unsupported extensions", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "main.txt")
    await fs.writeFile(source, "hello\n", "utf8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default().app
        const response = await app.request(`/cpp/prepare-terminal-run?directory=${encodeURIComponent(tmp.path)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: "main.txt",
          }),
        })
        expect(response.status).toBe(500)
        const text = await response.text()
        expect(text).toContain("Unsupported C++ source extension")
      },
    })
  })
})
