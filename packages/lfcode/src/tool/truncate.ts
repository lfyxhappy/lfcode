import { NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, Layer, Schedule, Context } from "effect"
import path from "path"
import type { Agent } from "../agent/agent"
import { AppFileSystem } from "@/filesystem"
import { evaluate } from "@/permission/evaluate"
import { Identifier } from "../id/id"
import { Log } from "../util"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"
import { redactSensitiveText } from "@/util/redact"

const log = Log.create({ service: "truncation" })
const RETENTION = Duration.days(7)

export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024
export const DIR = TRUNCATION_DIR
export const GLOB = path.join(TRUNCATION_DIR, "*")

const ERROR_PATTERN = /error|exception|failed|fatal|traceback|panic|exit code/i
const TAIL_SCAN_CHARS = 2048

export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputRef: string }

export interface Options {
  maxLines?: number
  maxBytes?: number
  direction?: "head" | "tail" | "head+tail"
  pressureCaps?: boolean
}

function hasActorTool(agent?: Agent.Info) {
  if (!agent?.permission) return false
  return evaluate("actor", "*", agent.permission).action !== "deny"
}

export interface Interface {
  readonly cleanup: () => Effect.Effect<void>
  readonly write: (text: string) => Effect.Effect<string>
  /**
   * Returns output unchanged when it fits within the limits, otherwise writes the full text
   * to the truncation directory and returns a preview plus a hint to inspect the saved file.
   */
  readonly output: (text: string, options?: Options, agent?: Agent.Info) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@lfcode/Truncate") {}

const OUTPUT_REFERENCE_PREFIX = "tool-output:"

export const redact = redactSensitiveText

export function outputReference(file: string) {
  return `${OUTPUT_REFERENCE_PREFIX}${path.basename(file)}`
}

export function resolveOutputReference(reference: string) {
  if (!reference.startsWith(OUTPUT_REFERENCE_PREFIX)) return
  const basename = reference.slice(OUTPUT_REFERENCE_PREFIX.length)
  if (!basename.startsWith("tool_") || basename !== path.basename(basename)) return
  return path.join(TRUNCATION_DIR, basename)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const cleanup = Effect.fn("Truncate.cleanup")(function* () {
      const cutoff = Identifier.timestamp(
        Identifier.create("tool", "ascending", Date.now() - Duration.toMillis(RETENTION)),
      )
      const entries = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
        Effect.map((all) => all.filter((name) => name.startsWith("tool_"))),
        Effect.catch(() => Effect.succeed([])),
      )
      for (const entry of entries) {
        if (Identifier.timestamp(entry) >= cutoff) continue
        yield* fs.remove(path.join(TRUNCATION_DIR, entry)).pipe(Effect.catch(() => Effect.void))
      }
    })

    const write = Effect.fn("Truncate.write")(function* (text: string) {
      const file = path.join(TRUNCATION_DIR, ToolID.ascending())
      yield* fs.ensureDir(TRUNCATION_DIR).pipe(Effect.orDie)
      yield* fs.writeFileString(file, redact(text)).pipe(Effect.orDie)
      return file
    })

    const output = Effect.fn("Truncate.output")(function* (text: string, options: Options = {}, agent?: Agent.Info) {
      text = redact(text)
      let maxLines = options.maxLines ?? MAX_LINES
      let maxBytes = options.maxBytes ?? MAX_BYTES
      const direction = options.direction ?? "head+tail"
      const pressureCaps = options.pressureCaps ?? false

      if (pressureCaps) {
        maxLines = Math.floor(maxLines / 2)
        maxBytes = Math.floor(maxBytes / 2)
      }

      const lines = text.split("\n")
      const totalBytes = Buffer.byteLength(text, "utf-8")

      if (lines.length <= maxLines && totalBytes <= maxBytes) {
        return { content: text, truncated: false } as const
      }

      if (direction === "head+tail") {
        // Check if the last TAIL_SCAN_CHARS contain an error pattern
        const tailScan = text.length > TAIL_SCAN_CHARS ? text.slice(-TAIL_SCAN_CHARS) : text
        const hasErrors = ERROR_PATTERN.test(tailScan)

        if (hasErrors) {
          // Allocate 70% of budget to head, 30% to tail
          const headMaxLines = Math.floor(maxLines * 0.7)
          const headMaxBytes = Math.floor(maxBytes * 0.7)
          const tailMaxLines = maxLines - headMaxLines
          const tailMaxBytes = maxBytes - headMaxBytes

          // Collect head lines
          const headOut: string[] = []
          let headBytes = 0
          for (let i = 0; i < lines.length && headOut.length < headMaxLines; i++) {
            const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
            if (headBytes + size > headMaxBytes) break
            headOut.push(lines[i])
            headBytes += size
          }

          // Collect tail lines
          const tailOut: string[] = []
          let tailBytes = 0
          for (let i = lines.length - 1; i >= 0 && tailOut.length < tailMaxLines; i--) {
            const size = Buffer.byteLength(lines[i], "utf-8") + (tailOut.length > 0 ? 1 : 0)
            if (tailBytes + size > tailMaxBytes) break
            tailOut.unshift(lines[i])
            tailBytes += size
          }

          const omitted = lines.length - headOut.length - tailOut.length
          const file = yield* write(text)

          const reference = outputReference(file)
          const hintText = hasActorTool(agent)
            ? `The tool call succeeded but the output was truncated. Full output is available as ${reference}. Use tool_output with operation=\"search\" or a bounded read; delegate broad inspection to an explore actor.`
            : `The tool call succeeded but the output was truncated. Full output is available as ${reference}. Use tool_output with operation=\"search\" or a bounded read.`

          return {
            content: `${headOut.join("\n")}\n\n... ${omitted} lines omitted — showing head and tail ...\n\n${tailOut.join("\n")}\n\n${hintText}`,
            truncated: true,
            outputRef: reference,
          } as const
        }
        // No errors in tail: degrade to head behavior
      }

      const out: string[] = []
      let i = 0
      let bytes = 0
      let hitBytes = false

      if (direction === "head" || direction === "head+tail") {
        for (i = 0; i < lines.length && i < maxLines; i++) {
          const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
          if (bytes + size > maxBytes) {
            hitBytes = true
            break
          }
          out.push(lines[i])
          bytes += size
        }
      } else {
        for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
          const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
          if (bytes + size > maxBytes) {
            hitBytes = true
            break
          }
          out.unshift(lines[i])
          bytes += size
        }
      }

      const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
      const unit = hitBytes ? "bytes" : "lines"
      const preview = out.join("\n")
      const file = yield* write(text)

      const reference = outputReference(file)
      const hintText = hasActorTool(agent)
        ? `The tool call succeeded but the output was truncated. Full output is available as ${reference}. Use tool_output with operation=\"search\" or a bounded read; delegate broad inspection to an explore actor.`
        : `The tool call succeeded but the output was truncated. Full output is available as ${reference}. Use tool_output with operation=\"search\" or a bounded read.`

      return {
        content:
          direction === "head" || direction === "head+tail"
            ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hintText}`
            : `...${removed} ${unit} truncated...\n\n${hintText}\n\n${preview}`,
        truncated: true,
        outputRef: reference,
      } as const
    })

    yield* cleanup().pipe(
      Effect.catchCause((cause) => {
        log.error("truncation cleanup failed", { cause: Cause.pretty(cause) })
        return Effect.void
      }),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.delay(Duration.minutes(1)),
      Effect.forkScoped,
    )

    return Service.of({ cleanup, write, output })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer), Layer.provide(NodePath.layer))

