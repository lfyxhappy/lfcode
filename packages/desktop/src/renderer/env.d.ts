import type { ElectronAPI } from "../preload/types"
import type { DetachedSidePanelContext } from "@lfcode-ai/app/pages/session/detached-side-panel"

declare global {
  interface Window {
    api: ElectronAPI
    __LFCODE__?: {
      deepLinks?: string[]
      detachedSidePanel?: DetachedSidePanelContext
    }
  }
}
