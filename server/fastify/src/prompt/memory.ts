import type { Chat, Database } from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import type { PromptItem } from '../../../../src/ts/process/prompt'
import type { UnformatedPromptSlots } from './templates.js'
import { tokenizeChat } from './tokens.js'
import { tokenizerOptionsFromDb } from './tokenizerConfig.js'

/**
 * Server memory window: ports the SPA's non-Hypa budget fallback from
 * `buildMemoryWindow.ts`. Hypa V3 planning/selection happens earlier in
 * `prompt/assemble.ts`; this splitter receives any prepared `supaMemory` /
 * `hypaMemory` rows and applies the final context-window budget.
 */

export interface MemoryWindowInput {
  /** The flattened history rows (`AssemblyState.historyMessages`). */
  chats: OpenAIChat[]
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
  | { stopSending: true }
  | {
      stopSending: false
      currentTokens: number
      currentChat: Chat
      memories: OpenAIChat[]
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
      .map((message) => message.chatId)
      .filter((messageId): messageId is string => typeof messageId === 'string' && messageId.length > 0),
  )
  let trimmedStableMessage = false

  // Non-Hypa budget trim (SPA `buildMemoryWindow.ts`).
  while (currentTokens > maxContextTokens) {
    if (chats.length <= 1) {
      return { stopSending: true }
    }
    if (typeof chats[0].memo === 'string' && stableMessageIds.has(chats[0].memo)) {
      trimmedStableMessage = true
    }
    currentTokens -= tokenizeChat(chats[0], encoding, options)
    chats.splice(0, 1)
  }
  const survivingMessageId = chats.find(
    (chat): chat is OpenAIChat & { memo: string } => typeof chat.memo === 'string' && stableMessageIds.has(chat.memo),
  )?.memo
  if (trimmedStableMessage && survivingMessageId) {
    currentChat.lastMemory = survivingMessageId
  } else {
    delete currentChat.lastMemory
  }

  const memories: OpenAIChat[] = []

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
      if (v.memo !== 'supaMemory' && v.memo !== 'hypaMemory') {
        v.removable = true
      } else if (memoryCardUsed) {
        memories.push(v)
        return { role: 'system', content: '' } as OpenAIChat
      } else {
        v.content = `<Previous Conversation>${v.content}</Previous Conversation>`
      }
      return v
    })
    .filter((v) => v.content.trim() !== '' || (v.multimodals && v.multimodals.length > 0))

  return { stopSending: false, currentTokens, currentChat, memories }
}
