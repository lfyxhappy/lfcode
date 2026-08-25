import { describe, expect, test } from "bun:test"
import { isLanAddress, lanCertificateAddressesChanged, lanEndpoints, selectLanAddresses, sortLanAddresses } from "../../src/lan-access"

describe("LAN access network boundary", () => {
  test("accepts loopback and private client addresses only", () => {
    expect(isLanAddress("127.0.0.1")).toBe(true)
    expect(isLanAddress("::ffff:192.168.1.8")).toBe(true)
    expect(isLanAddress("10.0.0.8")).toBe(true)
    expect(isLanAddress("172.20.0.8")).toBe(true)
    expect(isLanAddress("192.168.1.8")).toBe(true)
    expect(isLanAddress("8.8.8.8")).toBe(false)
    expect(isLanAddress("100.64.0.8")).toBe(true)
  })

  test("prefers physical LAN adapters over virtual adapters for QR pairing", () => {
    expect(sortLanAddresses([
      { name: "vEthernet (WSL)", address: "172.22.240.1" },
      { name: "VMware Network Adapter VMnet8", address: "192.168.203.1" },
      { name: "WLAN", address: "10.231.16.206" },
    ])).toEqual(["10.231.16.206", "172.22.240.1", "192.168.203.1"])
    expect(selectLanAddresses([
      { name: "WLAN", address: "10.231.16.206" },
      { name: "utun8", address: "172.31.233.184" },
      { name: "VMware Network Adapter VMnet8", address: "192.168.203.1" },
    ])).toEqual(["10.231.16.206"])
  })

  test("detects certificate address drift without publishing the new address as valid", () => {
    expect(lanCertificateAddressesChanged(["192.168.1.8"], ["192.168.1.8"])).toBe(false)
    expect(lanCertificateAddressesChanged(["192.168.1.8"], ["192.168.1.9"])).toBe(true)
    expect(lanCertificateAddressesChanged(undefined, ["192.168.1.8"])).toBe(true)
    expect(lanEndpoints(43173, ["192.168.1.9"])).toEqual(["https://192.168.1.9:43173"])
  })
})
