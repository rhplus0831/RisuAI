import type { character } from 'src/ts/storage/database.svelte'

/** One metadata projection shared by pinned shortcuts and all status badges. */
export function createSidebarChatProjection(readRows: () => readonly character[], isValid: () => boolean) {
  const rows = $derived.by(() => {
    if (!isValid()) return []
    const source = readRows()
    const counts = new Map<string, number>()
    for (const character of source) {
      for (const chat of character.chats ?? []) {
        if (typeof chat?.id === 'string' && chat.id.trim()) counts.set(chat.id, (counts.get(chat.id) ?? 0) + 1)
      }
    }
    return source.map((character) => ({
      chaId: character.chaId,
      name: character.name,
      displayName: character.displayName,
      image: character.image,
      chats: (character.chats ?? []).filter((chat) => counts.get(chat?.id) === 1),
    }))
  })

  return {
    rows: () => rows,
    activeIndexes(chatIds: ReadonlySet<string>): Set<number> {
      const indexes = new Set<number>()
      rows.forEach((character, index) => {
        if (character.chats.some((chat) => chatIds.has(chat.id))) indexes.add(index)
      })
      return indexes
    },
  }
}
