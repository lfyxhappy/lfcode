import { describe, expect, test } from "bun:test"
import { createSingleFlight } from "./single-flight"

describe("createSingleFlight", () => {
  test("reuses the reservation during synchronous re-entry", async () => {
    const flight = createSingleFlight<string, number>()
    let calls = 0
    let nested: Promise<number> | undefined
    const first = flight.run("directory", () => {
      calls += 1
      nested = flight.run("directory", () => {
        calls += 1
        return 2
      })
      return 1
    })

    expect(nested).toBe(first)
    expect(flight.has("directory")).toBe(true)
    await expect(first).resolves.toBe(1)
    expect(calls).toBe(1)
    expect(flight.has("directory")).toBe(false)
  })

  test("cleans up after synchronous task failure", async () => {
    const flight = createSingleFlight<string, void>()
    const result = flight.run("directory", () => {
      throw new Error("bootstrap failed")
    })

    await expect(result).rejects.toThrow("bootstrap failed")
    expect(flight.has("directory")).toBe(false)
  })

  test("cleans up after asynchronous task failure", async () => {
    const flight = createSingleFlight<string, void>()
    const result = flight.run("directory", async () => {
      throw new Error("bootstrap failed")
    })

    await expect(result).rejects.toThrow("bootstrap failed")
    expect(flight.has("directory")).toBe(false)
  })
})
