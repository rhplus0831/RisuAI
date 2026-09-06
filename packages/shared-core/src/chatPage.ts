/** Normalize a selected chat index without depending on either runtime's character model. */
export function normalizeChatPageIndex(value: unknown, chatCount: number): number {
  if (!Number.isInteger(value)) return chatCount > 0 ? 0 : -1
  if ((value as number) >= chatCount) return chatCount > 0 ? chatCount - 1 : -1
  if ((value as number) < -1) return chatCount > 0 ? 0 : -1
  return value as number
}
