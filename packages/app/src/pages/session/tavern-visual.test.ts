import { describe, expect, test } from "bun:test"
import {
  normalizeTavernAvatarPath,
  normalizeTavernVisualAsset,
  normalizeTavernVisualAssets,
  normalizeTavernVisualSettings,
} from "./tavern-visual"

const asset = { id: "smile", label: "微笑", path: "visuals/smile.png", mime: "image/png" as const }

describe("Tavern visual assets", () => {
  test("keeps valid plugin-private image assets", () => {
    expect(normalizeTavernVisualAsset(asset)).toEqual(asset)
    expect(normalizeTavernVisualAssets([asset, { ...asset, id: "wave" }])).toHaveLength(2)
    expect(normalizeTavernVisualSettings({ background: asset })).toEqual({ background: asset })
  })

  test("drops paths and media types that cannot be rendered safely", () => {
    expect(normalizeTavernVisualAsset({ ...asset, path: "../portrait.png" })).toBeUndefined()
    expect(normalizeTavernVisualAsset({ ...asset, path: "visuals\\portrait.png" })).toBeUndefined()
    expect(normalizeTavernVisualAsset({ ...asset, mime: "image/svg+xml" })).toBeUndefined()
    expect(normalizeTavernVisualAssets([asset, { ...asset, path: "imports/characters/a.png" }])).toEqual([asset])
  })

  test("accepts only plugin-private character avatar paths", () => {
    expect(normalizeTavernAvatarPath("imports/characters/alice.png")).toBe("imports/characters/alice.png")
    expect(normalizeTavernAvatarPath("characters/alice.png")).toBe("characters/alice.png")
    expect(normalizeTavernAvatarPath("migration-vault/sillytavern/source/characters/alice.png")).toBeUndefined()
    expect(normalizeTavernAvatarPath("characters/../alice.png")).toBeUndefined()
  })
})
