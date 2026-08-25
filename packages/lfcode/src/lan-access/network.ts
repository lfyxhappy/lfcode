import { networkInterfaces } from "node:os"

export function isLanAddress(address: string | undefined) {
  if (!address) return false
  const normalized = address.replace(/^::ffff:/, "")
  if (normalized === "127.0.0.1" || normalized === "::1") return true
  if (normalized.startsWith("10.")) return true
  if (normalized.startsWith("192.168.")) return true
  const [first, second] = normalized.split(".").map(Number)
  if (first === 172 && second >= 16 && second <= 31) return true
  // 节点小宝等组网工具会用 CGNAT 段作为可信 overlay 地址。
  if (first === 100 && second >= 64 && second <= 127) return true
  return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")
}

export function lanEndpoints(port: number, addresses = lanAddresses()) {
  return addresses.map((address) => `https://${address}:${port}`)
}

export function lanCertificateAddressesChanged(previous: readonly string[] | undefined, current: readonly string[]) {
  if (!previous || previous.length !== current.length) return true
  return previous.some((address) => !current.includes(address))
}

export function lanAddresses() {
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, items]) =>
      (items ?? [])
        .filter((item) => item.family === "IPv4" && !item.internal && isLanAddress(item.address))
        .map((item) => ({ name, address: item.address })),
  )
  return selectLanAddresses(addresses)
}

export function selectLanAddresses(input: Array<{ name: string; address: string }>) {
  const physicalAddresses = input.filter((item) => interfacePriority(item.name) > 0)
  return sortLanAddresses(physicalAddresses.length > 0 ? physicalAddresses : input)
}

export function sortLanAddresses(input: Array<{ name: string; address: string }>) {
  return [...input]
    .sort((left, right) => interfacePriority(right.name) - interfacePriority(left.name) || left.address.localeCompare(right.address))
    .map((item) => item.address)
    .filter((address, index, addresses) => addresses.indexOf(address) === index)
}

function interfacePriority(name: string) {
  if (/(virtual|vmware|hyper-v|vethernet|wsl|docker|tailscale|zerotier|nodebaby|utun\d*|wireguard|vpn|tap(?:-windows)?|tun\d*|wg\d*)/i.test(name)) return 0
  if (/(wlan|wi-?fi|wireless|ethernet|以太网)/i.test(name)) return 2
  return 1
}
