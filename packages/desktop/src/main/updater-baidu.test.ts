import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  BaiduPanUpdateError,
  type BaiduPanUpdateManifest,
  downloadAndVerifyBaiduPanInstaller,
  isRemoteVersionNewer,
  parseBaiduPanUpdateManifest,
  validateAuthenticodeSignature,
  verifyDownloadedInstaller,
} from "./updater-baidu"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe("baidu updater manifest", () => {
  test("parses a valid security-complete manifest", () => {
    const manifest = parseBaiduPanUpdateManifest(
      JSON.stringify({
        appName: "Lfcode",
        installerName: "lfcode-win-x64.exe",
        publisher: "Lfcode",
        releaseNotes: "notes",
        sha256: "A".repeat(64),
        signature: "authenticode",
        sizeBytes: 1234,
        version: "1.1.1",
        versionCode: 1101,
      }),
      "Lfcode",
    )

    expect(manifest).toEqual({
      appName: "Lfcode",
      installerName: "lfcode-win-x64.exe",
      publisher: "Lfcode",
      releaseNotes: "notes",
      sha256: "a".repeat(64),
      signature: "authenticode",
      sizeBytes: 1234,
      version: "1.1.1",
      versionCode: 1101,
    })
  })

  test("rejects manifest with mismatched appName", () => {
    expect(() => parseBaiduPanUpdateManifest(JSON.stringify(rawManifest({ appName: "Other" })), "Lfcode")).toThrow(
      "Update manifest appName mismatch",
    )
  })

  test("rejects unsafe or non-executable installer names", () => {
    const invalid = [
      "../lfcode.exe",
      "..\\lfcode.exe",
      "C:\\temp\\lfcode.exe",
      "/tmp/lfcode.exe",
      "lfcode..exe",
      "nested/lfcode.exe",
      "nested\\lfcode.exe",
      "lfcode.exe ",
      "lfcode.cmd",
    ]
    invalid.forEach((installerName) => {
      expect(() => parseBaiduPanUpdateManifest(JSON.stringify(rawManifest({ installerName })), "Lfcode")).toThrow(
        "unsafe installerName",
      )
    })
  })

  test("rejects missing or invalid artifact security metadata", () => {
    const invalid = [
      { sizeBytes: 0 },
      { sizeBytes: -1 },
      { sizeBytes: 2 * 1024 * 1024 * 1024 + 1 },
      { sha256: "abc" },
      { publisher: "" },
      { signature: "pgp" },
      { version: "not-a-version" },
    ]
    invalid.forEach((override) => {
      expect(() => parseBaiduPanUpdateManifest(JSON.stringify(rawManifest(override)), "Lfcode")).toThrow()
    })
  })

  test("prefers versionCode when present", () => {
    expect(isRemoteVersionNewer(manifest({ version: "1.1.0", versionCode: 1101 }), "1.1.0")).toBe(true)
    expect(isRemoteVersionNewer(manifest({ version: "1.2.0", versionCode: 1100 }), "1.1.0")).toBe(false)
  })

  test("falls back to semver comparison when versionCode is absent", () => {
    expect(isRemoteVersionNewer(manifest({ version: "1.1.1", versionCode: null }), "1.1.0")).toBe(true)
    expect(isRemoteVersionNewer(manifest({ version: "1.1.0", versionCode: null }), "1.1.0")).toBe(false)
  })
})

describe("baidu updater artifact verification", () => {
  test("promotes a verified PE installer into a content-addressed active directory", async () => {
    const cacheDir = await tempDir()
    const bytes = Buffer.from("MZ-valid-signed-installer")
    const update = manifestForBytes(bytes)
    const calls: Array<{ installerPath: string; publisher: string }> = []
    const installerPath = await downloadAndVerifyBaiduPanInstaller(
      new Response(bytes),
      cacheDir,
      update,
      async (file, publisher) => {
        calls.push({ installerPath: file, publisher })
      },
    )

    expect(installerPath).toBe(path.join(cacheDir, "updates", update.sha256, update.installerName))
    expect(await readFile(installerPath)).toEqual(bytes)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.publisher).toBe("Lfcode")
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("rejects a truncated download and cleans the staging directory", async () => {
    const cacheDir = await tempDir()
    const expected = Buffer.from("MZ-complete-installer")
    const update = manifestForBytes(expected)
    await expect(
      downloadAndVerifyBaiduPanInstaller(new Response(expected.subarray(0, 5)), cacheDir, update, acceptSignature),
    ).rejects.toThrow("size does not match")
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("rejects bytes beyond the declared size before promotion", async () => {
    const cacheDir = await tempDir()
    const expected = Buffer.from("MZ-short")
    const update = manifestForBytes(expected)
    await expect(
      downloadAndVerifyBaiduPanInstaller(
        new Response(Buffer.concat([expected, Buffer.from("overflow")])),
        cacheDir,
        update,
        acceptSignature,
      ),
    ).rejects.toThrow("exceeded expected size")
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("rejects a SHA-256 mismatch", async () => {
    const cacheDir = await tempDir()
    const bytes = Buffer.from("MZ-hash-mismatch")
    const update = manifestForBytes(bytes, { sha256: "0".repeat(64) })
    await expect(
      downloadAndVerifyBaiduPanInstaller(new Response(bytes), cacheDir, update, acceptSignature),
    ).rejects.toThrow("SHA-256 mismatch")
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("rejects a non-PE payload before signature verification", async () => {
    const cacheDir = await tempDir()
    const bytes = Buffer.from("not-a-windows-installer")
    const update = manifestForBytes(bytes)
    await expect(
      downloadAndVerifyBaiduPanInstaller(new Response(bytes), cacheDir, update, acceptSignature),
    ).rejects.toThrow("not a Windows PE file")
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("rejects a bad signature and keeps the prior installer usable", async () => {
    const cacheDir = await tempDir()
    const previous = path.join(cacheDir, "updates", "previous", "lfcode-win-x64.exe")
    await mkdir(path.dirname(previous), { recursive: true })
    await writeFile(previous, "previous installer")
    const bytes = Buffer.from("MZ-invalid-signature")
    const update = manifestForBytes(bytes)

    await expect(
      downloadAndVerifyBaiduPanInstaller(new Response(bytes), cacheDir, update, async () => {
        throw new BaiduPanUpdateError("Downloaded installer Authenticode status is NotSigned")
      }),
    ).rejects.toThrow("NotSigned")
    expect(await readFile(previous, "utf8")).toBe("previous installer")
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("rejects an incorrect Content-Length before creating staging files", async () => {
    const cacheDir = await tempDir()
    const bytes = Buffer.from("MZ-content-length")
    const update = manifestForBytes(bytes)
    const response = new Response(bytes, { headers: { "content-length": String(bytes.length + 1) } })
    await expect(downloadAndVerifyBaiduPanInstaller(response, cacheDir, update, acceptSignature)).rejects.toThrow(
      "Content-Length",
    )
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("revalidates an existing content-addressed installer before reuse", async () => {
    const cacheDir = await tempDir()
    const bytes = Buffer.from("MZ-existing-installer")
    const update = manifestForBytes(bytes)
    const active = path.join(cacheDir, "updates", update.sha256, update.installerName)
    await mkdir(path.dirname(active), { recursive: true })
    await writeFile(active, bytes)
    let verificationCount = 0

    const installerPath = await downloadAndVerifyBaiduPanInstaller(
      new Response(bytes),
      cacheDir,
      update,
      async () => {
        verificationCount += 1
      },
    )
    expect(installerPath).toBe(active)
    expect(verificationCount).toBe(2)
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("atomically replaces a corrupt content-addressed cache entry with the verified download", async () => {
    const cacheDir = await tempDir()
    const bytes = Buffer.from("MZ-repaired-installer")
    const update = manifestForBytes(bytes)
    const active = path.join(cacheDir, "updates", update.sha256, update.installerName)
    await mkdir(path.dirname(active), { recursive: true })
    await writeFile(active, Buffer.from("MZ-corrupt-installer!"))

    const installerPath = await downloadAndVerifyBaiduPanInstaller(
      new Response(bytes),
      cacheDir,
      update,
      acceptSignature,
    )
    expect(installerPath).toBe(active)
    expect(await readFile(active)).toEqual(bytes)
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("defensively rejects an unsafe name even when called without the manifest parser", async () => {
    const cacheDir = await tempDir()
    const bytes = Buffer.from("MZ-unsafe-name")
    await expect(
      downloadAndVerifyBaiduPanInstaller(
        new Response(bytes),
        cacheDir,
        manifestForBytes(bytes, { installerName: "..\\escape.exe" }),
        acceptSignature,
      ),
    ).rejects.toThrow("unsafe installerName")
    expect(await stagingEntries(cacheDir)).toEqual([])
  })

  test("verifyDownloadedInstaller fails closed when the file is absent", async () => {
    const cacheDir = await tempDir()
    const bytes = Buffer.from("MZ-missing")
    await expect(
      verifyDownloadedInstaller(path.join(cacheDir, "missing.exe"), manifestForBytes(bytes), acceptSignature),
    ).rejects.toThrow("unavailable")
  })
})

describe("Authenticode result validation", () => {
  test("accepts an exact certificate simple-name publisher", () => {
    expect(() =>
      validateAuthenticodeSignature({ status: "Valid", publisher: "Lfcode", subject: "CN=Lfcode" }, "lfcode"),
    ).not.toThrow()
  })

  test("rejects a non-valid Authenticode status", () => {
    expect(() =>
      validateAuthenticodeSignature({ status: "HashMismatch", publisher: "Lfcode", subject: "CN=Lfcode" }, "Lfcode"),
    ).toThrow("HashMismatch")
  })

  test("rejects a publisher substring or unrelated subject", () => {
    expect(() =>
      validateAuthenticodeSignature(
        { status: "Valid", publisher: "Lfcode Malware", subject: "CN=Lfcode Malware" },
        "Lfcode",
      ),
    ).toThrow("publisher does not match")
  })
})

function rawManifest(override: Record<string, unknown> = {}) {
  return {
    appName: "Lfcode",
    installerName: "lfcode-win-x64.exe",
    publisher: "Lfcode",
    releaseNotes: "notes",
    sha256: "a".repeat(64),
    signature: "authenticode",
    sizeBytes: 1234,
    version: "1.1.1",
    versionCode: 1101,
    ...override,
  }
}

function manifest(override: Partial<BaiduPanUpdateManifest> = {}) {
  return {
    appName: "Lfcode",
    installerName: "lfcode-win-x64.exe",
    publisher: "Lfcode",
    releaseNotes: "",
    sha256: "a".repeat(64),
    signature: "authenticode" as const,
    sizeBytes: 1234,
    version: "1.1.1",
    versionCode: 1101,
    ...override,
  } satisfies BaiduPanUpdateManifest
}

function manifestForBytes(bytes: Buffer, override: Partial<BaiduPanUpdateManifest> = {}) {
  return manifest({
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    ...override,
  })
}

async function tempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "lfcode-baidu-updater-test-"))
  tempDirs.push(dir)
  return dir
}

async function stagingEntries(cacheDir: string) {
  return readdir(path.join(cacheDir, "updates-staging")).catch(() => [])
}

async function acceptSignature() {}
