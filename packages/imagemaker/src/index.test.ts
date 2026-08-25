import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import plugin from "./index"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("ImageMaker plugin", () => {
  test("keeps API keys out of ui.json", async () => {
    const fixture = await createFixture()
    try {
      const hooks = await plugin.server(fixture.input as never)
      await hooks.action!.configure.execute({ provider: "openai", apiKey: "top-secret", model: "gpt-image-1" } as never)

      expect(await fixture.secrets.get("provider-openai")).toBe("top-secret")
      expect(await readFile(path.join(fixture.data, "ui.json"), "utf8")).not.toContain("top-secret")
    } finally {
      await rm(fixture.data, { recursive: true, force: true })
    }
  })

  test("returns an image attachment and stores gallery metadata", async () => {
    const fixture = await createFixture()
    globalThis.fetch = Object.assign(
      async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } }),
      originalFetch,
    )
    try {
      fixture.secrets.set("provider-openai", "top-secret")
      const hooks = await plugin.server(fixture.input as never)
      const result = await hooks.tool!.imagemaker_generate.execute({ prompt: "a blue mountain" }, { abort: new AbortController().signal } as never)

      expect(typeof result).toBe("object")
      if (typeof result === "string") throw new Error("Expected structured tool result")
      expect(result.attachments?.[0]?.mime).toBe("image/png")
      expect(result.attachments?.[0]?.url).toStartWith("data:image/png;base64,")
      const gallery = JSON.parse(await readFile(path.join(fixture.data, "gallery.json"), "utf8")) as { prompt: string }[]
      expect(gallery[0]?.prompt).toBe("a blue mountain")
    } finally {
      await rm(fixture.data, { recursive: true, force: true })
    }
  })

  test("returns a directly usable gallery image through the synchronous action", async () => {
    const fixture = await createFixture()
    globalThis.fetch = Object.assign(
      async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } }),
      originalFetch,
    )
    try {
      fixture.secrets.set("provider-openai", "top-secret")
      const hooks = await plugin.server(fixture.input as never)
      const result = await hooks.action!.generateImmediate.execute({ prompt: "a tavern scene" } as never)

      expect(result.item.mime).toBe("image/png")
      expect(result.item.url).toStartWith("data:image/png;base64,")
      expect(result.item.prompt).toBe("a tavern scene")
    } finally {
      await rm(fixture.data, { recursive: true, force: true })
    }
  })

  test("edits a generated gallery image and returns the edited attachment", async () => {
    const fixture = await createFixture()
    globalThis.fetch = Object.assign(
      async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("edited-image").toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } }),
      originalFetch,
    )
    try {
      fixture.secrets.set("provider-openai", "top-secret")
      const hooks = await plugin.server(fixture.input as never)
      const generated = await hooks.action!.generateImmediate.execute({ prompt: "a blue mountain" } as never)
      const result = await hooks.tool!.imagemaker_edit.execute(
        { image_id: generated.item.id, prompt: "make it snowy" },
        { abort: new AbortController().signal } as never,
      )

      expect(typeof result).toBe("object")
      if (typeof result === "string") throw new Error("Expected structured tool result")
      expect(result.attachments?.[0]?.url).toStartWith("data:image/png;base64,")
      const gallery = JSON.parse(await readFile(path.join(fixture.data, "gallery.json"), "utf8")) as { prompt: string }[]
      expect(gallery[0]?.prompt).toBe("make it snowy")
    } finally {
      await rm(fixture.data, { recursive: true, force: true })
    }
  })
})

async function createFixture() {
  const data = await mkdtemp(path.join(os.tmpdir(), "lfcode-imagemaker-"))
  const secrets = new Map<string, string>()
  return {
    data,
    secrets,
    input: {
      data,
      secureStorage: {
        status: () => "available" as const,
        get: async (key: string) => secrets.get(key),
        set: async (key: string, value: string) => { secrets.set(key, value) },
        remove: async (key: string) => { secrets.delete(key) },
      },
    },
  }
}
