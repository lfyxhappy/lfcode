import { describe, expect, test } from "bun:test"
import { toPartialRow } from "../../src/session/projectors"

describe("session projectors", () => {
  test("includes last user activity updates in partial rows", () => {
    expect(toPartialRow({ time: { lastUser: 123 } })).toMatchObject({
      time_last_user: 123,
    })
    expect(toPartialRow({ time: { lastUser: null } })).toMatchObject({
      time_last_user: null,
    })
  })
})
