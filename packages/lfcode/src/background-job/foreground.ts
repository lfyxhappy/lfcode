import { Identifier } from "@/id/id"
import type { MessageID, SessionID } from "@/session/schema"
import { BackgroundJobPersistence } from "./persistence"

type ForegroundJobInput = {
  sessionID: SessionID
  source: string
  title: string
  cwd: string
  payload: Record<string, unknown>
  env?: Record<string, string>
  sourceMessageID?: MessageID
  sourceToolCallID?: string
}

type ForegroundJobTerminal = {
  status: "completed" | "failed" | "cancelled"
  exitCode?: number
  error?: string
}

const LOG_CHUNK_BYTES = 4096

export function startForegroundJob(input: ForegroundJobInput) {
  const id = Identifier.ascending("job")
  let sequence = 0
  let pending: { stream: "stdout" | "stderr"; text: string } | undefined
  let settled = false

  BackgroundJobPersistence.recordStart({
    id,
    sessionID: input.sessionID,
    kind: "shell",
    source: input.source,
    title: input.title,
    cwd: input.cwd,
    payload: input.payload,
    ...(input.env ? { env: input.env } : {}),
    ...(input.sourceMessageID ? { sourceMessageID: input.sourceMessageID } : {}),
    ...(input.sourceToolCallID ? { sourceToolCallID: input.sourceToolCallID } : {}),
    metadata: { mode: "foreground" },
  })

  const flush = () => {
    if (!pending) return
    const job = BackgroundJobPersistence.load(id)
    if (!job || job.status !== "running") return
    BackgroundJobPersistence.appendLog({
      jobID: id,
      sessionID: job.sessionID,
      seq: ++sequence,
      stream: pending.stream,
      text: pending.text,
    })
    pending = undefined
  }

  return {
    attach(pid?: number) {
      if (pid === undefined) return
      BackgroundJobPersistence.attachProcess({ id, pid })
    },
    append(stream: "stdout" | "stderr", text: string) {
      if (settled || !text) return
      if (pending && pending.stream !== stream) flush()
      pending = pending
        ? { stream, text: pending.text + text }
        : { stream, text }
      if (Buffer.byteLength(pending.text, "utf8") >= LOG_CHUNK_BYTES) flush()
    },
    complete(terminal: ForegroundJobTerminal) {
      if (settled) return
      settled = true
      flush()
      const job = BackgroundJobPersistence.load(id)
      if (!job || job.status !== "running") return
      BackgroundJobPersistence.recordTerminal({
        id,
        status: terminal.status,
        ...(terminal.exitCode === undefined ? {} : { exitCode: terminal.exitCode }),
        ...(terminal.error === undefined ? {} : { error: terminal.error }),
        pid: null,
      })
    },
  }
}
