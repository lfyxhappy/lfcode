import path from "path"
import { managedPythonRoot, resolveBasePythonCommand, resolveManagedPythonCommand } from "@/python/runtime"
import { managedPythonPackageSummary } from "@/python/managed-packages"
import { isManagedCppCommand, managedCppExecutable, resolveCppCommand } from "@/cpp/runtime"
import { Filesystem, Process } from "@/util"
import { which } from "@/util/which"
import { readManagedCppMetadata } from "./cpp"
import { readManagedJavaMetadata, type ManagedJavaArtifactID, resolveManagedJavaBinary, resolvePreferredJavaBinary } from "./java"
import { readManagedOfficeCliMetadata, resolveOfficeCliCommand, resolveManagedOfficeCli, resolveSystemOfficeCli } from "./officecli"
import {
  readManagedVoiceMetadata,
  resolveFfmpegBinary,
  resolveManagedFfmpegBinary,
  resolveManagedRecorderPath,
  resolveRecorderCommand,
  resolveSystemFfmpegBinary,
  resolveSystemRecorderCommand,
} from "./voice"
import { type RuntimeManageItem, type RuntimeManageItemID, type RuntimeManageState, type RuntimeManageTarget } from "./types"

const CATALOG: Record<
  RuntimeManageItemID,
  Pick<RuntimeManageItem, "group" | "title" | "description" | "scope" | "usedBy">
> = {
  "voice-recorder": {
    group: "voice",
    title: "录音器",
    description: "实时语音输入需要本地录音命令。",
    scope: "required",
    usedBy: ["voice input"],
  },
  ffmpeg: {
    group: "voice",
    title: "FFmpeg",
    description: "音频转码、截图和后续多媒体能力会优先复用 FFmpeg。",
    scope: "recommended",
    usedBy: ["voice conversion", "media extraction"],
  },
  "python-base": {
    group: "code",
    title: "Python 基础运行时",
    description: "Lfcode 受管 Python 环境的引导来源。",
    scope: "required",
    usedBy: ["python bootstrap", "python tool"],
  },
  "python-managed": {
    group: "code",
    title: "Python 受管环境",
    description: "Lfcode 自己维护的可写 Python 环境。",
    scope: "required",
    usedBy: ["python tool", "pip tool"],
  },
  "cpp-compiler": {
    group: "code",
    title: "C++ 编译器",
    description: "运行 C++ 工具前需要可用的编译器。",
    scope: "optional",
    usedBy: ["cpp runner"],
  },
  "java-runtime": {
    group: "code",
    title: "Java 运行时",
    description: "运行 jar 或 Java 程序时需要 java。",
    scope: "optional",
    usedBy: ["java runner"],
  },
  "java-sdk": {
    group: "code",
    title: "Java SDK",
    description: "编译 Java 程序时需要 javac。",
    scope: "optional",
    usedBy: ["java compile"],
  },
  officecli: {
    group: "code",
    title: "OfficeCLI",
    description: "创建、读取、编辑和渲染 Word、Excel、PowerPoint 文件的受管 CLI。",
    scope: "recommended",
    usedBy: ["office tool", "document render"],
  },
}

export async function getRuntimeManageState(): Promise<RuntimeManageState> {
  const items = await Promise.all([
    detectVoiceRecorder(),
    detectFfmpeg(),
    detectPythonBase(),
    detectPythonManaged(),
    detectCppCompiler(),
    detectJavaRuntime(),
    detectJavaSdk(),
    detectOfficeCli(),
  ])

  return {
    refreshedAt: Date.now(),
    items,
  }
}

async function detectVoiceRecorder(): Promise<RuntimeManageItem> {
  const recorder = resolveRecorderCommand()
  const targets = buildVoiceRecorderTargets(recorder)
  const metadata = recorder?.source === "managed" ? await readManagedVoiceMetadata("voice-recorder") : undefined
  return {
    ...CATALOG["voice-recorder"],
    id: "voice-recorder",
    installed: !!recorder,
    version: recorder ? await readVersion(recorder.path, ["--version"]) : undefined,
    source: recorder?.source ?? "missing",
    path: recorder?.path,
    detail: renderRecorderDetail(recorder, metadata?.sourceLabel),
    targets,
    actions: {
      install: !targets.some((target) => target.id === "managed"),
      repair: targets.some((target) => target.id === "managed"),
      activate: targets.length > 1,
      openPath: !!recorder?.path,
      viewLogs: true,
    },
  }
}

async function detectFfmpeg(): Promise<RuntimeManageItem> {
  const resolved = resolveFfmpegBinary("ffmpeg")
  const targets = buildFfmpegTargets(resolved)
  const metadata = resolved?.source === "managed" ? await readManagedVoiceMetadata("ffmpeg") : undefined
  return {
    ...CATALOG.ffmpeg,
    id: "ffmpeg",
    installed: !!resolved,
    version: resolved ? await readVersion(resolved.path, ["-version"]) : undefined,
    source: resolved?.source ?? "missing",
    path: resolved?.path,
    detail: renderFfmpegDetail(resolved, metadata?.sourceLabel),
    targets,
    actions: {
      install: !targets.some((target) => target.id === "managed"),
      repair: targets.some((target) => target.id === "managed"),
      activate: targets.length > 1,
      openPath: !!resolved?.path,
      viewLogs: true,
    },
  }
}

async function detectPythonBase(): Promise<RuntimeManageItem> {
  const python = resolveBasePythonCommand()
  const installed = !!python
  return {
    ...CATALOG["python-base"],
    id: "python-base",
    installed,
    version: python ? await readVersion(python.command, [...python.args, "--version"]) : undefined,
    source: python ? detectPythonBaseSource(python.command) : "missing",
    path: python?.command,
    detail: installed ? undefined : "当前没有基础 Python 可用于引导受管环境。",
    targets: [],
    actions: {
      install: false,
      repair: false,
      activate: false,
      openPath: !!python?.command,
      viewLogs: true,
    },
  }
}

async function detectPythonManaged(): Promise<RuntimeManageItem> {
  const python = resolveManagedPythonCommand()
  const installed = !!python
  return {
    ...CATALOG["python-managed"],
    id: "python-managed",
    installed,
    version: python ? await readVersion(python.command, ["--version"]) : undefined,
    source: installed ? "managed" : "missing",
    path: python?.command,
    detail: installed
      ? `Lfcode 会优先在这个受管环境里直接使用这些常用库：${managedPythonPackageSummary()}。`
      : `受管环境尚未初始化。预期位置：${managedPythonRoot()}。初始化后会预装这些常用库：${managedPythonPackageSummary()}。`,
    targets: [],
    actions: {
      install: !installed,
      repair: true,
      activate: false,
      openPath: installed,
      viewLogs: true,
    },
  }
}

async function detectCppCompiler(): Promise<RuntimeManageItem> {
  const compiler = resolveCppCommand()
  const installed = !!compiler
  const targets = buildCppTargets(compiler)
  const metadata = compiler && isManagedCppCommand(compiler) ? await readManagedCppMetadata() : undefined
  return {
    ...CATALOG["cpp-compiler"],
    id: "cpp-compiler",
    installed,
    version: compiler ? await readVersion(compiler.command, [...compiler.args, "--version"]) : undefined,
    source: compiler ? (isManagedCppCommand(compiler) ? "managed" : "system") : "missing",
    path: compiler?.command,
    detail: renderCppDetail(compiler, metadata?.sourceLabel, metadata?.releaseTag),
    targets,
    actions: {
      install: !targets.some((target) => target.id === "managed"),
      repair: targets.some((target) => target.id === "managed"),
      activate: targets.length > 1,
      openPath: !!compiler?.command,
      viewLogs: true,
    },
  }
}

async function detectJavaRuntime(): Promise<RuntimeManageItem> {
  const runtime = resolvePreferredJavaBinary("java")
  const installed = !!runtime
  const targets = buildJavaRuntimeTargets(runtime)
  const metadata = runtime?.source === "managed" ? await readManagedJavaMetadata(runtime.artifact ?? "java-runtime") : undefined
  return {
    ...CATALOG["java-runtime"],
    id: "java-runtime",
    installed,
    version: runtime ? await readVersion(runtime.path, ["-version"]) : undefined,
    source: runtime?.source ?? "missing",
    path: runtime?.path,
    detail: renderJavaRuntimeDetail(runtime, metadata?.sourceLabel),
    targets,
    actions: {
      install: !targets.some((target) => target.id === "managed-jre"),
      repair: targets.some((target) => target.id === "managed-jre" || target.id === "managed-jdk"),
      activate: targets.length > 1,
      openPath: !!runtime?.path,
      viewLogs: true,
    },
  }
}

async function detectJavaSdk(): Promise<RuntimeManageItem> {
  const runtime = resolvePreferredJavaBinary("javac")
  const installed = !!runtime
  const targets = buildJavaSdkTargets(runtime)
  const metadata = runtime?.source === "managed" ? await readManagedJavaMetadata("java-sdk") : undefined
  return {
    ...CATALOG["java-sdk"],
    id: "java-sdk",
    installed,
    version: runtime ? await readVersion(runtime.path, ["-version"]) : undefined,
    source: runtime?.source ?? "missing",
    path: runtime?.path,
    detail: renderJavaSdkDetail(runtime, metadata?.sourceLabel),
    targets,
    actions: {
      install: !targets.some((target) => target.id === "managed"),
      repair: targets.some((target) => target.id === "managed"),
      activate: targets.length > 1,
      openPath: !!runtime?.path,
      viewLogs: true,
    },
  }
}

async function detectOfficeCli(): Promise<RuntimeManageItem> {
  const command = await resolveOfficeCliCommand()
  const managed = await resolveManagedOfficeCli()
  const system = resolveSystemOfficeCli()
  const metadata = command?.source === "managed" ? await readManagedOfficeCliMetadata(command.version) : undefined
  return {
    ...CATALOG.officecli,
    id: "officecli",
    installed: !!command,
    version: command ? await readVersion(command.path, ["--version"]) : undefined,
    source: command?.source ?? "missing",
    path: command?.path,
    detail: renderOfficeCliDetail(command, metadata?.version),
    targets: [
      managed
        ? {
            id: "managed",
            label: `受管 OfficeCLI ${managed.version}`,
            source: "managed" as const,
            active: command?.source === "managed" && samePath(command.path, managed.path),
          }
        : undefined,
      system
        ? {
            id: "system",
            label: "系统 OfficeCLI",
            source: "system" as const,
            active: command?.source === "system" && samePath(command.path, system.path),
          }
        : undefined,
    ].filter(Boolean) as RuntimeManageTarget[],
    actions: {
      install: !managed,
      repair: !!managed,
      update: true,
      activate: !!managed && !!system,
      openPath: !!command?.path,
      viewLogs: true,
    },
  }
}

function renderRecorderDetail(
  recorder: ReturnType<typeof resolveRecorderCommand>,
  sourceLabel: string | undefined,
) {
  if (!recorder) return "当前未发现可用录音命令。Windows 可直接安装受管 SoX，Linux 可使用 arecord 或 sox。"
  if (recorder.source === "managed") {
    return sourceLabel ? `当前使用受管录音器。来源：${sourceLabel}` : "当前使用受管录音器。"
  }
  return "当前使用系统录音命令；如需稳定隔离环境，可安装受管 SoX。"
}

function renderFfmpegDetail(
  ffmpeg: ReturnType<typeof resolveFfmpegBinary>,
  sourceLabel: string | undefined,
) {
  if (!ffmpeg) return "当前未发现可用 ffmpeg。可直接安装受管 FFmpeg Essentials。"
  if (ffmpeg.source === "managed") {
    return sourceLabel ? `当前使用受管 FFmpeg。来源：${sourceLabel}` : "当前使用受管 FFmpeg。"
  }
  return "当前使用系统 FFmpeg；如需稳定隔离环境，可安装受管 FFmpeg Essentials。"
}

function renderJavaRuntimeDetail(
  runtime: ReturnType<typeof resolvePreferredJavaBinary>,
  sourceLabel: string | undefined,
) {
  if (!runtime) return "当前未发现可用 java。可直接安装受管 JRE 21，或安装 JDK 21 一并提供运行时。"
  if (runtime.source === "managed" && runtime.artifact === "java-sdk") {
    return sourceLabel
      ? `当前由受管 JDK 提供 java。来源：${sourceLabel}`
      : "当前由受管 JDK 提供 java。"
  }
  if (runtime.source === "managed") {
    return sourceLabel ? `当前使用受管 Java 运行时。来源：${sourceLabel}` : "当前使用受管 Java 运行时。"
  }
  return "当前使用系统 Java；如需稳定隔离环境，可安装受管 JRE 21。"
}

function renderJavaSdkDetail(
  runtime: ReturnType<typeof resolvePreferredJavaBinary>,
  sourceLabel: string | undefined,
) {
  if (!runtime) return "当前未发现可用 javac。可直接安装受管 JDK 21。"
  if (runtime.source === "managed") {
    return sourceLabel ? `当前使用受管 Java SDK。来源：${sourceLabel}` : "当前使用受管 Java SDK。"
  }
  return "当前使用系统 Java SDK；如需稳定隔离环境，可安装受管 JDK 21。"
}

function renderCppDetail(
  compiler: ReturnType<typeof resolveCppCommand>,
  sourceLabel: string | undefined,
  releaseTag: string | undefined,
) {
  if (!compiler) return "当前未发现可用 C++ 编译器。可直接安装受管 MinGW。"
  if (compiler && isManagedCppCommand(compiler)) {
    const source = sourceLabel ?? "受管 MinGW"
    return releaseTag ? `当前使用${source}。版本源：${releaseTag}` : `当前使用${source}。`
  }
  return "当前使用系统 C++ 编译器；如需稳定隔离环境，可安装受管 MinGW。"
}

function renderOfficeCliDetail(command: Awaited<ReturnType<typeof resolveOfficeCliCommand>>, metadataVersion: string | undefined) {
  if (!command) return "当前未发现 OfficeCLI。安装受管版本后可直接使用 office 工具处理 docx、xlsx 和 pptx。"
  if (command.source === "managed") {
    return `当前使用受管 OfficeCLI${metadataVersion ? ` ${metadataVersion}` : ""}；更新会校验 release SHA-256 并保留上一版本用于回退。`
  }
  return "当前使用系统 OfficeCLI；可安装受管版本以获得受 Lfcode 管理的更新、校验和回退。"
}

function detectPythonBaseSource(command: string): RuntimeManageItem["source"] {
  const envPath = process.env.LFCODE_PYTHON_PATH
  if (envPath && samePath(command, envPath)) return "bundled"
  if (command.includes(`${path.sep}resources${path.sep}`)) return "bundled"
  return "system"
}

function buildVoiceRecorderTargets(recorder: ReturnType<typeof resolveRecorderCommand>): RuntimeManageTarget[] {
  const managed = resolveManagedRecorderPath()
  const system = resolveSystemRecorderCommand()
  return [
    managed
      ? {
          id: "managed",
          label: "受管 SoX",
          source: "managed",
          active: recorder?.source === "managed" && recorder.path === managed,
        }
      : undefined,
    system
      ? {
          id: "system",
          label: "系统录音器",
          source: "system",
          active: recorder?.source === "system" && recorder.path === system.path,
        }
      : undefined,
  ].filter(Boolean) as RuntimeManageTarget[]
}

function buildFfmpegTargets(ffmpeg: ReturnType<typeof resolveFfmpegBinary>): RuntimeManageTarget[] {
  const managed = resolveManagedFfmpegBinary("ffmpeg")
  const system = resolveSystemFfmpegBinary("ffmpeg")
  return [
    managed
      ? {
          id: "managed",
          label: "受管 FFmpeg",
          source: "managed",
          active: ffmpeg?.source === "managed" && ffmpeg.path === managed,
        }
      : undefined,
    system
      ? {
          id: "system",
          label: "系统 FFmpeg",
          source: "system",
          active: ffmpeg?.source === "system" && ffmpeg.path === system.path,
        }
      : undefined,
  ].filter(Boolean) as RuntimeManageTarget[]
}

function buildCppTargets(compiler: ReturnType<typeof resolveCppCommand>): RuntimeManageTarget[] {
  const managed = managedCppExecutable()
  const hasManaged = !!Filesystem.stat(managed)?.isFile()
  const system = resolveSystemCppCompiler()
  const hasSystem = !!system
  return [
    hasManaged
      ? {
          id: "managed",
          label: "受管 MinGW",
          source: "managed",
          active: !!compiler && isManagedCppCommand(compiler) && samePath(compiler.command, managed),
        }
      : undefined,
    hasSystem
      ? {
          id: "system",
          label: "系统编译器",
          source: "system",
          active: !!compiler && !isManagedCppCommand(compiler) && !!system && samePath(compiler.command, system.command),
        }
      : undefined,
  ].filter(Boolean) as RuntimeManageTarget[]
}

function buildJavaRuntimeTargets(runtime: ReturnType<typeof resolvePreferredJavaBinary>): RuntimeManageTarget[] {
  const managedJre = resolveManagedJavaBinary("java", "java-runtime")
  const managedJdk = resolveManagedJavaBinary("java", "java-sdk")
  const system = resolveJavaSystemTarget("java")
  return [
    managedJre
      ? {
          id: "managed-jre",
          label: "受管 JRE 21",
          source: "managed",
          active: runtime?.source === "managed" && runtime.artifact === "java-runtime" && samePath(runtime.path, managedJre.path),
        }
      : undefined,
    managedJdk
      ? {
          id: "managed-jdk",
          label: "受管 JDK 21",
          source: "managed",
          active: runtime?.source === "managed" && runtime.artifact === "java-sdk" && samePath(runtime.path, managedJdk.path),
        }
      : undefined,
    system
      ? {
          id: "system",
          label: "系统 Java",
          source: "system",
          active: runtime?.source === "system" && samePath(runtime.path, system.path),
        }
      : undefined,
  ].filter(Boolean) as RuntimeManageTarget[]
}

function buildJavaSdkTargets(runtime: ReturnType<typeof resolvePreferredJavaBinary>): RuntimeManageTarget[] {
  const managed = resolveManagedJavaBinary("javac", "java-sdk")
  const system = resolveJavaSystemTarget("javac")
  return [
    managed
      ? {
          id: "managed",
          label: "受管 JDK 21",
          source: "managed",
          active: runtime?.source === "managed" && runtime.artifact === "java-sdk" && samePath(runtime.path, managed.path),
        }
      : undefined,
    system
      ? {
          id: "system",
          label: "系统 Java SDK",
          source: "system",
          active: runtime?.source === "system" && samePath(runtime.path, system.path),
        }
      : undefined,
  ].filter(Boolean) as RuntimeManageTarget[]
}

function resolveJavaSystemTarget(binary: "java" | "javac") {
  const system = which(process.platform === "win32" ? `${binary}.exe` : binary)
  if (!system) return
  return {
    path: system,
    source: "system" as const,
    artifact: binary === "javac" ? ("java-sdk" as ManagedJavaArtifactID) : ("java-runtime" as ManagedJavaArtifactID),
  }
}

function resolveSystemCppCompiler() {
  const candidates = process.platform === "win32" ? ["g++.exe", "g++", "clang++.exe", "clang++"] : ["g++", "clang++"]
  for (const candidate of candidates) {
    const resolved = which(candidate)
    if (!resolved) continue
    return {
      command: resolved,
      args: [],
    }
  }
}

function samePath(left: string, right: string) {
  const normalize = (value: string) => path.resolve(value).replaceAll("\\", "/").toLowerCase()
  return normalize(left) === normalize(right)
}

async function readVersion(command: string, args: string[]) {
  try {
    const result = await Process.run([command, ...args], {
      nothrow: true,
      timeout: 5_000,
    })
    const output = `${result.stdout.toString("utf8")}\n${result.stderr.toString("utf8")}`.trim()
    if (!output) return
    return output.split(/\r?\n/)[0]?.trim()
  } catch {
    return
  }
}
