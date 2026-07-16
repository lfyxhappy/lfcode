function normalizeToolNameKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function parseObjectInput(input: unknown) {
  if (!input) return {}
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return isRecord(input) ? input : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function serializeToolInput(input: unknown) {
  if (typeof input === "string") return input
  return JSON.stringify(input)
}

function wrapTaskOperation(action: string, input: unknown) {
  const parsed = parseObjectInput(input)
  if (isRecord(parsed.operation)) return parsed
  const { operation: _operation, action: _action, ...rest } = parsed
  return {
    operation: {
      action,
      ...rest,
    },
  }
}

function wrapOperation(action: string, input: unknown) {
  const parsed = parseObjectInput(input)
  if (typeof parsed.operation === "string") return parsed
  const { operation: _operation, ...rest } = parsed
  return {
    operation: action,
    ...rest,
  }
}

function normalizeQuestionInput(input: unknown) {
  const parsed = parseObjectInput(input)
  if (Array.isArray(parsed.questions)) return parsed
  if (typeof parsed.question !== "string" || typeof parsed.header !== "string" || !Array.isArray(parsed.options))
    return parsed
  return {
    questions: [
      {
        question: parsed.question,
        header: parsed.header,
        options: parsed.options,
        ...(typeof parsed.multiple === "boolean" ? { multiple: parsed.multiple } : {}),
      },
    ],
  }
}

function resolveShellAliasTarget(activeTools: ReadonlyArray<string>) {
  if (activeTools.includes("shell")) return "shell"
  if (activeTools.includes("bash")) return "bash"
}

function resolveToolAlias(requestedToolName: string, input: unknown, activeTools: ReadonlyArray<string>) {
  const key = normalizeToolNameKey(requestedToolName)
  const task = key.match(/^task_(create|list|get|start|block|unblock|done|abandon|rename)(?:_op)?$/)
  if (task) {
    return {
      toolName: "task",
      input: wrapTaskOperation(task[1], input),
      reason: `legacy task alias ${requestedToolName}`,
    }
  }

  const workflow = key.match(/^workflow_(run|status|wait|cancel|resume)(?:_op)?$/)
  if (workflow) {
    return {
      toolName: "workflow",
      input: wrapOperation(workflow[1], input),
      reason: `legacy workflow alias ${requestedToolName}`,
    }
  }

  const history = key.match(/^history_(search|around|session)(?:_op)?$/)
  if (history) {
    return {
      toolName: "history",
      input: wrapOperation(history[1], input),
      reason: `legacy history alias ${requestedToolName}`,
    }
  }

  if (key === "question_ask" || key === "question_ask_op" || key === "question_prompt" || key === "question_prompt_op")
    return {
      toolName: "question",
      input: normalizeQuestionInput(input),
      reason: `legacy question alias ${requestedToolName}`,
    }

  if (key === "goal_create" || key === "goal_create_op" || key === "create_goal_op")
    return {
      toolName: "create_goal",
      input: parseObjectInput(input),
      reason: `legacy goal alias ${requestedToolName}`,
    }

  if (key === "goal_get" || key === "goal_get_op" || key === "get_goal_op")
    return {
      toolName: "get_goal",
      input: {},
      reason: `legacy goal alias ${requestedToolName}`,
    }

  if (key === "goal_update" || key === "goal_update_op" || key === "update_goal_op")
    return {
      toolName: "update_goal",
      input: parseObjectInput(input),
      reason: `legacy goal alias ${requestedToolName}`,
    }

  if (key === "plan_exit_op")
    return {
      toolName: "plan_exit",
      input: {},
      reason: `legacy plan alias ${requestedToolName}`,
    }

  if (key === "compose_enter_op")
    return {
      toolName: "compose_enter",
      input: parseObjectInput(input),
      reason: `legacy compose alias ${requestedToolName}`,
    }

  if (key === "pwsh" || key === "powershell" || key === "shell" || key === "terminal" || key === "bash") {
    const shellTool = resolveShellAliasTarget(activeTools)
    if (!shellTool) return
    return {
      toolName: shellTool,
      input: parseObjectInput(input),
      reason: `shell alias ${requestedToolName}`,
    }
  }

  return
}

function listAvailableTools(activeTools: ReadonlyArray<string>) {
  return activeTools.length ? activeTools.join(", ") : "(none)"
}

function describeEditingToolFallback(activeTools: ReadonlyArray<string>) {
  const suggestions: string[] = []
  if (activeTools.includes("replace_range"))
    suggestions.push('use "replace_range" when you know the exact line/character span to change')
  if (activeTools.includes("symbol_edit"))
    suggestions.push('use "symbol_edit" when replacing a whole function, class, or method')
  if (activeTools.includes("apply_patch"))
    suggestions.push(
      'use "apply_patch" only with pure patch text wrapped in "*** Begin Patch" and "*** End Patch" (no explanation text outside the patch)',
    )
  if (suggestions.length === 0) return
  return `This turn uses patch-first editing; do not call legacy write/edit tools. Instead, ${suggestions.join("; ")}.`
}

function describeSearchToolFallback(requestedToolName: string, activeTools: ReadonlyArray<string>) {
  if (!activeTools.includes("search")) return
  if (normalizeToolNameKey(requestedToolName) === "glob") {
    return 'Use "search" with {"kind":"path","query":"..."} for file discovery.'
  }
  if (normalizeToolNameKey(requestedToolName) === "grep") {
    return 'Use "search" with {"kind":"content","query":"..."} for content search.'
  }
}

export function findAvailableToolByNormalizedName(activeTools: ReadonlyArray<string>, requestedToolName: string) {
  const requested = normalizeToolNameKey(requestedToolName)
  return activeTools.find((toolName) => normalizeToolNameKey(toolName) === requested)
}

export function describeUnavailableTool(requestedToolName: string, activeTools: ReadonlyArray<string>) {
  const base = `Tool "${requestedToolName}" is not available in this turn. Available tools: ${listAvailableTools(activeTools)}`
  const requested = normalizeToolNameKey(requestedToolName)
  if (requested === "write" || requested === "edit") {
    const fallback = describeEditingToolFallback(activeTools)
    if (fallback) return `${base} ${fallback}`
  }
  if (requested === "glob" || requested === "grep") {
    const fallback = describeSearchToolFallback(requestedToolName, activeTools)
    if (fallback) return `${base} ${fallback}`
  }
  return base
}

export function repairToolCallAlias(input: {
  requestedToolName: string
  toolInput: unknown
  activeTools: ReadonlyArray<string>
}) {
  const requested = normalizeToolNameKey(input.requestedToolName)
  if ((requested === "glob" || requested === "grep") && input.activeTools.includes("search")) {
    const parsed = parseObjectInput(input.toolInput)
    const rawPath =
      typeof parsed.path === "string"
        ? parsed.path
        : typeof parsed.cwd === "string"
          ? parsed.cwd
          : undefined
    const rawInclude =
      typeof parsed.include === "string"
        ? parsed.include
        : typeof parsed.pattern === "string"
          ? parsed.pattern
          : typeof parsed.glob === "string"
            ? parsed.glob
            : undefined
    const rawLimit =
      typeof parsed.limit === "number"
        ? parsed.limit
        : typeof parsed.max_results === "number"
          ? parsed.max_results
          : undefined
    const rawQuery =
      requested === "glob"
        ? typeof parsed.pattern === "string"
          ? parsed.pattern
          : typeof parsed.query === "string"
            ? parsed.query
            : undefined
        : typeof parsed.pattern === "string"
          ? parsed.pattern
          : typeof parsed.query === "string"
            ? parsed.query
            : undefined
    if (!rawQuery) return
    return {
      type: "repair" as const,
      toolName: "search",
      reason: `legacy ${requested} tool replaced by unified search`,
      input: serializeToolInput({
        kind: requested === "glob" ? "path" : "content",
        query: rawQuery,
        ...(rawPath ? { path: rawPath } : {}),
        ...(rawInclude ? { include: rawInclude } : {}),
        ...(typeof rawLimit === "number" ? { limit: rawLimit } : {}),
      }),
    }
  }
  const alias = resolveToolAlias(input.requestedToolName, input.toolInput, input.activeTools)
  if (!alias) return
  if (!input.activeTools.includes(alias.toolName)) {
    return {
      type: "unavailable" as const,
      toolName: alias.toolName,
      reason: alias.reason,
      input: serializeToolInput(alias.input),
      error: `Tool alias "${input.requestedToolName}" maps to "${alias.toolName}", but "${alias.toolName}" is not available in this turn. Available tools: ${listAvailableTools(input.activeTools)}`,
    }
  }
  return {
    type: "repair" as const,
    toolName: alias.toolName,
    reason: alias.reason,
    input: serializeToolInput(alias.input),
  }
}
