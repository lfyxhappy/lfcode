import type { Message as MessageType } from "@lfcode-ai/sdk/v2"

export const messageHashTargetId = (message: Pick<MessageType, "id" | "role"> & { parentID?: string }) =>
  message.role === "assistant" ? message.parentID ?? message.id : message.id
