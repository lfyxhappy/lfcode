import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

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

const getBase = (): Configuration => ({
  artifactName: "lfcode-${os}-${arch}.${ext}",
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
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
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
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
})

function getConfig() {
  const base = getBase()
  if (channel === "stable") {
    return {
      ...base,
      appId: "com.lfyxhappy.lfcode",
      productName: "Lfcode",
      protocols: { name: "Lfcode", schemes: ["lfcode"] },
      publish: { provider: "github", owner: "lfyxhappy", repo: "lfcode", channel: "latest" },
    }
  }
}

export default getConfig()
