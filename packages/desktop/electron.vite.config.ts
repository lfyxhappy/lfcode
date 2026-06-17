import { defineConfig } from "electron-vite"
import appPlugin from "@lfcode-ai/app/vite"
import * as fs from "node:fs/promises"

const channel = (() => {
  const raw = process.env.LFCODE_CHANNEL
  if (raw === "stable") return raw
  return "stable"
})()

const LFCODE_SERVER_DIST = "../lfcode/dist/node"

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

export default defineConfig({
  main: {
    define: {
      "import.meta.env.LFCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts" },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "lfcode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "lfcode:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:lfcode-server") return this.resolve(`${LFCODE_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "lfcode:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(LFCODE_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${LFCODE_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [appPlugin],
    publicDir: "../../../app/public",
    root: "src/renderer",
    define: {
      "import.meta.env.VITE_LFCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
          loading: "src/renderer/loading.html",
        },
      },
    },
  },
})
