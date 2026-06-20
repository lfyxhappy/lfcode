import { describe, expect, test } from "bun:test"

import { isRemoteVersionNewer, parseBaiduPanUpdateManifest } from "./updater-baidu"

describe("baidu updater", () => {
  test("parses a valid manifest", () => {
    const manifest = parseBaiduPanUpdateManifest(
      JSON.stringify({
        appName: "Lfcode",
        version: "1.1.1",
        versionCode: 1101,
        installerName: "lfcode-win-x64.exe",
        releaseNotes: "notes",
      }),
      "Lfcode",
    )

    expect(manifest).toEqual({
      appName: "Lfcode",
      version: "1.1.1",
      versionCode: 1101,
      installerName: "lfcode-win-x64.exe",
      releaseNotes: "notes",
    })
  })

  test("rejects manifest with mismatched appName", () => {
    expect(() =>
      parseBaiduPanUpdateManifest(
        JSON.stringify({
          appName: "Other",
          version: "1.1.1",
          installerName: "lfcode-win-x64.exe",
        }),
        "Lfcode",
      ),
    ).toThrow("Update manifest appName mismatch")
  })

  test("rejects manifest missing installerName", () => {
    expect(() =>
      parseBaiduPanUpdateManifest(
        JSON.stringify({
          appName: "Lfcode",
          version: "1.1.1",
        }),
        "Lfcode",
      ),
    ).toThrow("Update manifest missing installerName")
  })

  test("prefers versionCode when present", () => {
    expect(
      isRemoteVersionNewer(
        {
          appName: "Lfcode",
          version: "1.1.0",
          versionCode: 1101,
          installerName: "lfcode-win-x64.exe",
          releaseNotes: "",
        },
        "1.1.0",
      ),
    ).toBe(true)

    expect(
      isRemoteVersionNewer(
        {
          appName: "Lfcode",
          version: "1.2.0",
          versionCode: 1100,
          installerName: "lfcode-win-x64.exe",
          releaseNotes: "",
        },
        "1.1.0",
      ),
    ).toBe(false)
  })

  test("falls back to semver comparison when versionCode is absent", () => {
    expect(
      isRemoteVersionNewer(
        {
          appName: "Lfcode",
          version: "1.1.1",
          versionCode: null,
          installerName: "lfcode-win-x64.exe",
          releaseNotes: "",
        },
        "1.1.0",
      ),
    ).toBe(true)

    expect(
      isRemoteVersionNewer(
        {
          appName: "Lfcode",
          version: "1.1.0",
          versionCode: null,
          installerName: "lfcode-win-x64.exe",
          releaseNotes: "",
        },
        "1.1.0",
      ),
    ).toBe(false)
  })
})
