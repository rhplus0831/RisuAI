import type { FastifyChat as Chat, FastifyDatabase as Database, FastifyMessage as Message } from './serverTypes.js'
import type { PromptItem } from './promptTemplate.js'
import type { UnformatedPromptSlots } from './templates.js'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'
import type { PromptMessage } from './promptMessage.js'

/**
 * Server memory window: ports the SPA's non-Hypa budget fallback from
 * `buildMemoryWindow.ts`. Hypa V3 planning/selection happens earlier in
 * `prompt/assemble.ts`; this splitter receives any prepared `supaMemory` /
 * `hypaMemory` rows and applies the final context-window budget.
 */

export interface MemoryWindowInput {
  /** The flattened history rows (`AssemblyState.historyMessages`). */
  chats: PromptMessage[]
  /** The running token estimate seeded by lorebook preflight. */
  currentTokens: number
  /** `db.maxContext`. */
  maxContextTokens: number
  /** The working chat; `lastMemory` is written when the budget trims. */
  currentChat: Chat
  /** Whether the template renders a `memory` card. */
  memoryCardUsed: boolean
  /** When null, the trailing chat is promoted to `unformated.lastChat`. */
  promptTemplate: PromptItem[] | null
  /** Mutated in place: `chats` is assigned and `lastChat` is pushed into. */
  unformated: UnformatedPromptSlots
  /** Tokenizer config source (`tokenizerOptionsFromDb`). */
  db: Database
}

export type MemoryWindowResult =
  | { stopSending: true; reason: 'history_context_overflow' | 'bardwiki_pinned_budget_exceeded' }
  | {
      stopSending: false
      currentTokens: number
      currentChat: Chat
      memories: PromptMessage[]
      /** True when at least one durable chat message was omitted for budget. */
      historyTruncated?: true
    }

/**
 * Drop the oldest rows until the running estimate fits `maxContextTokens`,
 * then split memory cards out of the surviving history and write the
 * result into `unformated.chats` (+ `unformated.lastChat` when no prompt
 * template is in use). Returns `{ stopSending: true }` when the budget
 * cannot be met without losing the only remaining row, matching the SPA's
 * `buildMemoryWindow` fallback.
 */
export function buildMemoryWindow(input: MemoryWindowInput): MemoryWindowResult {
  const { maxContextTokens, memoryCardUsed, promptTemplate, unformated, db } = input
  const { encoding, options } = tokenizerOptionsFromDb(db)
  const chats = input.chats
  let currentTokens = input.currentTokens
  const currentChat = input.currentChat
  const stableMessageIds = new Set(
    (currentChat.message ?? [])
      .map((message: Message) => message.chatId)
      .filter(
        (messageId: string | undefined): messageId is string => typeof messageId === 'string' && messageId.length > 0,
      ),
  )
  let trimmedStableMessage = false

  // Non-Hypa budget trim (SPA `buildMemoryWindow.ts`).
  while (currentTokens > maxContextTokens) {
    const trimIndex = memoryWindowTrimIndex(chats)
    if (trimIndex === -1) {
      return {
        stopSending: true,
        reason: chats.some((chat) => chat.memo === 'bardWiki' && chat.removable === false)
          ? 'bardwiki_pinned_budget_exceeded'
          : 'history_context_overflow',
      }
    }
    const candidate = chats[trimIndex]
    if (typeof candidate.memo === 'string' && stableMessageIds.has(candidate.memo)) {
      trimmedStableMessage = true
    }
    currentTokens -= tokenizeChat(candidate, encoding, options)
    chats.splice(trimIndex, 1)
  }
  const survivingMessageId = chats.find(
    (chat): chat is PromptMessage & { memo: string } =>
      typeof chat.memo === 'string' && stableMessageIds.has(chat.memo),
  )?.memo
  if (trimmedStableMessage && survivingMessageId) {
    currentChat.lastMemory = survivingMessageId
  } else {
    delete currentChat.lastMemory
  }

  const memories: PromptMessage[] = []

  // Match the SPA's `buildMemoryWindow`: promote the trailing chat to
  // `lastChat` only on the non-template path.
  if (!promptTemplate) {
    unformated.lastChat.push(chats[chats.length - 1])
    chats.splice(chats.length - 1, 1)
  }

  // SPA `buildMemoryWindow` memory split: supaMemory/hypaMemory rows are either
  // captured into `memories` (when a memory card consumes them) or wrapped
  // inline; everything else is marked `removable`. Empty rows drop out.
  unformated.chats = chats
    .map((v) => {
      if (v.memo !== 'supaMemory' && v.memo !== 'hypaMemory' && v.memo !== 'bardWiki') {
        v.removable = true
      } else if (memoryCardUsed) {
        memories.push(v)
        return { role: 'system', content: '' } as PromptMessage
      } else if (v.memo !== 'bardWiki') {
        v.content = `<Previous Conversation>${v.content}</Previous Conversation>`
      }
      return v
    })
    .filter((v) => v.content.trim() !== '' || (v.multimodals && v.multimodals.length > 0))

  return {
    stopSending: false,
    currentTokens,
    currentChat,
    memories,
    ...(trimmedStableMessage ? { historyTruncated: true as const } : {}),
  }
}

function memoryWindowTrimIndex(chats: readonly PromptMessage[]): number {
  const nonPinnedBardWiki = chats.findIndex((chat) => chat.memo === 'bardWiki' && chat.removable === true)
  if (nonPinnedBardWiki >= 0) return nonPinnedBardWiki

  let newestHistoryIndex = -1
  for (let index = chats.length - 1; index >= 0; index--) {
    if (!isMemoryRow(chats[index])) {
      newestHistoryIndex = index
      break
    }
  }
  return chats.findIndex((chat, index) => !isMemoryRow(chat) && index !== newestHistoryIndex)
}

function isMemoryRow(chat: PromptMessage): boolean {
  return chat.memo === 'supaMemory' || chat.memo === 'hypaMemory' || chat.memo === 'bardWiki'
}
