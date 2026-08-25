export function isUpdaterEnabled(input: { isPackaged: boolean; preRelease: boolean }) {
  return input.isPackaged && !input.preRelease
}
