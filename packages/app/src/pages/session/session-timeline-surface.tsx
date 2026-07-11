import { createEffect, onCleanup } from "solid-js"
import type { VirtualizerHandle } from "virtua/solid"
import { MessageTimeline, type MessageTimelineProps } from "./message-timeline"
import { sessionViewSurfaceKey, type SessionSurface } from "./session-view-state"
import { readSessionVirtualCache, rememberSessionVirtualCache } from "./session-virtual-cache"

type CachedVirtualizer = {
  handle: VirtualizerHandle
  key: string
  sessionID: string
  revision: string
  turnIDs: string[]
}

export type SessionTimelineSurfaceProps = Omit<MessageTimelineProps, "onVirtualizerRef" | "virtualizerCache"> & {
  surface: SessionSurface
  turnIDs: () => string[]
  contentRevision: () => string
  onVirtualizerRef?: (handle: VirtualizerHandle | undefined) => void
}

/**
 * Owns only renderer-lifetime virtualizer state. The route still owns message
 * data today, but cache identity is now bound to a surface instead of route
 * reads during unmount, which is the prerequisite for independent surfaces.
 */
export function SessionTimelineSurface(props: SessionTimelineSurfaceProps) {
  let virtualizer: VirtualizerHandle | undefined
  let cached: CachedVirtualizer | undefined
  // This component is mounted keyed by session. Capture the identity once so
  // an old ref can never be saved under a newly selected route's cache key.
  const surfaceKey = sessionViewSurfaceKey(props.sessionKey(), props.surface)

  const remember = () => {
    if (!cached) return
    rememberSessionVirtualCache({
      key: cached.key,
      sessionID: cached.sessionID,
      turnIDs: cached.turnIDs,
      revision: cached.revision,
      cache: cached.handle.cache,
    })
  }

  const bindVirtualizer = (handle: VirtualizerHandle | undefined) => {
    if (!handle && virtualizer) remember()
    virtualizer = handle
    const sessionID = props.sessionID()
    cached =
      handle && sessionID
        ? {
            handle,
            key: surfaceKey,
            sessionID,
            revision: props.contentRevision(),
            turnIDs: props.turnIDs(),
          }
        : undefined
    props.onVirtualizerRef?.(handle)
  }

  createEffect(() => {
    const revision = props.contentRevision()
    const turnIDs = props.turnIDs()
    // The ref can outlive a route prop update for one reactive turn. Keep the
    // cache ownership captured when the ref mounted; the new virtualizer ref
    // will bind its own key after the keyed list remounts.
    if (!virtualizer || !cached) return
    cached = { handle: virtualizer, key: surfaceKey, sessionID: cached.sessionID, revision, turnIDs }
  })

  onCleanup(remember)

  return (
    <MessageTimeline
      {...props}
      onVirtualizerRef={bindVirtualizer}
      virtualizerCache={() => {
        return readSessionVirtualCache({
          key: surfaceKey,
          turnIDs: props.turnIDs(),
          revision: props.contentRevision(),
        })
      }}
    />
  )
}
