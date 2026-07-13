import { describe, expect, test } from "bun:test"
import { parseCodeEditorSnippetFiles } from "./snippets"

describe("code editor snippets", () => {
  test("loads VS Code JSONC snippets for the matching language", () => {
    expect(
      parseCodeEditorSnippetFiles({
        language: "typescript",
        files: [
          {
            path: "C:/Users/liangfeng/.lfcode/snippets/typescript.json",
            content: `{
              // User snippets may contain comments.
              "log": {
                "prefix": ["log", "clog"],
                "body": ["console.log(${"${1:value}"});", "$0"],
                "description": "Log a value"
              }
            }`,
          },
        ],
      }),
    ).toEqual([
      {
        label: "log",
        prefix: "log",
        body: "console.log(${1:value});\n$0",
        description: "Log a value",
      },
      {
        label: "log",
        prefix: "clog",
        body: "console.log(${1:value});\n$0",
        description: "Log a value",
      },
    ])
  })

  test("filters scoped snippets that do not match the editor language", () => {
    expect(
      parseCodeEditorSnippetFiles({
        language: "python",
        files: [
          {
            path: "C:/project/.lfcode/snippets/global.code-snippets",
            content: JSON.stringify({
              reactOnly: {
                scope: "typescriptreact, javascriptreact",
                prefix: "component",
                body: "export function ${1:Component}() {}",
              },
            }),
          },
        ],
      }),
    ).toEqual([])
  })
})
