import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  collectOpenSessionDeepLinks,
  parseOpenSessionDeepLink,
} from "./deep-links"

describe("layout deep links", () => {
  test("parses open-session deeplink", () => {
    expect(parseOpenSessionDeepLink("lfcode://open-session?directory=C%3A%5Cdemo&sessionID=ses_1")).toEqual({
      directory: "C:\\demo",
      sessionID: "ses_1",
    })
  })

  test("ignores invalid open-session deeplink", () => {
    expect(parseOpenSessionDeepLink("lfcode://open-session?directory=C%3A%5Cdemo")).toBeUndefined()
    expect(parseOpenSessionDeepLink("lfcode://open-project?directory=C%3A%5Cdemo")).toBeUndefined()
  })

  test("collectors keep existing routes and include open-session", () => {
    const urls = [
      "lfcode://open-project?directory=C%3A%5Cproject",
      "lfcode://new-session?directory=C%3A%5Cproject&prompt=hello",
      "lfcode://open-session?directory=C%3A%5Cproject&sessionID=ses_2",
    ]

    expect(collectOpenProjectDeepLinks(urls)).toEqual(["C:\\project"])
    expect(collectNewSessionDeepLinks(urls)).toEqual([{ directory: "C:\\project", prompt: "hello" }])
    expect(collectOpenSessionDeepLinks(urls)).toEqual([{ directory: "C:\\project", sessionID: "ses_2" }])
  })
})
