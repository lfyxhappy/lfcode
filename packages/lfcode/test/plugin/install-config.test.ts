import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { patchPluginConfig } from "../../src/plugin/install"

test("patchPluginConfig writes plugins field for new server installs", async () => {
  await using tmp = await tmpdir()

  const result = await patchPluginConfig({
    spec: "demo-plugin@1.0.0",
    targets: [{ kind: "server" }],
    global: true,
    config: tmp.path,
    worktree: tmp.path,
    directory: tmp.path,
  })

  expect(result).toMatchObject({ ok: true })
  const text = await fs.readFile(path.join(tmp.path, "lfcode.json"), "utf8")
  expect(text).toContain('"plugins"')
  expect(text).not.toContain('"plugin"')
})

test("patchPluginConfig migrates legacy plugin field to plugins", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "lfcode.json"),
        JSON.stringify({
          plugin: ["legacy-plugin@1.0.0"],
        }),
      )
    },
  })

  const result = await patchPluginConfig({
    spec: "legacy-plugin@1.0.0",
    targets: [{ kind: "server" }],
    global: true,
    config: tmp.path,
    worktree: tmp.path,
    directory: tmp.path,
  })

  expect(result).toMatchObject({ ok: true })
  const text = await fs.readFile(path.join(tmp.path, "lfcode.json"), "utf8")
  expect(text).toContain('"plugins"')
  expect(text).not.toContain('"plugin"')
  expect(JSON.parse(text)).toEqual({
    plugins: ["legacy-plugin@1.0.0"],
  })
})
