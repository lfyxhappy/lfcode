import { defineServerPlugin, action, tool } from "@lfcode-ai/plugin"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const providers = [
  { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", defaultModel: "gpt-image-1", protocol: "openai" },
  { id: "azure-openai", name: "Azure OpenAI", defaultBaseUrl: "", defaultModel: "gpt-image-1", protocol: "azure" },
  { id: "stability", name: "Stability AI", defaultBaseUrl: "https://api.stability.ai", defaultModel: "stable-image-core", protocol: "stability" },
  { id: "replicate", name: "Replicate", defaultBaseUrl: "https://api.replicate.com/v1", defaultModel: "black-forest-labs/flux-1.1-pro", protocol: "replicate" },
  { id: "bfl", name: "BFL / FLUX", defaultBaseUrl: "https://api.bfl.ai/v1", defaultModel: "flux-pro-1.1", protocol: "bfl" },
  { id: "gemini", name: "Google Gemini / Imagen", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "imagen-4.0-generate-001", protocol: "gemini" },
  { id: "dashscope", name: "阿里云百炼 / 万相", defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1", defaultModel: "wanx2.1-t2i-turbo", protocol: "dashscope" },
  { id: "volcengine", name: "火山引擎 Ark / 豆包", defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-seedream-3-0-t2i", protocol: "openai" },
  { id: "custom", name: "自定义 REST", defaultBaseUrl: "", defaultModel: "", protocol: "custom" },
] as const

type ProviderID = (typeof providers)[number]["id"]
type Config = {
  provider: ProviderID
  baseUrl?: string
  model?: string
  custom?: { method?: "POST"; path?: string; headers?: Record<string, string>; body?: Record<string, unknown>; responsePath?: string; mime?: string }
}
type GalleryItem = { id: string; createdAt: number; provider: ProviderID; model: string; prompt: string; negativePrompt?: string; mime: string; file: string; width?: number; height?: number }

const jobs = new Map<string, AbortController>()
const jobResults = new Map<string, { status: "succeeded" } | { status: "failed"; error: string } | { status: "cancelled" }>()

export default defineServerPlugin({
  id: "lfcode-imagemaker",
  async server(input) {
    if (!input.data) throw new Error("ImageMaker requires its private plugin data directory")
    const secureStorage = input.secureStorage
    if (!secureStorage) throw new Error("ImageMaker requires secure credential storage")
    const data = input.data

    return {
      action: {
        status: action({
          input: action.schema.object({}),
          async execute() {
            const config = await readConfig(data)
            return { providers, config, secureStorage: secureStorage.status(), hasSecret: Boolean(await secureStorage.get(secretKey(config.provider))), jobs: [...jobs.keys()], jobResults: Object.fromEntries(jobResults) }
          },
        }),
        configure: action({
          input: action.schema.object({
            provider: action.schema.enum(providers.map((item) => item.id) as [ProviderID, ...ProviderID[]]),
            baseUrl: action.schema.string().url().optional().or(action.schema.literal("")),
            model: action.schema.string().max(200).optional(),
            apiKey: action.schema.string().max(8192).optional(),
            clearApiKey: action.schema.boolean().optional(),
            custom: action.schema.object({
              method: action.schema.literal("POST").optional(),
              path: action.schema.string().max(500).optional(),
              headers: action.schema.record(action.schema.string(), action.schema.string()).optional(),
              body: action.schema.record(action.schema.string(), action.schema.unknown()).optional(),
              responsePath: action.schema.string().max(500).optional(),
              mime: action.schema.string().max(100).optional(),
            }).optional(),
          }),
          async execute(value) {
            if (value.apiKey) await secureStorage.set(secretKey(value.provider), value.apiKey)
            if (value.clearApiKey) await secureStorage.remove(secretKey(value.provider))
            const config = { provider: value.provider, baseUrl: value.baseUrl, model: value.model, custom: value.custom } satisfies Config
            await writeJson(path.join(data, "ui.json"), config)
            return { config, secureStorage: secureStorage.status(), hasSecret: Boolean(await secureStorage.get(secretKey(value.provider))) }
          },
        }),
        generate: action({
          input: generationSchema(action.schema),
          async execute(value) {
            const jobID = crypto.randomUUID()
            const controller = new AbortController()
            jobs.set(jobID, controller)
            void generate(data, secureStorage, value, undefined, { jobID, controller })
              .then(() => jobResults.set(jobID, { status: "succeeded" }))
              .catch((error) => jobResults.set(jobID, controller.signal.aborted ? { status: "cancelled" } : { status: "failed", error: safeError(error instanceof Error ? error.message : String(error)) }))
            return { jobID }
          },
        }),
        generateImmediate: action({
          input: generationSchema(action.schema),
          async execute(value) {
            const result = await generate(data, secureStorage, value)
            return { item: { ...result.item, url: result.url } }
          },
        }),
        gallery: action({
          input: action.schema.object({}),
          async execute() {
            const items = await readGallery(data)
            return { items: await Promise.all(items.map(async (item) => ({ ...item, url: await itemDataUrl(data, item) }))) }
          },
        }),
        cancel: action({
          input: action.schema.object({ jobID: action.schema.string().min(1) }),
          async execute(value) {
            const job = jobs.get(value.jobID)
            job?.abort()
            if (job) jobResults.set(value.jobID, { status: "cancelled" })
            return { cancelled: Boolean(job) }
          },
        }),
      },
      tool: {
        imagemaker_generate: tool({
          description: "Generate an image with the configured ImageMaker provider and return it to the conversation.",
          args: generationSchema(tool.schema).shape,
          activationSkill: "imagemaker",
          async execute(value, context) {
            const result = await generate(data, secureStorage, value, context.abort)
            return {
              output: `Generated image ${result.item.id} with ${result.item.provider}/${result.item.model}.`,
              metadata: { operation: "generate", galleryID: result.item.id, provider: result.item.provider, model: result.item.model, prompt: result.item.prompt },
              attachments: [{ mime: result.item.mime, url: result.url, filename: path.basename(result.item.file) }],
            }
          },
        }),
        imagemaker_edit: tool({
          description: "Edit a previously generated ImageMaker gallery image. Pass the exact source image_id and an edit prompt.",
          args: editSchema(tool.schema).shape,
          activationSkill: "imagemaker",
          async execute(value, context) {
            const result = await edit(data, secureStorage, value, context.abort)
            return {
              output: `Edited image ${result.item.id} from ${value.image_id} with ${result.item.provider}/${result.item.model}.`,
              metadata: { operation: "edit", galleryID: result.item.id, sourceGalleryID: value.image_id, provider: result.item.provider, model: result.item.model, prompt: result.item.prompt },
              attachments: [{ mime: result.item.mime, url: result.url, filename: path.basename(result.item.file) }],
            }
          },
        }),
      },
    }
  },
})

function generationSchema(schema: typeof action.schema) {
  return schema.object({
    prompt: schema.string().min(1).max(20000),
    negativePrompt: schema.string().max(10000).optional(),
    width: schema.number().int().min(256).max(4096).optional(),
    height: schema.number().int().min(256).max(4096).optional(),
    count: schema.number().int().min(1).max(4).optional(),
  })
}

function editSchema(schema: typeof action.schema) {
  return schema.object({
    image_id: schema.string().min(1).max(200),
    prompt: schema.string().min(1).max(20000),
    count: schema.number().int().min(1).max(4).optional(),
  })
}

async function generate(data: string, secureStorage: NonNullable<Parameters<Parameters<typeof defineServerPlugin>[0]["server"]>[0]["secureStorage"]>, value: { prompt: string; negativePrompt?: string; width?: number; height?: number; count?: number }, outerSignal?: AbortSignal, existing?: { jobID: string; controller: AbortController }) {
  const config = await readConfig(data)
  const profile = providers.find((item) => item.id === config.provider) ?? providers[0]
  const apiKey = await secureStorage.get(secretKey(config.provider))
  if (!apiKey) throw new Error(`ImageMaker provider ${profile.name} has no API key configured`)
  const controller = existing?.controller ?? new AbortController()
  const jobID = existing?.jobID ?? crypto.randomUUID()
  if (!existing) jobs.set(jobID, controller)
  const abort = () => controller.abort()
  outerSignal?.addEventListener("abort", abort, { once: true })
  try {
    const image = await requestImage(profile, config, apiKey, value, controller.signal)
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const extension = extensionFor(image.mime)
    const relative = path.join("gallery", `${id}.${extension}`).replaceAll("\\", "/")
    await mkdir(path.join(data, "gallery"), { recursive: true })
    await writeFile(path.join(data, relative), image.bytes)
    const item: GalleryItem = { id, createdAt: Date.now(), provider: config.provider, model: config.model || profile.defaultModel, prompt: value.prompt, negativePrompt: value.negativePrompt, mime: image.mime, file: relative, width: value.width, height: value.height }
    await writeJson(path.join(data, "gallery.json"), [item, ...(await readGallery(data))].slice(0, 500))
    return { jobID, item, url: `data:${image.mime};base64,${image.bytes.toString("base64")}` }
  } finally {
    outerSignal?.removeEventListener("abort", abort)
    jobs.delete(jobID)
  }
}

async function edit(data: string, secureStorage: NonNullable<Parameters<Parameters<typeof defineServerPlugin>[0]["server"]>[0]["secureStorage"]>, value: { image_id: string; prompt: string; count?: number }, outerSignal?: AbortSignal) {
  const config = await readConfig(data)
  const profile = providers.find((item) => item.id === config.provider) ?? providers[0]
  const apiKey = await secureStorage.get(secretKey(config.provider))
  if (!apiKey) throw new Error(`ImageMaker provider ${profile.name} has no API key configured`)
  const source = (await readGallery(data)).find((item) => item.id === value.image_id)
  if (!source) throw new Error(`ImageMaker gallery image ${value.image_id} was not found`)
  const controller = new AbortController()
  const abort = () => controller.abort()
  outerSignal?.addEventListener("abort", abort, { once: true })
  try {
    const image = await requestImageEdit(profile, config, apiKey, { ...value, source }, await readFile(path.join(data, source.file)), controller.signal)
    const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const relative = path.join("gallery", `${id}.${extensionFor(image.mime)}`).replaceAll("\\", "/")
    await mkdir(path.join(data, "gallery"), { recursive: true })
    await writeFile(path.join(data, relative), image.bytes)
    const item: GalleryItem = { id, createdAt: Date.now(), provider: config.provider, model: config.model || profile.defaultModel, prompt: value.prompt, mime: image.mime, file: relative }
    await writeJson(path.join(data, "gallery.json"), [item, ...(await readGallery(data))].slice(0, 500))
    return { item, url: `data:${image.mime};base64,${image.bytes.toString("base64")}` }
  } finally {
    outerSignal?.removeEventListener("abort", abort)
  }
}

async function requestImage(profile: (typeof providers)[number], config: Config, apiKey: string, value: { prompt: string; negativePrompt?: string; width?: number; height?: number; count?: number }, signal: AbortSignal) {
  if (profile.protocol === "stability") return requestStability(profile, config, apiKey, value, signal)
  if (profile.protocol === "replicate") return requestReplicate(profile, config, apiKey, value, signal)
  if (profile.protocol === "bfl") return requestBfl(profile, config, apiKey, value, signal)
  if (profile.protocol === "gemini") return requestGemini(profile, config, apiKey, value, signal)
  if (profile.protocol === "dashscope") return requestDashscope(profile, config, apiKey, value, signal)
  if (profile.protocol === "custom") return requestCustom(config, apiKey, value, signal)
  return requestOpenAI(profile, config, apiKey, value, signal)
}

async function requestOpenAI(profile: (typeof providers)[number], config: Config, apiKey: string, value: { prompt: string; negativePrompt?: string; width?: number; height?: number; count?: number }, signal: AbortSignal) {
  const base = requiredBaseUrl(config.baseUrl || profile.defaultBaseUrl)
  const model = config.model || profile.defaultModel
  const azure = profile.protocol === "azure"
  const url = azure ? `${base.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(model)}/images/generations?api-version=2025-04-01-preview` : `${base.replace(/\/$/, "")}/images/generations`
  const response = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", ...(azure ? { "api-key": apiKey } : { authorization: `Bearer ${apiKey}` }) }, body: JSON.stringify({ ...(!azure && { model }), prompt: combinePrompt(value), n: value.count ?? 1, size: `${value.width ?? 1024}x${value.height ?? 1024}`, response_format: "b64_json" }) })
  const json = await requireJson(response) as { data?: { b64_json?: string; url?: string }[] }
  const image = json.data?.[0]
  if (image?.b64_json) return { bytes: Buffer.from(image.b64_json, "base64"), mime: "image/png" }
  if (image?.url) return downloadImage(image.url, signal)
  throw new Error("Image provider returned no image")
}

async function requestImageEdit(profile: (typeof providers)[number], config: Config, apiKey: string, value: { image_id: string; prompt: string; count?: number; source: GalleryItem }, bytes: Buffer, signal: AbortSignal) {
  if (profile.protocol !== "openai") throw new Error(`${profile.name} does not support ImageMaker editing yet; choose an OpenAI-compatible image provider.`)
  const body = new FormData()
  body.set("model", config.model || profile.defaultModel)
  body.set("prompt", value.prompt)
  body.set("n", String(value.count ?? 1))
  body.set(
    "image",
    new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: value.source.mime }),
    path.basename(value.source.file),
  )
  const response = await fetch(`${requiredBaseUrl(config.baseUrl || profile.defaultBaseUrl).replace(/\/$/, "")}/images/edits`, {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${apiKey}` },
    body,
  })
  const json = await requireJson(response) as { data?: { b64_json?: string; url?: string }[] }
  const image = json.data?.[0]
  if (image?.b64_json) return { bytes: Buffer.from(image.b64_json, "base64"), mime: "image/png" }
  if (image?.url) return downloadImage(image.url, signal)
  throw new Error("Image provider returned no edited image")
}

async function requestStability(profile: (typeof providers)[number], config: Config, apiKey: string, value: { prompt: string; negativePrompt?: string; width?: number; height?: number }, signal: AbortSignal) {
  const body = new FormData()
  body.set("prompt", value.prompt)
  if (value.negativePrompt) body.set("negative_prompt", value.negativePrompt)
  body.set("output_format", "png")
  const model = config.model || profile.defaultModel
  const route = model === "stable-image-core" ? "core" : model === "stable-image-ultra" ? "ultra" : model
  const response = await fetch(`${requiredBaseUrl(config.baseUrl || profile.defaultBaseUrl).replace(/\/$/, "")}/v2beta/stable-image/generate/${route}`, { method: "POST", signal, headers: { authorization: `Bearer ${apiKey}`, accept: "image/*" }, body })
  return requireImage(response)
}

async function requestReplicate(profile: (typeof providers)[number], config: Config, apiKey: string, value: { prompt: string; negativePrompt?: string; width?: number; height?: number }, signal: AbortSignal) {
  const model = config.model || profile.defaultModel
  const response = await fetch(`${requiredBaseUrl(config.baseUrl || profile.defaultBaseUrl).replace(/\/$/, "")}/models/${model}/predictions`, { method: "POST", signal, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", prefer: "wait=60" }, body: JSON.stringify({ input: { prompt: value.prompt, negative_prompt: value.negativePrompt, width: value.width, height: value.height } }) })
  const json = await requireJson(response) as { output?: string | string[]; urls?: { get?: string }; status?: string; error?: string }
  const done = await pollJson(json, json.urls?.get, { authorization: `Bearer ${apiKey}` }, signal)
  const output = Array.isArray(done.output) ? done.output[0] : done.output
  if (!output) throw new Error(typeof done.error === "string" ? done.error : "Replicate returned no image")
  return downloadImage(output, signal)
}

async function requestBfl(profile: (typeof providers)[number], config: Config, apiKey: string, value: { prompt: string; width?: number; height?: number }, signal: AbortSignal) {
  const base = requiredBaseUrl(config.baseUrl || profile.defaultBaseUrl).replace(/\/$/, "")
  const response = await fetch(`${base}/${config.model || profile.defaultModel}`, { method: "POST", signal, headers: { "x-key": apiKey, "content-type": "application/json" }, body: JSON.stringify({ prompt: value.prompt, width: value.width, height: value.height }) })
  const json = await requireJson(response) as { id?: string; polling_url?: string }
  if (!json.id && !json.polling_url) throw new Error("BFL returned no task id")
  const done = await pollJson(json, json.polling_url || `${base}/get_result?id=${encodeURIComponent(json.id!)}`, { "x-key": apiKey }, signal)
  const url = (done as { result?: { sample?: string }; sample?: string }).result?.sample || (done as { sample?: string }).sample
  if (!url) throw new Error("BFL returned no image")
  return downloadImage(url, signal)
}

async function requestGemini(profile: (typeof providers)[number], config: Config, apiKey: string, value: { prompt: string; count?: number }, signal: AbortSignal) {
  const url = `${requiredBaseUrl(config.baseUrl || profile.defaultBaseUrl).replace(/\/$/, "")}/models/${config.model || profile.defaultModel}:predict?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ instances: [{ prompt: value.prompt }], parameters: { sampleCount: value.count ?? 1 } }) })
  const json = await requireJson(response) as { predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] }
  const image = json.predictions?.[0]
  if (!image?.bytesBase64Encoded) throw new Error("Gemini returned no image")
  return { bytes: Buffer.from(image.bytesBase64Encoded, "base64"), mime: image.mimeType || "image/png" }
}

async function requestDashscope(profile: (typeof providers)[number], config: Config, apiKey: string, value: { prompt: string; negativePrompt?: string; width?: number; height?: number; count?: number }, signal: AbortSignal) {
  const base = requiredBaseUrl(config.baseUrl || profile.defaultBaseUrl).replace(/\/$/, "")
  const response = await fetch(`${base}/services/aigc/text2image/image-synthesis`, { method: "POST", signal, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-dashscope-async": "enable" }, body: JSON.stringify({ model: config.model || profile.defaultModel, input: { prompt: value.prompt, negative_prompt: value.negativePrompt }, parameters: { size: `${value.width ?? 1024}*${value.height ?? 1024}`, n: value.count ?? 1 } }) })
  const json = await requireJson(response) as { output?: { task_id?: string } }
  if (!json.output?.task_id) throw new Error("DashScope returned no task id")
  const done = await pollJson(json, `${base}/tasks/${json.output.task_id}`, { authorization: `Bearer ${apiKey}` }, signal)
  const url = (done as { output?: { results?: { url?: string }[] } }).output?.results?.[0]?.url
  if (!url) throw new Error("DashScope returned no image")
  return downloadImage(url, signal)
}

async function requestCustom(config: Config, apiKey: string, value: { prompt: string; negativePrompt?: string; width?: number; height?: number; count?: number }, signal: AbortSignal) {
  const custom = config.custom
  if (!custom?.path) throw new Error("Custom REST provider requires a path")
  const substitutions: Record<string, string> = { prompt: value.prompt, negativePrompt: value.negativePrompt ?? "", width: String(value.width ?? 1024), height: String(value.height ?? 1024), count: String(value.count ?? 1), model: config.model ?? "", apiKey }
  const replace = (text: string) => text.replace(/\{\{(prompt|negativePrompt|width|height|count|model|apiKey)\}\}/g, (_, key: string) => substitutions[key] ?? "")
  const map = (input: unknown): unknown => typeof input === "string" ? replace(input) : Array.isArray(input) ? input.map(map) : input && typeof input === "object" ? Object.fromEntries(Object.entries(input).map(([key, nested]) => [key, map(nested)])) : input
  const response = await fetch(new URL(replace(custom.path), requiredBaseUrl(config.baseUrl)), { method: "POST", signal, headers: { "content-type": "application/json", ...Object.fromEntries(Object.entries(custom.headers ?? {}).map(([key, nested]) => [key, replace(nested)])) }, body: JSON.stringify(map(custom.body ?? { prompt: "{{prompt}}", model: "{{model}}" })) })
  if (!custom.responsePath) return requireImage(response)
  const json = await requireJson(response)
  const output = custom.responsePath.split(".").filter(Boolean).reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, json)
  const valueOut = Array.isArray(output) ? output[0] : output
  if (typeof valueOut !== "string") throw new Error("Custom REST response path did not resolve to an image")
  if (/^https?:\/\//.test(valueOut)) return downloadImage(valueOut, signal)
  return { bytes: Buffer.from(valueOut.replace(/^data:[^;]+;base64,/, ""), "base64"), mime: custom.mime || "image/png" }
}

async function pollJson(initial: unknown, url: string | undefined, headers: Record<string, string>, signal: AbortSignal) {
  let current = initial as Record<string, unknown>
  for (let attempt = 0; attempt < 120; attempt++) {
    const status = String(current.status ?? (current.output as Record<string, unknown> | undefined)?.task_status ?? "").toLowerCase()
    if (["succeeded", "success", "completed"].includes(status) || current.output && !status) return current
    if (["failed", "error", "canceled", "cancelled"].includes(status)) throw new Error(String(current.error ?? "Image generation failed"))
    if (!url) return current
    await new Promise((resolve, reject) => { const timeout = setTimeout(resolve, 1000); signal.addEventListener("abort", () => { clearTimeout(timeout); reject(signal.reason) }, { once: true }) })
    current = await requireJson(await fetch(url, { signal, headers })) as Record<string, unknown>
  }
  throw new Error("Image generation timed out")
}

async function requireJson(response: Response) {
  const text = await response.text()
  if (!response.ok) throw new Error(`Image provider request failed (${response.status}): ${safeError(text)}`)
  try { return JSON.parse(text) as unknown } catch { throw new Error("Image provider returned invalid JSON") }
}

async function requireImage(response: Response) {
  if (!response.ok) throw new Error(`Image provider request failed (${response.status}): ${safeError(await response.text())}`)
  return { bytes: Buffer.from(await response.arrayBuffer()), mime: response.headers.get("content-type")?.split(";")[0] || "image/png" }
}

async function downloadImage(url: string, signal: AbortSignal) {
  return requireImage(await fetch(url, { signal }))
}

function safeError(value: string) {
  return value.replace(/(?:api[_-]?key|authorization|token)\s*[=:]\s*[^,}\s]+/gi, "$1=[redacted]").slice(0, 500)
}

function requiredBaseUrl(value: string | undefined) {
  if (!value) throw new Error("ImageMaker provider requires a base URL")
  const url = new URL(value)
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("ImageMaker base URL must use HTTP or HTTPS")
  return url.toString().replace(/\/$/, "")
}

function combinePrompt(value: { prompt: string; negativePrompt?: string }) {
  return value.negativePrompt ? `${value.prompt}\n\nAvoid: ${value.negativePrompt}` : value.prompt
}

function secretKey(provider: ProviderID) { return `provider-${provider}` }
function extensionFor(mime: string) { return mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png" }

async function readConfig(data: string): Promise<Config> {
  try { return JSON.parse(await readFile(path.join(data, "ui.json"), "utf8")) as Config } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { provider: "openai" }; throw error }
}

async function readGallery(data: string): Promise<GalleryItem[]> {
  try { const value = JSON.parse(await readFile(path.join(data, "gallery.json"), "utf8")); return Array.isArray(value) ? value as GalleryItem[] : [] } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error }
}

async function itemDataUrl(data: string, item: GalleryItem) { return `data:${item.mime};base64,${(await readFile(path.join(data, item.file))).toString("base64")}` }

async function writeJson(target: string, value: unknown) {
  await mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8")
  await rename(temp, target)
}
