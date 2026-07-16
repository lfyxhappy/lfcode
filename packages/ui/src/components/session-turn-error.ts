export function isComposeGateReminderMessage(message: string) {
  return message.includes("Compose route requirements are still incomplete after repeated re-entry:")
}
