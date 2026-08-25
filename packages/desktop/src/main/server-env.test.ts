import { afterEach, describe, expect, test } from "bun:test"

import { prepareServerEnv } from "./server-env"

const keys = [
  "LFCODE_HOME",
  "LFCODE_CONFIG_DIR",
  "LFCODE_DATA_DIR",
  "LFCODE_STATE_DIR",
  "LFCODE_CACHE_DIR",
  "LFCODE_CLIENT",
  "LFCODE_DISABLE_MODELS_FETCH",
  "LFCODE_DISABLE_EMBEDDED_WEB_UI",
  "LFCODE_SERVER_AUTH",
  "LFCODE_SERVER_PASSWORD",
  "LFCODE_SERVER_URL",
  "LFCODE_SERVER_USERNAME",
  "HOME",
  "USERPROFILE",
] as const

const original = new Map(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    const value = original.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("desktop server environment", () => {
  test("pins the bundled models catalog instead of inheriting runtime refresh", () => {
    process.env.LFCODE_DISABLE_MODELS_FETCH = "false"

    prepareServerEnv("test-password", "http://127.0.0.1:43173")

    expect(process.env.LFCODE_CLIENT).toBe("desktop")
    expect(process.env.LFCODE_DISABLE_MODELS_FETCH).toBe("true")
    expect(process.env.LFCODE_DISABLE_EMBEDDED_WEB_UI).toBe("false")
  })

  test("preserves the root layout home for embedded server discovery", () => {
    process.env.LFCODE_HOME = "C:\\Users\\liangfeng\\.lfcodepre"
    process.env.LFCODE_CONFIG_DIR = "C:\\Users\\liangfeng\\.lfcodepre"
    process.env.LFCODE_DATA_DIR = "C:\\Users\\liangfeng\\.lfcodepre\\data"
    process.env.LFCODE_STATE_DIR = "C:\\Users\\liangfeng\\.lfcodepre\\state"
    process.env.LFCODE_CACHE_DIR = "C:\\Users\\liangfeng\\.lfcodepre\\cache"

    prepareServerEnv("test-password", "http://127.0.0.1:43173")

    expect(process.env.LFCODE_HOME).toBe("C:\\Users\\liangfeng\\.lfcodepre")
    expect(process.env.LFCODE_CONFIG_DIR).toBe("C:\\Users\\liangfeng\\.lfcodepre")
  })
})
