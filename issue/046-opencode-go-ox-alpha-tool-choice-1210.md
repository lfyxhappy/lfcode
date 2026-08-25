# 问题

OpenCode Go 的 `ox-alpha-free` 在带工具的请求中返回 `APIError: [1210] Invalid API parameter`，导致会话直接失败。预发布日志显示失败请求发往 `https://opencode.ai/zen/go/v1/chat/completions`，请求体包含工具定义和 `tool_choice: "auto"`。

# 原因

OpenCode Go 的该模型端点当前不接受 OpenAI-compatible `tools` 请求体（无论是否带 `tool_choice`）。纯文本请求可以成功，而加入工具定义后触发上游 1210/503。

# 推荐解决方案

按模型名将 `ox-alpha-free` 的 `tool_call` 能力标为 `false`，并在 LLM 请求构造层对 `opencode-go/ox-alpha-free` 完全不发送工具定义和 tool choice。其他供应商、模型以及工具调用行为保持原状。

# 状态

已解决
