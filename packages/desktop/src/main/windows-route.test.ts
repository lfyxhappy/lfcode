import { describe, expect, test } from "bun:test"
import { appRouteFromRendererNavigation } from "./renderer-route"

describe("renderer route recovery", () => {
  test("converts a renderer-path navigation back to an app route", () => {
    expect(appRouteFromRendererNavigation("oc://renderer/project/session/ses_1")).toBe("/project/session/ses_1")
  })

  test("preserves route query and fragment during recovery", () => {
    expect(appRouteFromRendererNavigation("oc://renderer/project/session/ses_1?view=plan#message_1")).toBe(
      "/project/session/ses_1?view=plan#message_1",
    )
  })

  test("recovers an empty renderer path to the app root", () => {
    expect(appRouteFromRendererNavigation("oc://renderer")).toBe("/")
  })

  test("leaves normal index-document hash navigation untouched", () => {
    expect(appRouteFromRendererNavigation("oc://renderer/index.html#/project/session/ses_1")).toBeUndefined()
    expect(appRouteFromRendererNavigation("oc://renderer/loading.html#/project/session/ses_1")).toBeUndefined()
  })

  test("does not recover external URLs", () => {
    expect(appRouteFromRendererNavigation("https://example.com")).toBeUndefined()
  })
})
