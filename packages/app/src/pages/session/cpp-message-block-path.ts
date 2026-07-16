export function createCppMessageScratchPath(input: {
  sessionID: string
  messageID: string
  partID: string
  blockIndex: number
}) {
  return `.lfcode/scratch/cpp/${input.sessionID}/${input.messageID}-${input.partID}-${input.blockIndex}.cpp`
}
