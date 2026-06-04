export interface GroupedChat<C> {
  chat: C
  /** The chat's index in the original `chats` array. */
  index: number
}

/**
 * Group chats by their `folderId` in a single pass, preserving the original
 * order and recording each chat's index in the source array.
 *
 * The chat-folder sidebar previously ran `chats.filter(...)` once per folder
 * (for the emptiness check and again for the list) plus an `indexOf` per
 * rendered chat, i.e. O(folders*chats) + O(chats^2) on every render. A single
 * keyed grouping replaces both rescans while keeping identical ordering: chats
 * are appended in source order, and the recorded index matches what
 * `chats.indexOf(chat)` returned.
 *
 * Chats with a nullish `folderId` are collected under the empty-string key (no
 * real folder id is empty), so a folder lookup by its id never returns them —
 * matching the previous `chat.folderId == folder.id` behavior.
 */
export function groupChatsByFolderId<C extends { folderId?: string | null }>(
  chats: readonly C[],
): Map<string, GroupedChat<C>[]> {
  const groups = new Map<string, GroupedChat<C>[]>()
  chats.forEach((chat, index) => {
    const key = chat.folderId ?? ''
    let list = groups.get(key)
    if (!list) {
      list = []
      groups.set(key, list)
    }
    list.push({ chat, index })
  })
  return groups
}
