import { defineConfig } from "drizzle-kit"
import { resolveLfcodeHome } from "@lfcode-ai/shared/global"

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url: `${resolveLfcodeHome().data}/lfcode.db`,
  },
})
