import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "path"
import { Shell } from "../../src/shell/shell"

const withShell = async (shell: string | undefined, fn: () => void | Promise<void>) => {
  const prev = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  Shell.acceptable.reset()
  Shell.preferred.reset()
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    Shell.acceptable.reset()
    Shell.preferred.reset()
  }
}

const withBundledPwsh = async (fn: (pwshPath: string) => void | Promise<void>) => {
  const prev = process.env.LFCODE_PWSH_PATH
  const root = path.join(tmpdir(), `lfcode-shell-test-${process.pid}-${Date.now()}`)
  const pwshPath = path.join(root, "pwsh", "pwsh.exe")
  mkdirSync(path.dirname(pwshPath), { recursive: true })
  await Bun.write(pwshPath, "")
  process.env.LFCODE_PWSH_PATH = pwshPath
  Shell.acceptable.reset()
  Shell.preferred.reset()
  try {
    await fn(pwshPath)
  } finally {
    if (prev === undefined) delete process.env.LFCODE_PWSH_PATH
    else process.env.LFCODE_PWSH_PATH = prev
    rmSync(root, { recursive: true, force: true })
    Shell.acceptable.reset()
    Shell.preferred.reset()
  }
}

describe("shell", () => {
  test("normalizes shell names", () => {
    expect(Shell.name("/bin/bash")).toBe("bash")
    if (process.platform === "win32") {
      expect(Shell.name("C:/tools/NU.EXE")).toBe("nu")
      expect(Shell.name("C:/tools/PWSH.EXE")).toBe("pwsh")
    }
  })

  test("detects login shells", () => {
    expect(Shell.login("/bin/bash")).toBe(true)
    expect(Shell.login("C:/tools/pwsh.exe")).toBe(false)
  })

  test("detects posix shells", () => {
    expect(Shell.posix("/bin/bash")).toBe(true)
    expect(Shell.posix("/bin/fish")).toBe(false)
    expect(Shell.posix("C:/tools/pwsh.exe")).toBe(false)
  })

  if (process.platform === "win32") {
    test("rejects blacklisted shells case-insensitively", async () => {
      await withShell("NU.EXE", async () => {
        expect(Shell.name(Shell.acceptable())).toBe("pwsh")
      })
    })

    test("ignores Git Bash shell paths from env and keeps pwsh", async () => {
      const shell = "/cygdrive/c/Program Files/Git/bin/bash.exe"
      const pwsh = Bun.which("pwsh") || Bun.which("pwsh.exe") || "pwsh.exe"
      await withShell(shell, async () => {
        expect(Shell.preferred()).toBe(pwsh)
        expect(Shell.acceptable()).toBe(pwsh)
      })
    })

    test("ignores /usr/bin/bash from env and keeps pwsh", async () => {
      const pwsh = Bun.which("pwsh") || Bun.which("pwsh.exe") || "pwsh.exe"
      await withShell("/usr/bin/bash", async () => {
        expect(Shell.acceptable()).toBe(pwsh)
        expect(Shell.preferred()).toBe(pwsh)
      })
    })

    test("resolves bare PowerShell shells", async () => {
      const pwsh = Bun.which("pwsh") || Bun.which("pwsh.exe")
      await withShell("powershell.exe", async () => {
        expect(Shell.preferred()).toBe(pwsh || "pwsh.exe")
      })
    })

    test("resolves PowerShell with shared priority order", () => {
      const resolved = Shell.resolvePowerShell()
      const pwsh = Bun.which("pwsh") || Bun.which("pwsh.exe")
      expect(resolved).toBe(pwsh || "pwsh.exe")
    })

    test("prefers bundled pwsh path when provided by the app runtime", async () => {
      await withBundledPwsh(async (pwshPath) => {
        expect(Shell.resolvePowerShell()).toBe(pwshPath)
        expect(Shell.preferred()).toBe(pwshPath)
        expect(Shell.acceptable()).toBe(pwshPath)
      })
    })

    test("normalizes explicit PowerShell names through shared resolver", () => {
      const pwsh = Bun.which("pwsh") || Bun.which("pwsh.exe")
      expect(Shell.resolvePowerShell("powershell.exe")).toBe(pwsh || "pwsh.exe")
      if (!pwsh) return
      expect(Shell.resolvePowerShell(path.win32.basename(pwsh))).toBe(pwsh)
    })

    test("ignores explicit bash.exe env and keeps pwsh", async () => {
      const pwsh = Bun.which("pwsh") || Bun.which("pwsh.exe") || "pwsh.exe"
      await withShell("bash.exe", async () => {
        expect(Shell.preferred()).toBe(pwsh)
        expect(Shell.acceptable()).toBe(pwsh)
      })
    })
  }
})
