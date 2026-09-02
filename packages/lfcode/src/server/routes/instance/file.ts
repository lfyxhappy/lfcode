import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { Flag } from "@/flag/flag"
import { LSP } from "@/lsp"
import { Instance } from "@/project/instance"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(Ripgrep.Match.shape.data.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("FileRoutes.findText", c, function* () {
          const pattern = c.req.valid("query").pattern
          const svc = yield* Ripgrep.Service
          const result = yield* svc.search({ cwd: Instance.directory, pattern, limit: 10 })
          return result.items
        }),
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) =>
        jsonRequest("FileRoutes.findFile", c, function* () {
          const query = c.req.valid("query")
          const svc = yield* File.Service
          return yield* svc.search({
            query: query.query,
            limit: query.limit ?? 10,
            dirs: query.dirs !== "false",
            type: query.type,
          })
        }),
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("FileRoutes.findSymbol", c, function* () {
          const lsp = yield* LSP.Service
          return yield* lsp.workspaceSymbol(c.req.valid("query").query)
        }),
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("FileRoutes.list", c, function* () {
          const svc = yield* File.Service
          return yield* svc.list(c.req.valid("query").path)
        }),
    )
    .get(
      "/file/reference-tree",
      describeRoute({
        summary: "List reference directory",
        description:
          "List the direct children of an authenticated absolute directory. The optional compatibility token is ignored.",
        operationId: "file.referenceTree",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
          token: z.string().optional(),
        }),
      ),
      async (c) =>
        jsonRequest("FileRoutes.listReferenceTree", c, function* () {
          const svc = yield* File.Service
          return yield* svc.listReferenceDirectory(c.req.valid("query"))
        }),
    )
    .post(
      "/file/reference-grant",
      describeRoute({
        summary: "Grant desktop reference directory (compatibility)",
        description:
          "Create a short-lived compatibility grant for a desktop user-selected reference directory. File access no longer requires this grant.",
        operationId: "file.referenceGrant",
        responses: {
          200: {
            description: "Reference directory grant",
            content: {
              "application/json": {
                schema: resolver(File.ReferenceGrant),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        if (Flag.LFCODE_CLIENT !== "desktop" || Flag.LFCODE_WORKSPACE_ID) return c.json({ error: "desktop only" }, 403)
        return jsonRequest("FileRoutes.grantReferenceDirectory", c, function* () {
          const svc = yield* File.Service
          return yield* svc.grantReferenceDirectory(c.req.valid("json").path)
        })
      },
    )
    .get(
      "/file/stat",
      describeRoute({
        summary: "Get file reference state",
        description: "Check whether a local file reference exists and whether it is a file or directory without reading its content.",
        operationId: "file.stat",
        responses: {
          200: {
            description: "File reference state",
            content: {
              "application/json": {
                schema: resolver(File.Reference),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) =>
        jsonRequest("FileRoutes.stat", c, function* () {
          const svc = yield* File.Service
          return yield* svc.stat(c.req.valid("query").path)
        }),
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
          with_diff: z.enum(["true", "false"]).optional(),
          reference_token: z.string().optional(),
        }),
      ),
      async (c) =>
        jsonRequest("FileRoutes.read", c, function* () {
          const svc = yield* File.Service
          const query = c.req.valid("query")
          return yield* svc.read(query.path, {
            withDiff: query.with_diff === "true",
            referenceToken: query.reference_token,
          })
        }),
    )
    .post(
      "/file/content",
      describeRoute({
        summary: "Write file",
        description: "Write text content to a specified file, optionally enforcing an expected checksum.",
        operationId: "file.write",
        responses: {
          200: {
            description: "Updated file content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          content: z.string(),
          expectedChecksum: z.string().optional(),
          createParents: z.boolean().optional(),
        }),
      ),
      async (c) =>
        jsonRequest("FileRoutes.write", c, function* () {
          const svc = yield* File.Service
          const body = c.req.valid("json")
          return yield* svc.write({
            path: body.path,
            content: body.content,
            expectedChecksum: body.expectedChecksum,
            createParents: body.createParents,
          })
        }),
    )
)
