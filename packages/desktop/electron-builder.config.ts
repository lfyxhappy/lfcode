import { existsSync } from "node:fs"
import { execFile, execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"
import { resolveBundledGitSourceDir, resolveBundledGitStageDir } from "./scripts/bundled-git"
import { resolveBundledPythonSourceDir, resolveBundledPythonStageDir } from "./scripts/bundled-python"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
const fastPackage = process.env.LFCODE_FAST_PACKAGE === "true"
const preRelease = process.env.LFCODE_PRE_RELEASE === "true"

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = "stable"

const localConfigDir = path.join(rootDir, "packages", "desktop", "local-config")
const localConfigFiles = process.platform === "win32" ? [{ from: localConfigDir, to: ".", filter: ["lfcode.jsonc"] }] : []
const cliResourceDir = path.join(rootDir, "packages", "desktop", "resources", "cli")
const pluginSdkDir = path.join(rootDir, "packages", "plugin")
const windowsComputerUseBundleDir = path.join(rootDir, ".windows-computer-use-mcp", "bundle")
const codegraphRuntimeDir = path.join(rootDir, ".codegraph-runtime")
const bundledPwshDir = resolveBundledPwshDir()
const bundledGitDir = resolveBundledGitStageDir() ?? resolveBundledGitSourceDir()
const bundledPythonDir = resolveBundledPythonStageDir() ?? resolveBundledPythonSourceDir()
const windowsComputerUseResources =
  process.platform === "win32" && existsSync(windowsComputerUseBundleDir)
    ? [
        {
          from: windowsComputerUseBundleDir,
          to: "mcp/windows-computer-use-mcp/bundle",
          filter: ["**/*"],
        },
      ]
    : []
const codegraphResources =
  process.platform === "win32" &&
  (existsSync(path.join(codegraphRuntimeDir, "codegraph.exe")) ||
    (existsSync(path.join(codegraphRuntimeDir, "node.exe")) &&
      existsSync(path.join(codegraphRuntimeDir, "lib", "dist", "bin", "codegraph.js"))))
    ? [{ from: codegraphRuntimeDir, to: "codegraph", filter: ["**/*"] }]
    : []
const bundledPwshResources =
  process.platform === "win32"
    ? [
        {
          from: requireBundledPwshDir(),
          to: "pwsh",
          filter: ["**/*"],
        },
      ]
    : []
const bundledGitResources =
  process.platform === "win32"
    ? [
        {
          from: requireBundledGitDir(),
          to: "git",
          filter: ["**/*"],
        },
      ]
    : []
const bundledPythonResources =
  process.platform === "win32"
    ? [
        {
          from: requireBundledPythonDir(),
          to: "python",
          filter: ["**/*"],
        },
      ]
    : []
const getBase = (): Configuration => ({
  artifactName: "lfcode-${os}-${arch}.${ext}",
  executableName: preRelease ? "LfcodePre" : "Lfcode",
  ...(fastPackage
    ? {
        npmRebuild: false,
      }
    : {}),
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraFiles: localConfigFiles,
  extraResources: [
    {
      from: "resources/icons/",
      to: "icons/",
      filter: ["**/*"],
    },
    {
      from: cliResourceDir,
      to: "cli",
      filter: ["**/*"],
    },
    {
      from: pluginSdkDir,
      to: "plugin-sdk",
      filter: ["package.json", "dist/**/*"],
    },
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    ...windowsComputerUseResources,
    ...codegraphResources,
    ...bundledPwshResources,
    ...bundledGitResources,
    ...bundledPythonResources,
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Lfcode",
    schemes: ["lfcode"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    ...(fastPackage
      ? {
          signExts: ["!.exe"],
          verifyUpdateCodeSignature: false,
        }
      : {}),
    ...(fastPackage
      ? {}
      : {
          signtoolOptions: {
            sign: signWindows,
          },
        }),
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
    include: `resources/installer.nsh`,
  },
})

function resolveBundledPwshDir() {
  if (process.platform !== "win32") return
  const whereMatches = resolvePwshDirsFromWhere()
  const candidates = [
    process.env.LFCODE_BUNDLED_PWSH_DIR,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "PowerShell", "7") : undefined,
    process.env.ProgramW6432 ? path.join(process.env.ProgramW6432, "PowerShell", "7") : undefined,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "PowerShell", "7") : undefined,
    ...whereMatches,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (existsSync(path.join(candidate, "pwsh.exe"))) return candidate
  }
}

function resolvePwshDirsFromWhere() {
  if (process.platform !== "win32") return []
  try {
    const output = execFileSync("where.exe", ["pwsh.exe"], { encoding: "utf8", windowsHide: true })
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => path.dirname(line))
  } catch {
    return []
  }
}

function requireBundledPwshDir() {
  if (bundledPwshDir) return bundledPwshDir
  throw new Error(
    "PowerShell 7 (`pwsh`) was not found on this Windows packaging machine. Install PowerShell 7 or set LFCODE_BUNDLED_PWSH_DIR before running package:win.",
  )
}

function requireBundledGitDir() {
  if (bundledGitDir) return bundledGitDir
  throw new Error(
    "Git for Windows was not found on this Windows packaging machine. Install Git for Windows or set LFCODE_BUNDLED_GIT_DIR before running package:win.",
  )
}

function requireBundledPythonDir() {
  if (bundledPythonDir) return bundledPythonDir
  throw new Error(
    "Python was not found on this Windows packaging machine. Install a full Python runtime or set LFCODE_BUNDLED_PYTHON_DIR before running package:win.",
  )
}

function getConfig() {
  const base = getBase()
  if (channel === "stable") {
    return {
      ...base,
      appId: preRelease ? "com.lfyxhappy.lfcode.pre" : "com.lfyxhappy.lfcode",
      productName: preRelease ? "Lfcode Pre" : "Lfcode",
      protocols: { name: "Lfcode", schemes: ["lfcode"] },
      publish: { provider: "github", owner: "lfyxhappy", repo: "lfcode", channel: "latest" },
    }
  }
}

export default getConfig()
