import type { SessionStatus } from "@lfcode-ai/sdk/v2/client"

export const isSessionWorking = (status: SessionStatus | undefined) => status !== undefined && status.type !== "idle"
