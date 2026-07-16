import type { SessionStatus } from "@lfcode-ai/sdk/v2/client"

export const isSessionStreaming = (status: SessionStatus | undefined) =>
  status?.type === "busy" || status?.type === "retry"

export const isSessionWaiting = (status: SessionStatus | undefined) => status?.type === "waiting"

export const isSessionWorking = (status: SessionStatus | undefined) => isSessionStreaming(status)
