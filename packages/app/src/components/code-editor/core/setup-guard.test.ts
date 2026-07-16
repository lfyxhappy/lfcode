import { describe, expect, test } from "bun:test"
import { isCurrentCodeEditorSetup } from "./setup-guard"

describe("code editor setup guard", () => {
  test("accepts only the current setup token and path", () => {
    expect(
      isCurrentCodeEditorSetup({
        token: 3,
        currentToken: 3,
        path: "C:\\repo\\current.ts",
        currentPath: "C:\\repo\\current.ts",
      }),
    ).toBe(true)
    expect(
      isCurrentCodeEditorSetup({
        token: 2,
        currentToken: 3,
        path: "C:\\repo\\current.ts",
        currentPath: "C:\\repo\\current.ts",
      }),
    ).toBe(false)
    expect(
      isCurrentCodeEditorSetup({
        token: 3,
        currentToken: 3,
        path: "C:\\repo\\previous.ts",
        currentPath: "C:\\repo\\current.ts",
      }),
    ).toBe(false)
  })
})
