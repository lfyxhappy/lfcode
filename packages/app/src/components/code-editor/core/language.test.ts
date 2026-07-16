import { describe, expect, test } from "bun:test"
import {
  getCodeEditorFenceExtension,
  getCodeEditorLanguage,
  getCodeEditorLanguageFromHint,
  isCodeEditorFenceLanguageSupported,
  isCodeEditorLanguageSupported,
} from "./language"

describe("code editor language helpers", () => {
  test("maps supported file extensions", () => {
    expect(getCodeEditorLanguage("C:\\demo\\main.tsx")).toBe("typescript")
    expect(getCodeEditorLanguage("C:\\demo\\main.JSON")).toBe("json")
    expect(getCodeEditorLanguage("C:\\demo\\config.yaml")).toBe("yaml")
    expect(getCodeEditorLanguage("C:\\demo\\settings.toml")).toBe("ini")
    expect(getCodeEditorLanguage("C:\\demo\\query.sql")).toBe("sql")
    expect(getCodeEditorLanguage("C:\\demo\\notes.txt")).toBe("plaintext")
    expect(getCodeEditorLanguage("C:\\demo\\run.ps1")).toBe("powershell")
    expect(getCodeEditorLanguage("C:\\demo\\core.hpp")).toBe("cpp")
    expect(getCodeEditorLanguage("C:\\demo\\Program.cs")).toBe("csharp")
    expect(getCodeEditorLanguage("C:\\demo\\main.rs")).toBe("rust")
    expect(getCodeEditorLanguage("C:\\demo\\Dockerfile")).toBe("dockerfile")
  })

  test("reports unsupported paths", () => {
    expect(getCodeEditorLanguage("C:\\demo\\archive.bin")).toBeUndefined()
    expect(isCodeEditorLanguageSupported("C:\\demo\\archive.bin")).toBe(false)
    expect(isCodeEditorLanguageSupported("C:\\demo\\main.c")).toBe(true)
  })

  test("maps supported fence languages", () => {
    expect(getCodeEditorFenceExtension("ts")).toBe(".ts")
    expect(getCodeEditorFenceExtension("TypeScript")).toBe(".ts")
    expect(getCodeEditorFenceExtension("yaml")).toBe(".yaml")
    expect(getCodeEditorFenceExtension("plaintext")).toBe(".txt")
    expect(getCodeEditorFenceExtension("pwsh")).toBe(".ps1")
    expect(getCodeEditorFenceExtension("c++")).toBe(".cpp")
    expect(isCodeEditorFenceLanguageSupported("json")).toBe(true)
    expect(isCodeEditorFenceLanguageSupported("sql")).toBe(true)
    expect(isCodeEditorFenceLanguageSupported("bash")).toBe(true)
  })

  test("maps explicit language hints", () => {
    expect(getCodeEditorLanguageFromHint("cpp")).toBe("cpp")
    expect(getCodeEditorLanguageFromHint("C++")).toBe("cpp")
    expect(getCodeEditorLanguageFromHint("py")).toBe("python")
    expect(getCodeEditorLanguageFromHint("text")).toBe("plaintext")
    expect(getCodeEditorLanguageFromHint("svg")).toBe("xml")
    expect(getCodeEditorLanguageFromHint("toml")).toBe("ini")
    expect(getCodeEditorLanguageFromHint("C#")).toBe("csharp")
    expect(getCodeEditorLanguageFromHint("notes")).toBeUndefined()
  })
})
