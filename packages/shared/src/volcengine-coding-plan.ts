export const VOLCENGINE_CODING_PLAN_PRESET_ID = "volcengine-coding-plan"
export const VOLCENGINE_CODING_PLAN_PROVIDER_ID = "volcengine-plan"
export const VOLCENGINE_CODING_PLAN_NAME = "Volcano Engine Coding Plan"
export const VOLCENGINE_CODING_PLAN_BASE_URL = "https://ark.cn-beijing.volces.com/api/coding/v3"
export const VOLCENGINE_CODING_PLAN_ENV = ["ARK_API_KEY", "VOLCENGINE_API_KEY"]
export const VOLCENGINE_CODING_PLAN_OUTPUT_LIMIT = 4_096

export type VolcengineCodingPlanModel = {
  id: string
  context: number
  image: boolean
}

export const VOLCENGINE_CODING_PLAN_MODELS = [
  volcengineModel("ark-code-latest", 256_000, true),
  volcengineModel("doubao-seed-code", 256_000, true),
  volcengineModel("glm-5.2", 1_024_000, false),
  volcengineModel("glm-latest", 1_024_000, false),
  volcengineModel("deepseek-v4-flash", 1_024_000, false),
  volcengineModel("deepseek-v4-pro", 1_024_000, false),
  volcengineModel("doubao-seed-2.0-code", 256_000, true),
  volcengineModel("doubao-seed-2.0-pro", 256_000, true),
  volcengineModel("doubao-seed-2.0-lite", 256_000, true),
  volcengineModel("doubao-seed-2.0-mini", 256_000, true),
  volcengineModel("minimax-m2.7", 200_000, false),
  volcengineModel("minimax-m3", 512_000, true),
  volcengineModel("kimi-k2.6", 256_000, true),
  volcengineModel("kimi-k2.7-code", 256_000, false),
] as const

function volcengineModel(id: string, context: number, image: boolean): VolcengineCodingPlanModel {
  return { id, context, image }
}
