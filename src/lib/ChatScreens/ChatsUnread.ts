export function didChatOwnerChange(previousChatId: string | null, currentChatId: string | null): boolean {
  return previousChatId !== currentChatId
}
