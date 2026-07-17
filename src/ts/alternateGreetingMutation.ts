export type AlternateGreetingMutation =
  | { type: 'delete'; index: number }
  | { type: 'swap'; firstIndex: number; secondIndex: number }

export interface ChatGreetingIndex {
  chatId: string
  fmIndex: number
}

export function mutateAlternateGreetings(
  alternateGreetings: readonly string[],
  chats: readonly { id?: string; fmIndex?: number }[],
  operation: AlternateGreetingMutation,
): { alternateGreetings: string[]; chatGreetingIndices: ChatGreetingIndex[] } | null {
  const nextGreetings = [...alternateGreetings]
  if (operation.type === 'delete') {
    if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index >= nextGreetings.length)
      return null
    nextGreetings.splice(operation.index, 1)
  } else {
    const { firstIndex, secondIndex } = operation
    if (
      !Number.isInteger(firstIndex) ||
      !Number.isInteger(secondIndex) ||
      firstIndex < 0 ||
      secondIndex < 0 ||
      firstIndex >= nextGreetings.length ||
      secondIndex >= nextGreetings.length ||
      Math.abs(firstIndex - secondIndex) !== 1
    ) {
      return null
    }
    ;[nextGreetings[firstIndex], nextGreetings[secondIndex]] = [nextGreetings[secondIndex], nextGreetings[firstIndex]]
  }

  const chatGreetingIndices = chats.flatMap((chat) => {
    if (typeof chat.id !== 'string' || chat.id.length === 0) return []
    return [
      {
        chatId: chat.id,
        fmIndex: remapAlternateGreetingIndex(chat.fmIndex, alternateGreetings.length, operation),
      },
    ]
  })
  return { alternateGreetings: nextGreetings, chatGreetingIndices }
}

export function remapAlternateGreetingIndex(
  value: unknown,
  greetingCount: number,
  operation: AlternateGreetingMutation,
): number {
  if (!Number.isInteger(value) || (value as number) < -1 || (value as number) >= greetingCount) return -1
  const index = value as number
  if (index === -1) return -1
  if (operation.type === 'delete') {
    if (index === operation.index) return -1
    return index > operation.index ? index - 1 : index
  }
  if (index === operation.firstIndex) return operation.secondIndex
  if (index === operation.secondIndex) return operation.firstIndex
  return index
}
