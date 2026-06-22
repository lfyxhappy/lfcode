import { describe, expect, test } from "bun:test"

import { browserCookieRemovalURL } from "./browser-runtime-core"

describe("browser runtime", () => {
  test("uses current https origin when cookie is not secure", () => {
    expect(
      browserCookieRemovalURL(
        {
          secure: false,
          domain: undefined,
          path: "/settings",
        },
        "https://example.com/account",
      ),
    ).toBe("https://example.com/settings")
  })

  test("forces https removal for secure cookies", () => {
    expect(
      browserCookieRemovalURL(
        {
          secure: true,
          domain: ".example.com",
          path: "/",
        },
        "http://example.com/account",
      ),
    ).toBe("https://example.com/")
  })

  test("maps file pages to http for cookie removal", () => {
    expect(
      browserCookieRemovalURL(
        {
          secure: false,
          domain: "localhost",
          path: "/",
        },
        "file:///C:/temp/demo.html",
      ),
    ).toBe("http://localhost/")
  })
})
