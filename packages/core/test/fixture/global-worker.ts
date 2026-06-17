import { Global } from "@lfcode-ai/core/global"

process.stdout.write(
  JSON.stringify({
    path: {
      data: Global.Path.data,
      cache: Global.Path.cache,
      config: Global.Path.config,
      state: Global.Path.state,
      bin: Global.Path.bin,
      log: Global.Path.log,
      repos: Global.Path.repos,
      tmp: Global.Path.tmp,
    },
    make: Global.make(),
  }),
)
