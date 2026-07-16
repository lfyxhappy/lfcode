import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Flock } from "@lfcode-ai/shared/util/flock"
import { Global } from "@/global"
import { Process } from "@/util"
import {
  managedPythonExecutable,
  managedPythonRoot,
  resolveManagedPythonCommandEntry,
  resolveBasePythonCommand,
} from "./runtime"
import {
  MANAGED_PYTHON_PACKAGE_MANIFEST_VERSION,
  managedPythonPackageInstallNames,
} from "./managed-packages"

const INIT_LOCK = "python-managed-environment"
const INIT_TIMEOUT = 5 * 60 * 1000
const PACKAGE_MARKER = ".lfcode-python-packages.json"

function renderFailure(result: { code: number; stdout: Buffer; stderr: Buffer }) {
  const stdout = result.stdout.toString("utf8").trim()
  const stderr = result.stderr.toString("utf8").trim()
  const sections = [stdout, stderr].filter(Boolean)
  if (sections.length === 0) return `exit code ${result.code} with no output`
  return sections.join("\n\n")
}

const runPython = Effect.fn("PythonEnvironment.runPython")(function* (command: string, args: string[]) {
  const result = yield* Effect.promise(() =>
    Process.run([command, ...args], {
      cwd: Global.Path.data,
      nothrow: true,
      abort: AbortSignal.timeout(INIT_TIMEOUT),
    }),
  )
  if (result.code === 0) return
  throw new Error(`Python environment bootstrap failed: ${renderFailure(result)}`)
})

export const ensureManagedPythonCommand = Effect.fn("PythonEnvironment.ensureManagedPythonCommand")(function* () {
  const existing = resolveManagedPythonCommandEntry()
  if (existing?.source === "env") {
    return {
      command: existing.command,
      args: existing.args,
    }
  }
  if (existing && (yield* hasCurrentPackageMarker(existing.command))) {
    return {
      command: existing.command,
      args: existing.args,
    }
  }

  yield* Effect.acquireRelease(
    Effect.tryPromise(() => Flock.acquire(INIT_LOCK, { dir: path.join(Global.Path.state, "locks") })),
    (lock) =>
      Effect.tryPromise(() => lock.release()).pipe(Effect.orElseSucceed(() => undefined)),
  )

  const current = resolveManagedPythonCommandEntry()
  if (current?.source === "env") {
    return {
      command: current.command,
      args: current.args,
    }
  }
  if (current) {
    yield* ensureManagedPythonPackages(current.command)
    return {
      command: current.command,
      args: current.args,
    }
  }

  const base = resolveBasePythonCommand()
  if (!base) {
    throw new Error(
      "Python runtime not found. Install Python or provide LFCODE_PYTHON_PATH so Lfcode can initialize its managed Python environment.",
    )
  }

  yield* Effect.promise(() => fs.mkdir(path.dirname(managedPythonRoot()), { recursive: true }))
  yield* Effect.promise(() => fs.rm(managedPythonRoot(), { recursive: true, force: true }))
  yield* runPython(base.command, [...base.args, "-m", "venv", managedPythonRoot()])
  yield* runPython(managedPythonExecutable(), ["-m", "ensurepip", "--upgrade"])
  yield* ensureManagedPythonPackages(managedPythonExecutable())

  const managed = resolveManagedPythonCommandEntry()
  if (managed) {
    return {
      command: managed.command,
      args: managed.args,
    }
  }
  throw new Error(`Managed Python environment did not produce an executable at ${managedPythonExecutable()}.`)
}, Effect.scoped)

const ensureManagedPythonPackages = Effect.fn("PythonEnvironment.ensureManagedPythonPackages")(function* (command: string) {
  if (yield* hasCurrentPackageMarker(command)) return
  yield* runPython(command, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--upgrade-strategy",
    "only-if-needed",
    ...managedPythonPackageInstallNames(),
  ])
  yield* Effect.promise(() => writePackageMarker(command))
})

const hasCurrentPackageMarker = Effect.fn("PythonEnvironment.hasCurrentPackageMarker")(function* (command: string) {
  return yield* Effect.promise(async () => {
    try {
      const raw = await fs.readFile(packageMarkerPath(command), "utf8")
      const data = JSON.parse(raw) as {
        version?: number
        packages?: string[]
      }
      return (
        data.version === MANAGED_PYTHON_PACKAGE_MANIFEST_VERSION &&
        JSON.stringify(data.packages ?? []) === JSON.stringify(managedPythonPackageInstallNames())
      )
    } catch {
      return false
    }
  })
})

function writePackageMarker(command: string) {
  return fs.writeFile(
    packageMarkerPath(command),
    JSON.stringify(
      {
        version: MANAGED_PYTHON_PACKAGE_MANIFEST_VERSION,
        packages: managedPythonPackageInstallNames(),
      },
      null,
      2,
    ),
    "utf8",
  )
}

function packageMarkerPath(command: string) {
  return path.join(path.dirname(path.dirname(command)), PACKAGE_MARKER)
}
