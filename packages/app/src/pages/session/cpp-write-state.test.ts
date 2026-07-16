import { describe, expect, test } from "bun:test"
import { isCppChecksumConflict } from "./cpp-write-state"

describe("isCppChecksumConflict", () => {
  test("matches file checksum mismatch errors", () => {
    expect(isCppChecksumConflict("Checksum mismatch for src/main.cpp. Expected aaa, received bbb.")).toBe(true)
  })

  test("ignores ordinary errors", () => {
    expect(isCppChecksumConflict("Request failed")).toBe(false)
    expect(isCppChecksumConflict(undefined)).toBe(false)
  })
})
