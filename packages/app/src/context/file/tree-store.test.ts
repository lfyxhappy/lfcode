import { describe, expect, test } from "bun:test"
import { createFileTreeStore } from "./tree-store"

describe("reference tree store isolation", () => {
  test("keeps external absolute nodes and project nodes in separate stores", async () => {
    const project = createFileTreeStore({
      scope: () => "project",
      normalizeDir: (input) => input,
      list: async () => [
        { name: "src", path: "src", absolute: "C:\\project\\src", type: "directory", ignored: false },
      ],
      onError: () => undefined,
    })
    const reference = createFileTreeStore({
      scope: () => "C:\\outside",
      normalizeDir: (input) => input,
      list: async (input) => [
        {
          name: "notes.txt",
          path: input + "\\notes.txt",
          absolute: input + "\\notes.txt",
          type: "file",
          ignored: false,
        },
      ],
      onError: () => undefined,
    })

    await project.listDir("")
    await reference.listDir("C:\\outside")

    expect(project.children("").map((node) => node.path)).toEqual(["src"])
    expect(reference.children("C:\\outside").map((node) => node.path)).toEqual(["C:\\outside\\notes.txt"])
    expect(project.children("C:\\outside")).toEqual([])
    expect(reference.children("")).toEqual([])
  })
})
