import type { Interface as ShellBackgroundRuntimeInterface } from "./runtime"

export const shellBackgroundRuntimeRef: {
  current: ShellBackgroundRuntimeInterface | undefined
} = { current: undefined }
