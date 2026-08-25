import { defineConfig } from "electron-vite"
import appPlugin from "@lfcode-ai/app/vite"
import * as fs from "node:fs/promises"

const channel = (() => {
  const raw = process.env.LFCODE_CHANNEL
  if (raw === "stable") return raw
  return "stable"
})()
const preRelease = process.env.LFCODE_PRE_RELEASE === "true"

const LFCODE_SERVER_DIST = "../lfcode/dist/node/src"
const LFCODE_SERVER_ASSET_DIR = "../lfcode/dist/node"
let serverAssets: { name: string; data: Uint8Array }[] = []

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`
const esmShim = `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`

export default defineConfig({
  main: {
    define: {
      "import.meta.env.LFCODE_CHANNEL": JSON.stringify(channel),
      "import.meta.env.LFCODE_PRE_RELEASE": JSON.stringify(preRelease ? "true" : "false"),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts" },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "lfcode:esm-shim",
        enforce: "pre",
        renderChunk: {
          order: "pre",
          handler(code, _chunk, options) {
            if (options.format !== "es") return null
            if (code.includes(esmShim)) return null
            if (!/__filename|__dirname|require\(|require\.resolve\(/.test(code)) return null

            // electron-vite 5 finds the insertion point with a regex that can mistake
            // prose ending in `import` for a static import inside large generated chunks.
            return `${esmShim}${code}`
          },
        },
      },
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
        async buildStart() {
          serverAssets = await Promise.all(
            (await fs.readdir(LFCODE_SERVER_ASSET_DIR))
              .filter((name) => name.endsWith(".wasm"))
              .map(async (name) => ({ name, data: await fs.readFile(`${LFCODE_SERVER_ASSET_DIR}/${name}`) })),
          )
        },
        async writeBundle() {
          // Bundled file imports in the server chunk resolve `../asset` from
          // `out/main/chunks/*.js`, so the runtime lookup is `out/main/*.wasm`.
          // Keep a chunks copy as well for tooling that inspects the emitted
          // chunk directory directly.
          await Promise.all(
            serverAssets.flatMap((asset) => [
              fs.writeFile(`./out/main/${asset.name}`, asset.data),
              fs.writeFile(`./out/main/chunks/${asset.name}`, asset.data),
            ]),
          )
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts", "browser-webview": "src/preload/browser-webview.ts" },
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
      "import.meta.env.VITE_LFCODE_PRE_RELEASE": JSON.stringify(preRelease ? "true" : "false"),
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
