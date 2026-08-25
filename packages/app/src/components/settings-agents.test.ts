import { afterEach, describe, expect, mock, test } from "bun:test"
import type { AgentManageItem } from "./subagent-api"

mock.module("@solidjs/router", () => ({ useParams: () => ({}) }))
mock.module("@lfcode-ai/ui/button", () => ({ Button: () => null }))
mock.module("@lfcode-ai/ui/switch", () => ({ Switch: () => null }))
mock.module("@lfcode-ai/ui/toast", () => ({ showToast: () => undefined }))
mock.module("@/context/language", () => ({ useLanguage: () => ({ t: (value: string) => value }) }))
mock.module("@/context/server", () => ({ useServer: () => ({}) }))
mock.module("@/utils/base64", () => ({ decode64: () => "" }))
mock.module("@/utils/server-errors", () => ({ formatServerError: () => "" }))
mock.module("./settings-page-shell", () => ({ SettingsPageShell: () => null, SettingsSection: () => null }))

const { DEFAULT_CUSTOM_AGENT_PERMISSION, agentDraftLayer, agentLayerForScope, agentPermissionConfig, agentPermissionText, parseAgentPermission } = await import("./settings-agents")

afterEach(() => {
  mock.restore()
})

describe("agent settings permissions", () => {
  test("starts custom subagents with a read-only, non-delegating policy", () => {
    expect(DEFAULT_CUSTOM_AGENT_PERMISSION).toEqual({
      "*": "deny",
      read: "allow",
      glob: "allow",
      grep: "allow",
      actor: "deny",
    })
  })

  test("preserves wildcard and path-specific rules from an effective ruleset", () => {
    expect(
      agentPermissionConfig([
        { permission: "edit", pattern: "*", action: "ask" },
        { permission: "edit", pattern: "*.md", action: "allow" },
        { permission: "actor", pattern: "*", action: "deny" },
      ]),
    ).toEqual({
      edit: { "*": "ask", "*.md": "allow" },
      actor: "deny",
    })
  })

  test("edits the active override layer without copying a project layer into global", () => {
    const entry = {
      id: "reviewer",
      config: { description: "effective" },
      nativeLayer: {
        config: { description: "native", default_execution: "background", tool_allowlist: ["read"] },
        prompt: "native prompt",
      },
      global: { config: { description: "global" }, prompt: "global prompt" },
      project: { config: { description: "project" }, prompt: "project prompt" },
      effective: { config: { description: "effective" }, prompt: "effective prompt" },
    } satisfies AgentManageItem

    expect(agentLayerForScope(entry, "global")?.config.description).toBe("global")
    expect(agentLayerForScope(entry, "project")?.config.description).toBe("project")
    expect(agentLayerForScope(entry, "project", true)?.config.description).toBe("effective")
    expect(agentDraftLayer(entry, "global")).toEqual({
      config: { description: "global", default_execution: "background", tool_allowlist: ["read"] },
      prompt: "global prompt",
    })
    expect(agentDraftLayer(entry, "project")).toEqual({
      config: { description: "project", default_execution: "background", tool_allowlist: ["read"] },
      prompt: "project prompt",
    })

    const projectOnly = {
      id: "reviewer",
      config: { description: "project effective" },
      project: { config: { description: "project" }, prompt: "project prompt" },
      effective: { config: { description: "project effective" }, prompt: "project effective prompt" },
    } satisfies AgentManageItem

    expect(agentLayerForScope(projectOnly, "global")).toBeUndefined()
    expect(agentDraftLayer(projectOnly, "global")).toBeUndefined()
  })

  test("accepts only serializable permission objects", () => {
    expect(parseAgentPermission('{"*":"deny","read":"allow","edit":{"*.md":"ask"}}')).toEqual({
      "*": "deny",
      read: "allow",
      edit: { "*.md": "ask" },
    })
    expect(parseAgentPermission('{"read":"invalid"}')).toBeUndefined()
    expect(parseAgentPermission("[]")).toBeUndefined()
    expect(agentPermissionConfig("deny")).toEqual({ "*": "deny" })
    expect(agentPermissionText({ read: "allow" })).toBe('{\n  "read": "allow"\n}')
  })
})
