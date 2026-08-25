import type { Interface as ActorDispatchInterface } from "./dispatch"

export const dispatchRef: { current: ActorDispatchInterface | undefined } = { current: undefined }
