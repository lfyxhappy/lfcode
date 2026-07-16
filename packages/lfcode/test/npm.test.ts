import path from "path"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { Npm } from "../src/npm"
import { tmpdir } from "./fixture/fixture"

describe("Npm.sanitize", () => {
  test("uses canonical spec SHA-256 keys", () => {
    expect(Npm.sanitize("@lfcode/acme")).toMatch(/^[a-f0-9]{64}$/)
    expect(Npm.sanitize("@lfcode/acme")).toBe(Npm.sanitize(" @lfcode/acme@* "))
    expect(Npm.sanitize("@lfcode/acme@1.0.0")).not.toBe(Npm.sanitize("@lfcode/acme@2.0.0"))
  })

  test("keeps resolved cache paths contained", () => {
    const root = path.resolve("cache", "packages")
    const target = Npm.resolveCacheDirectory(root, "../../outside")
    expect(path.dirname(target)).toBe(root)
    expect(path.basename(target)).toMatch(/^[a-f0-9]{64}$/)
  })

  test("repairs incomplete caches atomically and keeps failed installs out of the active cache", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pkg = path.join(dir, "plugin")
        await fs.mkdir(pkg, { recursive: true })
        await Bun.write(
          path.join(pkg, "package.json"),
          JSON.stringify({ name: "local-cache-test", version: "1.0.0", main: "index.js" }),
        )
        await Bun.write(path.join(pkg, "index.js"), "export default 1\n")
        return { home: path.join(dir, "home"), pkg }
      },
    })

    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        [
          `import fs from "fs/promises"`,
          `import path from "path"`,
          `const { Npm } = await import("./src/npm")`,
          `const { Global } = await import("./src/global")`,
          `const first = await Npm.add(process.env.TEST_PACKAGE)`,
          `const cache = path.join(Global.Path.cache, "packages", Npm.cacheKey(process.env.TEST_PACKAGE))`,
          `await fs.rm(path.join(cache, ".lfcode-install.json"))`,
          `await fs.writeFile(path.join(cache, "partial.txt"), "partial")`,
          `const [second, concurrent] = await Promise.all([Npm.add(process.env.TEST_PACKAGE), Npm.add(process.env.TEST_PACKAGE)])`,
          `const missing = path.join(Global.Path.cache, "missing.tgz")`,
          `const failedCache = path.join(Global.Path.cache, "packages", Npm.cacheKey(missing))`,
          `await fs.mkdir(failedCache, { recursive: true })`,
          `await fs.writeFile(path.join(failedCache, "sentinel.txt"), "keep")`,
          `let failed = false`,
          `try { await Npm.add(missing) } catch { failed = true }`,
          `const temps = (await fs.readdir(path.dirname(cache))).filter((name) => name.includes(".tmp-"))`,
          `console.log(JSON.stringify({`,
          `  same: first.directory === second.directory,`,
          `  concurrent: second.directory === concurrent.directory,`,
          `  restored: await Bun.file(path.join(second.directory, "package.json")).exists(),`,
          `  partial: await Bun.file(path.join(cache, "partial.txt")).exists(),`,
          `  failed,`,
          `  sentinel: await Bun.file(path.join(failedCache, "sentinel.txt")).exists(),`,
          `  temps: temps.length,`,
          `}))`,
        ].join("\n"),
      ],
      {
        cwd: path.resolve("."),
        env: { ...process.env, LFCODE_HOME: tmp.extra.home, TEST_PACKAGE: tmp.extra.pkg },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe("")
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      same: true,
      concurrent: true,
      restored: true,
      partial: false,
      failed: true,
      sentinel: true,
      temps: 0,
    })
  })
})
