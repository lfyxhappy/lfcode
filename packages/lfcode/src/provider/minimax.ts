export const MINIMAX_PROVIDER_ID = "minimax"
export const MINIMAX_PROVIDER_NAME = "MiniMax Token Plan"
export const MINIMAX_API_URL = "https://api.minimaxi.com/v1"
export const MINIMAX_API_ENV = ["MINIMAX_API_KEY"] as const
export const MINIMAX_RESPONSES_PROVIDER = {
  npm: "@ai-sdk/openai",
  api: MINIMAX_API_URL,
  protocol: "openai-responses",
} as const

export type MiniMaxModelSpec = {
  id: string
  context: number
  output: number
  image: boolean
  video: boolean
  reasoningOptions?: readonly { readonly type: string; readonly values?: readonly string[] }[]
  provider?: { npm?: string; api?: string; protocol?: "openai-responses" | "anthropic-messages" }
}

export const MINIMAX_MODELS = [
  {
    id: "MiniMax-M3",
    context: 1_000_000,
    output: 128_000,
    image: true,
    video: true,
    reasoningOptions: [{ type: "toggle" }],
    provider: MINIMAX_RESPONSES_PROVIDER,
  },
  {
    id: "MiniMax-M2.7",
    context: 204_800,
    output: 131_072,
    image: false,
    video: false,
    reasoningOptions: [],
    provider: MINIMAX_RESPONSES_PROVIDER,
  },
  {
    id: "MiniMax-M2.7-highspeed",
    context: 204_800,
    output: 131_072,
    image: false,
    video: false,
    reasoningOptions: [],
    provider: MINIMAX_RESPONSES_PROVIDER,
  },
  {
    id: "MiniMax-M2.5",
    context: 204_800,
    output: 131_072,
    image: false,
    video: false,
    reasoningOptions: [],
    provider: MINIMAX_RESPONSES_PROVIDER,
  },
  {
    id: "MiniMax-M2.5-highspeed",
    context: 204_800,
    output: 131_072,
    image: false,
    video: false,
    reasoningOptions: [],
    provider: MINIMAX_RESPONSES_PROVIDER,
  },
] as const satisfies readonly MiniMaxModelSpec[]

const modelIDs = new Map(
  [
    ["MiniMax-M3", "MiniMax-M3"],
    ["MiniMax-M2.7", "MiniMax-M2.7"],
    ["MiniMax-M2.7-highspeed", "MiniMax-M2.7-highspeed"],
    ["MiniMax-M2.7-turbo", "MiniMax-M2.7-highspeed"],
    ["MiniMax-M2.5", "MiniMax-M2.5"],
    ["MiniMax-M2.5-highspeed", "MiniMax-M2.5-highspeed"],
  ].map(([id, target]) => [normalizeModelID(id), target]),
)

export function resolveMiniMaxModelID(modelID: string) {
  return modelIDs.get(normalizeModelID(modelID))
}

export function isMiniMaxResponsesModelID(modelID: string) {
  return resolveMiniMaxModelID(modelID) !== undefined
}

function normalizeModelID(modelID: string) {
  return modelID.toLowerCase().replace(/[^a-z0-9]/g, "")
}
