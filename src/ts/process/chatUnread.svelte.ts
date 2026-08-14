import { writable } from 'svelte/store'

const MAX_UNREAD_CHAT_IDS = 256

export const unreadChatIds = writable<ReadonlySet<string>>(new Set())

let visibleChatId: string | null = null

export function setVisibleChat(chatId: string | null | undefined): void {
  visibleChatId = chatId || null
}

export function clearVisibleChat(chatId: string | null | undefined): void {
  if (chatId && visibleChatId === chatId) visibleChatId = null
}

export function isChatVisible(chatId: string | null | undefined): boolean {
  return Boolean(chatId && visibleChatId === chatId)
}

export function markChatUnread(chatId: string | null | undefined): void {
  if (!chatId) return
  unreadChatIds.update((current) => {
    if (current.has(chatId)) return current

    const next = new Set(current)
    next.add(chatId)
    while (next.size > MAX_UNREAD_CHAT_IDS) {
      const oldest = next.values().next().value
      if (typeof oldest !== 'string') break
      next.delete(oldest)
    }
    return next
  })
}

export function markChatRead(chatId: string | null | undefined): void {
  if (!chatId) return
  unreadChatIds.update((current) => {
    if (!current.has(chatId)) return current
    const next = new Set(current)
    next.delete(chatId)
    return next
  })
}

export function resetChatUnreadForTests(): void {
  unreadChatIds.set(new Set())
  visibleChatId = null
}
