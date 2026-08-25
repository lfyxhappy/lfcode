/**
 * Pure routing rules for CodeGraph. Keeping this separate from MCP/session
 * effects makes the decision deterministic and easy to test.
 */

export type CodegraphTaskKind = "structured-code" | "ordinary"

const STRUCTURED_PATTERNS = [
  /架构|架构图|模块关系|依赖关系|依赖|设计结构|代码结构|architecture|architectural|module\s+(relationship|structure|dependency)/i,
  /调用链|调用关系|调用方|调用者|被谁调用|被调用|call\s*graph|call\s*chain|callers?|callees?|who\s+calls/i,
  /依赖图|依赖分析|dependency|dependencies|dependents?|import\s+graph/i,
  /影响面|影响范围|受影响|impact\s*(analysis|surface)?/i,
  /重构|重整|迁移(代码|模块)|拆分模块|抽象模块|refactor|rewrite\s+the/i,
  /符号|符号引用|定义在哪里|引用在哪里|引用关系|实现在哪里|使用点|跳转到|定位(函数|类|方法|文件)|symbol|definition|references?|usages?|where\s+is\s+.+\s+(defined|implemented|referenced)/i,
  /debug|调试|排查(代码|问题)|根因|bug|故障定位|trace\s+the/i,
  /code\s*graph|codegraph|代码图|图分析/i,
] as const

const EXCLUDED_PATTERNS = [
  /日志|log\b|日志文件|运行日志|错误日志/i,
  /配置|config(?:uration)?\b|jsonc?|yaml|toml|env\b/i,
  /文档|README|markdown|md\b|说明文档/i,
  /生成物|构建产物|dist\b|build\b|产物/i,
  /精确(文本|字符串)?搜索|全文搜索|grep\b|ripgrep|查找字符串|搜索关键字/i,
] as const

export function classifyCodegraphTask(text: string): CodegraphTaskKind {
  const normalized = text.trim()
  if (!normalized) return "ordinary"
  if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(normalized))) return "ordinary"
  return STRUCTURED_PATTERNS.some((pattern) => pattern.test(normalized)) ? "structured-code" : "ordinary"
}

export function shouldUseCodegraph(text: string) {
  return classifyCodegraphTask(text) === "structured-code"
}
