import path from "path"
import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "@/project/instance"
import { Project } from "@/project"
import z from "zod"
import { ProjectID } from "@/project/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { InstanceBootstrap } from "@/project/bootstrap"
import { AppRuntime } from "@/effect/app-runtime"
import { Global } from "@/global"
import { AppFileSystem } from "@/filesystem"
import { jsonRequest, runRequest } from "./trace"

export const ProjectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all projects",
        description: "Get a list of projects that have been opened with Lfcode.",
        operationId: "project.list",
        responses: {
          200: {
            description: "List of projects",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const projects = Project.list()
        return c.json(projects)
      },
    )
    .get(
      "/current",
      describeRoute({
        summary: "Get current project",
        description: "Retrieve the currently active project that Lfcode is working with.",
        operationId: "project.current",
        responses: {
          200: {
            description: "Current project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Instance.project)
      },
    )
    .post(
      "/managed",
      describeRoute({
        summary: "Create managed project",
        description: "Create or retrieve a non-Git project owned by a plugin extension.",
        operationId: "project.createManaged",
        responses: {
          200: {
            description: "Managed project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Project.CreateManagedInput),
      async (c) =>
        jsonRequest("ProjectRoutes.createManaged", c, function* () {
          const svc = yield* Project.Service
          return yield* svc.createManagedProject(c.req.valid("json"))
        }),
    )
    .get(
      "/managed/:pluginID/:type",
      describeRoute({
        summary: "Get managed project",
        description: "Get the non-Git project owned by a plugin extension.",
        operationId: "project.getManaged",
        responses: {
          200: {
            description: "Managed project information, when it exists",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod.nullable()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", Project.ProjectExtension.zod),
      async (c) =>
        jsonRequest("ProjectRoutes.getManaged", c, function* () {
          const svc = yield* Project.Service
          return yield* svc.getManagedProject(c.req.valid("param"))
        }),
    )
    .delete(
      "/managed/:pluginID/:type",
      describeRoute({
        summary: "Remove managed project",
        description: "Remove a plugin-owned project record and its cascaded Lfcode session data.",
        operationId: "project.removeManaged",
        responses: {
          200: {
            description: "Whether a project record was removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", Project.ProjectExtension.zod),
      async (c) =>
        jsonRequest("ProjectRoutes.removeManaged", c, function* () {
          const svc = yield* Project.Service
          return yield* svc.removeManagedProject(c.req.valid("param"))
        }),
    )
    .delete(
      "/:projectID/snapshot",
      describeRoute({
        summary: "Delete project snapshots",
        description: "Delete all stored snapshot data for a project without touching the real project files.",
        operationId: "project.deleteSnapshot",
        responses: {
          200: {
            description: "Project snapshots deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      async (c) =>
        jsonRequest("ProjectRoutes.deleteSnapshot", c, function* () {
          const projectID = c.req.valid("param").projectID
          if (projectID === ProjectID.global) return true

          const fs = yield* AppFileSystem.Service
          const root = path.resolve(Global.Path.data, "snapshot")
          const target = path.resolve(root, projectID)

          // Route params are untrusted; keep deletion scoped to the snapshot root.
          if (target === root || !target.startsWith(`${root}${path.sep}`)) {
            throw new Error("Invalid project ID")
          }
          if (!(yield* fs.existsSafe(target))) return true

          yield* fs.remove(target, { recursive: true })
          return true
        }),
    )
    .post(
      "/git/init",
      describeRoute({
        summary: "Initialize git repository",
        description: "Create a git repository for the current project and return the refreshed project info.",
        operationId: "project.initGit",
        responses: {
          200: {
            description: "Project information after git initialization",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        const dir = Instance.directory
        const prev = Instance.project
        const next = await runRequest(
          "ProjectRoutes.initGit",
          c,
          Project.Service.use((svc) => svc.initGit({ directory: dir, project: prev })),
        )
        if (next.id === prev.id && next.vcs === prev.vcs && next.worktree === prev.worktree) return c.json(next)
        await Instance.reload({
          directory: dir,
          worktree: dir,
          project: next,
          init: () => AppRuntime.runPromise(InstanceBootstrap),
        })
        return c.json(next)
      },
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info.zod),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      validator("json", Project.UpdateInput.omit({ projectID: true })),
      async (c) =>
        jsonRequest("ProjectRoutes.update", c, function* () {
          const projectID = c.req.valid("param").projectID
          const body = c.req.valid("json")
          const svc = yield* Project.Service
          return yield* svc.update({ ...body, projectID })
        }),
    ),
)

