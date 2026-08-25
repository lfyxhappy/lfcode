import { expect, test } from "bun:test"
import { createDesktopFetch, resetDesktopFetchDiagnostics, snapshotDesktopFetchDiagnostics } from "./desktop-fetch"

test("materializes request init so sidecar authorization is preserved", async () => {
  resetDesktopFetchDiagnostics()
  let received: Request | undefined
  const fetcher: typeof fetch = async (input) => {
    received = new Request(input)
    return new Response(null, { status: 204 })
  }
  const init = { headers: { Authorization: "Basic test" } }

  await createDesktopFetch(fetcher)(new Request("http://localhost?directory=C%3A%2Fworkspace"), init)

  expect(received?.headers.get("authorization")).toBe("Basic test")
  expect(snapshotDesktopFetchDiagnostics().at(-1)).toMatchObject({
    hasAuthorization: true,
    method: "GET",
    path: "/",
    directory: expect.stringMatching(/^directory-\d+$/),
    status: 204,
  })
})

test("uses stable anonymous labels for each directory", async () => {
  resetDesktopFetchDiagnostics()
  const fetcher: typeof fetch = async () => new Response(null, { status: 204 })
  const desktopFetch = createDesktopFetch(fetcher)

  await desktopFetch("http://localhost/session?directory=C%3A%2Fworkspace")
  await desktopFetch("http://localhost/session?directory=C%3A%2Fworkspace")
  await desktopFetch("http://localhost/session?directory=C%3A%2Fother")

  const directories = snapshotDesktopFetchDiagnostics().map((entry) => entry.directory)
  expect(directories).toEqual(["directory-1", "directory-1", "directory-2"])
  expect(JSON.stringify(snapshotDesktopFetchDiagnostics())).not.toContain("C:/workspace")
  expect(JSON.stringify(snapshotDesktopFetchDiagnostics())).not.toContain("C%3A%2Fworkspace")
})
