import { describe, expect, test } from "bun:test"
import { PLUGIN_ACTIVATIONS, PLUGIN_CATEGORIES, PLUGIN_SOURCE_TYPES, readLfcodePluginManifest } from "./manifest.js"

describe("plugin manifest library fields", () => {
  test("reads category and authoring metadata", () => {
    expect(
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          id: "demo.tool",
          name: "Demo Tool",
          version: "1.2.3",
          description: "A demo tool plugin",
          category: "tool",
          entrypoints: { location: "./index.ts" },
        },
        "demo",
      ),
    ).toMatchObject({
      id: "demo.tool",
      version: "1.2.3",
      description: "A demo tool plugin",
      category: "tool",
    })
  })

  test("rejects unknown categories", () => {
    expect(() => readLfcodePluginManifest({ apiVersion: 2, category: "other", entrypoints: {} }, "demo")).toThrow(
      "invalid lfcode.category",
    )
  })

  test("exports the stable category and source vocabularies", () => {
    expect(PLUGIN_CATEGORIES).toEqual(["tool", "provider", "integration", "ui", "theme", "runtime", "mixed"])
    expect(PLUGIN_ACTIVATIONS).toEqual(["startup", "model"])
    expect(PLUGIN_SOURCE_TYPES).toEqual(["npm", "directory", "zip", "generated", "bundled", "internal"])
  })

  test("reads model-activated runtime manifests without an executable entrypoint", () => {
    expect(readLfcodePluginManifest({ apiVersion: 2, id: "runtime-python", entrypoints: {}, activation: "model" }, "demo"))
      .toMatchObject({ id: "runtime-python", activation: "model" })
  })

  test("reads opt-in local data storage", () => {
    expect(
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          entrypoints: {},
          storage: { data: true },
        },
        "demo",
      )?.storage,
    ).toEqual({ data: true })
  })

  test("rejects invalid local data storage", () => {
    expect(() => readLfcodePluginManifest({ apiVersion: 2, entrypoints: {}, storage: { data: "yes" } }, "demo")).toThrow(
      "invalid lfcode.storage",
    )
  })

  test("reads plugin-owned bundled Skills without treating them as dependencies", () => {
    expect(
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          entrypoints: {},
          bundledSkills: [{ id: "tavern-management", path: "skills/tavern-management/SKILL.md" }],
        },
        "demo",
      )?.bundledSkills,
    ).toEqual([{ id: "tavern-management", path: "skills/tavern-management/SKILL.md" }])
  })

  test("rejects a bundled Skill path outside the plugin package", () => {
    expect(() =>
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          entrypoints: {},
          bundledSkills: [{ id: "outside", path: "../outside/SKILL.md" }],
        },
        "demo",
      ),
    ).toThrow("invalid lfcode.bundledSkills[].path")
  })

  test("reads a managed project rooted in plugin private data", () => {
    expect(
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          id: "lfcode-tavern",
          entrypoints: { location: "./index.ts" },
          managedProject: { type: "tavern", name: "酒馆", worktree: "projects/tavern" },
        },
        "demo",
      )?.managedProject,
    ).toEqual({ type: "tavern", name: "酒馆", worktree: "projects/tavern" })
  })

  test("rejects a managed project outside plugin private data", () => {
    expect(() =>
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          entrypoints: {},
          managedProject: { type: "tavern", worktree: "../outside" },
        },
        "demo",
      ),
    ).toThrow("invalid lfcode.managedProject.worktree")
  })

  test("reads a managed session launcher without allowing a foreign plugin id", () => {
    expect(
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          id: "lfcode-tavern",
          entrypoints: { location: "./index.ts" },
          uiContributions: [
            {
              slot: "desktop-settings-panel",
              managedSession: { type: "tavern", title: "酒馆对话", label: "进入酒馆" },
            },
          ],
        },
        "demo",
      )?.uiContributions,
    ).toEqual([
      {
        slot: "desktop-settings-panel",
        managedSession: { type: "tavern", title: "酒馆对话", label: "进入酒馆" },
      },
    ])
  })

  test("reads a declarative session composer replacement", () => {
    expect(
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          entrypoints: {},
          uiContributions: [
            {
              slot: "desktop-session-composer",
              sessionComposer: {
                type: "tavern",
                mode: "replace",
                renderer: "conversation",
                placeholder: "以角色身份发送消息…",
              },
            },
          ],
        },
        "demo",
      )?.uiContributions,
    ).toEqual([
      {
        slot: "desktop-session-composer",
        sessionComposer: {
          type: "tavern",
          mode: "replace",
          renderer: "conversation",
          placeholder: "以角色身份发送消息…",
        },
      },
    ])
  })

  test("rejects a session composer outside its reserved desktop slot", () => {
    expect(() =>
      readLfcodePluginManifest(
        {
          apiVersion: 2,
          entrypoints: {},
          uiContributions: [
            {
              slot: "desktop-session-toolbar",
              sessionComposer: { type: "tavern", mode: "replace", renderer: "conversation" },
            },
          ],
        },
        "demo",
      ),
    ).toThrow("desktop-session-composer")
  })
})
