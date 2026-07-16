import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  readAutomationDiscovery,
  removeAutomationDiscovery,
  resolveAutomationStateFile,
  writeAutomationDiscovery,
} from "./automation-discovery"

const tempDirs: string[] = []

describe("automation discovery", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
  })

  test("resolves from explicit state file env first", () => {
    expect(
      resolveAutomationStateFile({
        LFCODE_AUTOMATION_STATE_FILE: "C:/temp/custom.json",
      }),
    ).toBe("C:/temp/custom.json")
  })

  test("resolves from state dir when provided", () => {
    expect(
      resolveAutomationStateFile({
        LFCODE_STATE_DIR: "C:/lfcode/state",
      }),
    ).toBe(join("C:/lfcode/state", "automation", "desktop.json"))
  })

  test("writes and reads discovery state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lfcode-automation-"))
    tempDirs.push(directory)
    const env = {
      LFCODE_STATE_DIR: directory,
    }
    await writeAutomationDiscovery(
      {
        host: "127.0.0.1",
        pid: 1234,
        port: 7777,
        startedAt: 1,
        token: "secret",
        userData: "C:/lfcode/userData",
        version: "1.2.3",
      },
      env,
    )
    const file = resolveAutomationStateFile(env)
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      port: 7777,
      token: "secret",
    })
    expect(await readAutomationDiscovery(env)).toMatchObject({
      port: 7777,
      token: "secret",
    })
    expect((await readdir(join(directory, "automation"))).filter((entry) => entry.endsWith(".tmp"))).toEqual([])
    if (process.platform !== "win32") {
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      expect((await stat(join(directory, "automation"))).mode & 0o777).toBe(0o700)
    }
    await removeAutomationDiscovery(env)
    expect(await readAutomationDiscovery(env)).toBeUndefined()
  })

  test("ignores corrupt or unsafe discovery state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lfcode-automation-"))
    tempDirs.push(directory)
    const env = { LFCODE_STATE_DIR: directory }
    const file = resolveAutomationStateFile(env)
    await writeAutomationDiscovery(
      {
        host: "127.0.0.1",
        pid: 1234,
        port: 7777,
        startedAt: 1,
        token: "secret",
        userData: "C:/lfcode/userData",
        version: "1.2.3",
      },
      env,
    )
    await writeFile(file, "{partial", "utf8")
    expect(await readAutomationDiscovery(env)).toBeUndefined()
    await writeFile(
      file,
      JSON.stringify({
        host: "attacker.example",
        pid: 1234,
        port: 7777,
        startedAt: 1,
        token: "secret",
        userData: "C:/lfcode/userData",
        version: "1.2.3",
      }),
      "utf8",
    )
    expect(await readAutomationDiscovery(env)).toBeUndefined()
  })
})
