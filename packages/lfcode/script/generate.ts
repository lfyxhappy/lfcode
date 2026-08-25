import { ensureBundledModelsCatalog } from "./models-catalog"

const snapshot = await ensureBundledModelsCatalog()
console.log(`Using bundled models catalog: ${snapshot.metadata.models} models from ${snapshot.metadata.providers} providers`)
