import { describe, expect, test } from "bun:test"
import { PLUGIN_CATEGORIES, PLUGIN_SOURCE_TYPES, readLfcodePluginManifest } from "./manifest.js"

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
    expect(PLUGIN_SOURCE_TYPES).toEqual(["npm", "directory", "zip", "generated", "bundled", "internal"])
  })
})
