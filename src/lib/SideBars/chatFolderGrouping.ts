export interface GroupedChat<C> {
  chat: C
  /** The chat's index in the original `chats` array. */
  index: number
}

/**
 * Group chats by their `folderId` in a single pass, preserving the original
 * order and recording each chat's index in the source array.
 *
 * Chats with a nullish `folderId`, or an id absent from `validFolderIds` when
 * supplied, are collected under the empty-string key (no real folder id is
 * empty), so real folder lookups exclude unassigned and orphaned chats.
 */
export function groupChatsByFolderId<C extends { folderId?: string | null }>(
  chats: readonly C[],
  validFolderIds?: ReadonlySet<string>,
): Map<string, GroupedChat<C>[]> {
  const groups = new Map<string, GroupedChat<C>[]>()
  chats.forEach((chat, index) => {
    const key = chat.folderId && (!validFolderIds || validFolderIds.has(chat.folderId)) ? chat.folderId : ''
    let list = groups.get(key)
    if (!list) {
      list = []
      groups.set(key, list)
    }
    list.push({ chat, index })
  })
  return groups
}
