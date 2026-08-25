import { expect, test } from "bun:test"
import { launchCommand, permissionModeFromSettings, withEnter, withKey } from "../../src/claude-code"

const sessionID = "a0b87f2d-53d6-4ae0-b4df-84f0867cf0c3"

test("starts a new Claude Code session with its stable UUID", () => {
  const command = launchCommand(sessionID, false)
  if (process.platform === "win32") {
    expect(command).toEqual({ command: "cmd.exe", args: ["/d", "/s", "/c", `claude --session-id ${sessionID}`] })
    return
  }
  expect(command).toEqual({ command: "claude", args: ["--session-id", sessionID] })
})

test("reopens an existing Claude Code session with resume", () => {
  const command = launchCommand(sessionID, true)
  if (process.platform === "win32") {
    expect(command).toEqual({ command: "cmd.exe", args: ["/d", "/s", "/c", `claude --resume ${sessionID}`] })
    return
  }
  expect(command).toEqual({ command: "claude", args: ["--resume", sessionID] })
})

test("resumes the same Claude session with an exact permission mode", () => {
  if (process.platform === "win32") {
    expect(launchCommand(sessionID, true, "claude", "default")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `claude --resume ${sessionID} --permission-mode manual`],
    })
    expect(launchCommand(sessionID, true, "claude", "plan")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `claude --resume ${sessionID} --permission-mode plan`],
    })
    return
  }
  expect(launchCommand(sessionID, true, "claude", "bypassPermissions")).toEqual({
    command: "claude",
    args: ["--resume", sessionID, "--permission-mode", "bypassPermissions"],
  })
})

test("uses an absolute Windows command when the desktop PATH does not include npm globals", () => {
  if (process.platform !== "win32") return
  expect(launchCommand(sessionID, false, "C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd")).toEqual({
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `"C:\\Users\\example\\AppData\\Roaming\\npm\\claude.cmd" --session-id ${sessionID}`],
  })
})

test("preserves terminal input and appends a carriage return", () => {
  expect(withEnter("/help\nnext")).toBe("/help\nnext\r")
})

test("keeps native key sequences unchanged", () => {
  expect(withKey("\u001b[Z")).toBe("\u001b[Z")
  expect(withKey("\u0003")).toBe("\u0003")
})

test("normalizes Claude's configured permission mode before the terminal footer is available", () => {
  expect(permissionModeFromSettings("manual")).toBe("default")
  expect(permissionModeFromSettings("bypassPermissions")).toBe("bypassPermissions")
  expect(permissionModeFromSettings("auto")).toBe("auto")
  expect(permissionModeFromSettings("unsupported")).toBeUndefined()
})
