export function isMemoryLimitMessage(
  showMemoryLimit: boolean,
  lastMemoryId: string | undefined,
  messageId: string | undefined,
): boolean {
  return showMemoryLimit && lastMemoryId !== undefined && messageId === lastMemoryId
}
