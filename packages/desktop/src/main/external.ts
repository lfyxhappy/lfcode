import log from "electron-log/main.js"
import { shell } from "electron"
import { createOpenExternal } from "./external-core"

export const openExternal = createOpenExternal({
  openExternal: (url) => shell.openExternal(url),
  logError: (message, data) => {
    log.error(message, data)
  },
})
