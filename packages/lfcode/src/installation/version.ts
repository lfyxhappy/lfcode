declare global {
  const LFCODE_VERSION: string
  const LFCODE_CHANNEL: string
}

export const InstallationVersion = typeof LFCODE_VERSION === "string" ? LFCODE_VERSION : "local"
export const InstallationChannel = typeof LFCODE_CHANNEL === "string" ? LFCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
