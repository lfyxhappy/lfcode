import { describe, expect, test } from "bun:test"
import { downloadNeedsOpenConfirmation, isManagedAutomationDownload } from "./download-security"

describe("downloadNeedsOpenConfirmation", () => {
  test("allows common inert document and image formats without a second confirmation", () => {
    expect(downloadNeedsOpenConfirmation("report.PDF")).toBe(false)
    expect(downloadNeedsOpenConfirmation("image.png")).toBe(false)
    expect(downloadNeedsOpenConfirmation("notes.txt")).toBe(false)
  })

  test("requires a second confirmation for executable, script, archive, and unknown files", () => {
    expect(downloadNeedsOpenConfirmation("installer.exe")).toBe(true)
    expect(downloadNeedsOpenConfirmation("script.ps1")).toBe(true)
    expect(downloadNeedsOpenConfirmation("archive.zip")).toBe(true)
    expect(downloadNeedsOpenConfirmation("README")).toBe(true)
  })

  test("recognizes only files contained by the managed automation download directory", () => {
    expect(isManagedAutomationDownload("C:\\profile\\output\\browser-downloads\\asset.png", "C:\\profile")).toBe(true)
    expect(isManagedAutomationDownload("C:\\profile\\output\\browser-downloads-escape\\asset.png", "C:\\profile")).toBe(false)
    expect(isManagedAutomationDownload("C:\\profile\\output\\browser-downloads\\..\\secret.txt", "C:\\profile")).toBe(false)
  })
})
