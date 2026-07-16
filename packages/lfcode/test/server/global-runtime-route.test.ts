import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Server } from "../../src/server/server"
import { managedCppExecutable, managedCppRoot } from "../../src/cpp/runtime"
import { runtimeActivationConfigPath } from "../../src/runtime-registry/config"
import { runtimeOperationLogPath } from "../../src/runtime-registry/log"
import { managedJavaExecutable, managedJavaRuntimeRoot } from "../../src/runtime-registry/java"
import { managedFfmpegExecutable, managedRecorderExecutable, managedRecorderRoot, managedFfmpegRoot } from "../../src/runtime-registry/voice"

const envKeys = [
  "LFCODE_MANAGED_PYTHON_PATH",
  "LFCODE_PYTHON_PATH",
  "LFCODE_RECORDER_PATH",
  "LFCODE_FFMPEG_PATH",
  "LFCODE_FFPROBE_PATH",
  "LFCODE_CXX_PATH",
  "LFCODE_JAVA_PATH",
  "LFCODE_JAVAC_PATH",
  "PATH",
  "Path",
] as const
const envSnapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of envKeys) {
    const previous = envSnapshot[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  rmSync(runtimeOperationLogPath(), { force: true })
  rmSync(runtimeActivationConfigPath(), { force: true })
})

describe("global runtime routes", () => {
  test("GET /global/runtime/manage lists runtime items", async () => {
    const response = await Server.Default().app.request("/global/runtime/manage")
    expect(response.status).toBe(200)
    const payload = await response.json()
    const data = "data" in payload ? payload.data : payload
    expect(Array.isArray(data.items)).toBe(true)
    expect(data.items.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining(["voice-recorder", "python-base", "python-managed", "cpp-compiler", "java-runtime", "java-sdk"]),
    )
  })

  test("POST /global/runtime/repair reuses an existing managed python path", async () => {
    const root = path.join(tmpdir(), `lfcode-runtime-route-${process.pid}-${Date.now()}`)
    const pythonPath = path.join(root, process.platform === "win32" ? "python.exe" : "python")
    mkdirSync(path.dirname(pythonPath), { recursive: true })
    await Bun.write(pythonPath, "")
    process.env.LFCODE_MANAGED_PYTHON_PATH = pythonPath

    try {
      const response = await Server.Default().app.request("/global/runtime/repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "python-managed" }),
      })
      expect(response.status).toBe(200)
      const payload = await response.json()
      const data = "data" in payload ? payload.data : payload
      expect(data.message).toBe("Python 受管环境已检查并修复。")
      expect(data.state.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "python-managed",
            installed: true,
            source: "managed",
            path: pythonPath,
          }),
        ]),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("POST /global/runtime/repair reuses an existing managed recorder path", async () => {
    const recorderPath = managedRecorderExecutable()
    mkdirSync(path.dirname(recorderPath), { recursive: true })
    await Bun.write(recorderPath, "")

    try {
      const response = await Server.Default().app.request("/global/runtime/repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "voice-recorder" }),
      })
      expect(response.status).toBe(200)
      const payload = await response.json()
      const data = "data" in payload ? payload.data : payload
      expect(data.message).toBe("录音器环境已刷新并校验。")
      expect(data.state.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "voice-recorder",
            installed: true,
            source: "managed",
            path: recorderPath,
          }),
        ]),
      )
    } finally {
      rmSync(managedRecorderRoot(), { recursive: true, force: true })
    }
  })

  test("POST /global/runtime/repair reuses an existing managed ffmpeg path", async () => {
    const ffmpegPath = managedFfmpegExecutable("ffmpeg")
    const ffprobePath = managedFfmpegExecutable("ffprobe")
    mkdirSync(path.dirname(ffmpegPath), { recursive: true })
    await Bun.write(ffmpegPath, "")
    await Bun.write(ffprobePath, "")

    try {
      const response = await Server.Default().app.request("/global/runtime/repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ffmpeg" }),
      })
      expect(response.status).toBe(200)
      const payload = await response.json()
      const data = "data" in payload ? payload.data : payload
      expect(data.message).toBe("FFmpeg 环境已刷新并校验。")
      expect(data.state.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "ffmpeg",
            installed: true,
            source: "managed",
            path: ffmpegPath,
          }),
        ]),
      )
    } finally {
      rmSync(managedFfmpegRoot(), { recursive: true, force: true })
    }
  })

  test("POST /global/runtime/repair reuses an existing managed cpp compiler path", async () => {
    const compilerPath = managedCppExecutable()
    mkdirSync(path.dirname(compilerPath), { recursive: true })
    await Bun.write(compilerPath, "")

    try {
      const response = await Server.Default().app.request("/global/runtime/repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cpp-compiler" }),
      })
      expect(response.status).toBe(200)
      const payload = await response.json()
      const data = "data" in payload ? payload.data : payload
      expect(data.message).toBe("C++ 编译器环境已刷新并校验。")
      expect(data.state.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "cpp-compiler",
            installed: true,
            source: "managed",
            path: compilerPath,
          }),
        ]),
      )
    } finally {
      rmSync(managedCppRoot(), { recursive: true, force: true })
    }
  })

  test("GET /global/runtime/logs returns recent runtime operation entries", async () => {
    const root = path.join(tmpdir(), `lfcode-runtime-log-${process.pid}-${Date.now()}`)
    const pythonPath = path.join(root, process.platform === "win32" ? "python.exe" : "python")
    mkdirSync(path.dirname(pythonPath), { recursive: true })
    await Bun.write(pythonPath, "")
    process.env.LFCODE_MANAGED_PYTHON_PATH = pythonPath

    const response = await Server.Default().app.request("/global/runtime/repair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "python-managed" }),
    })
    expect(response.status).toBe(200)

    const logsResponse = await Server.Default().app.request("/global/runtime/logs?limit=5&id=python-managed")
    expect(logsResponse.status).toBe(200)
    const payload = await logsResponse.json()
    const data = "data" in payload ? payload.data : payload
    expect(data.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "python-managed",
          action: "repair",
          status: "success",
        }),
      ]),
    )
    rmSync(root, { recursive: true, force: true })
  })

  test("POST /global/runtime/install records failed runtime operations", async () => {
    const response = await Server.Default().app.request("/global/runtime/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "python-base" }),
    })
    expect(response.status).toBe(400)

    const logsResponse = await Server.Default().app.request("/global/runtime/logs?limit=5&id=python-base")
    expect(logsResponse.status).toBe(200)
    const payload = await logsResponse.json()
    const data = "data" in payload ? payload.data : payload
    expect(data.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "python-base",
          action: "install",
          status: "failed",
        }),
      ]),
    )
  })

  test("POST /global/runtime/activate switches java runtime to the system target", async () => {
    const root = path.join(tmpdir(), `lfcode-runtime-activate-${process.pid}-${Date.now()}`)
    const managedJava = managedJavaExecutable(managedJavaRuntimeRoot(), "java")
    const systemJava = path.join(root, process.platform === "win32" ? "java.exe" : "java")
    mkdirSync(path.dirname(managedJava), { recursive: true })
    mkdirSync(path.dirname(systemJava), { recursive: true })
    await Bun.write(managedJava, "")
    await Bun.write(systemJava, "")
    process.env.PATH = `${root}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`
    process.env.Path = process.env.PATH

    try {
      const response = await Server.Default().app.request("/global/runtime/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "java-runtime", target: "system" }),
      })
      expect(response.status).toBe(200)
      const payload = await response.json()
      const data = "data" in payload ? payload.data : payload
      expect(data.message).toBe("已切换到系统 Java。")
      expect(data.state.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "java-runtime",
            source: "system",
            path: systemJava,
          }),
        ]),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(managedJavaRuntimeRoot(), { recursive: true, force: true })
    }
  })
})
