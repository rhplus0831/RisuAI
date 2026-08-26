import { describe, expect, it } from 'vitest'
import type { Chat, Database } from '../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../src/ts/process/index.svelte'
import type { PromptItem } from '../../../src/ts/process/prompt'
import { buildMemoryWindow } from '../src/prompt/memory.js'
import { createEmptyUnformatedSlots } from '../src/prompt/assemble.js'
import { tokenizeChat } from '../src/prompt/tokens.js'
import { tokenizerOptionsFromDb } from '../src/prompt/tokenizerConfig.js'

const db = { maxContext: 1000 } as unknown as Database

function row(content: string, memo?: string): OpenAIChat {
  return { role: 'user', content, ...(memo ? { memo } : {}) }
}

function makeChat(): Chat {
  return {
    id: 'chat-1',
    message: ['m1', 'm2', 'm3'].map((chatId) => ({ role: 'user', data: chatId, chatId })),
  } as unknown as Chat
}

describe('buildMemoryWindow (non-Hypa)', () => {
  it('fills chats, promotes the trailing row to lastChat, marks the rest removable', () => {
    const unformated = createEmptyUnformatedSlots()
    const chats = [row('one', 'm1'), row('two', 'm2'), row('three', 'm3')]
    const result = buildMemoryWindow({
      chats,
      currentTokens: 5,
      maxContextTokens: 1000,
      currentChat: makeChat(),
      memoryCardUsed: false,
      promptTemplate: null,
      unformated,
      db,
    })

    expect(result.stopSending).toBe(false)
    // Trailing row promoted off into lastChat (non-template path).
    expect(unformated.lastChat.map((r) => r.content)).toEqual(['three'])
    expect(unformated.chats.map((r) => r.content)).toEqual(['one', 'two'])
    expect(unformated.chats.every((r) => r.removable === true)).toBe(true)
  })

  it('leaves the cutoff empty when every stable message survives', () => {
    const currentChat = makeChat()
    buildMemoryWindow({
      chats: [row('one', 'm1'), row('two', 'm2')],
      currentTokens: 5,
      maxContextTokens: 1000,
      currentChat,
      memoryCardUsed: false,
      promptTemplate: null,
      unformated: createEmptyUnformatedSlots(),
      db,
    })
    expect(currentChat.lastMemory).toBeUndefined()
  })

  it('skips synthetic prompt memos and records the first surviving message id after trimming', () => {
    const currentChat = makeChat()
    const chats = [row('[Start a new chat]', 'NewChat'), row('one', 'm1'), row('two', 'm2')]
    const { encoding, options } = tokenizerOptionsFromDb(db)
    buildMemoryWindow({
      chats,
      currentTokens: 1000 + tokenizeChat(chats[0], encoding, options) + tokenizeChat(chats[1], encoding, options),
      maxContextTokens: 1000,
      currentChat,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'chat' }] as unknown as PromptItem[],
      unformated: createEmptyUnformatedSlots(),
      db,
    })
    expect(currentChat.lastMemory).toBe('m2')
  })

  it('does not promote lastChat when a prompt template is in use', () => {
    const unformated = createEmptyUnformatedSlots()
    buildMemoryWindow({
      chats: [row('one', 'm1'), row('two', 'm2')],
      currentTokens: 5,
      maxContextTokens: 1000,
      currentChat: makeChat(),
      memoryCardUsed: false,
      promptTemplate: [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }] as unknown as PromptItem[],
      unformated,
      db,
    })
    expect(unformated.lastChat).toEqual([])
    expect(unformated.chats.map((r) => r.content)).toEqual(['one', 'two'])
  })

  it('trims the oldest rows until the budget is met', () => {
    const chats = [row('one', 'm1'), row('two', 'm2'), row('three', 'm3')]
    const { encoding, options } = tokenizerOptionsFromDb(db)
    const dropCost = tokenizeChat(chats[0], encoding, options)
    const currentChat = makeChat()
    const result = buildMemoryWindow({
      chats,
      // Exactly one drop brings us down to the budget.
      currentTokens: 1000 + dropCost,
      maxContextTokens: 1000,
      currentChat,
      memoryCardUsed: false,
      promptTemplate: [{ type: 'chat' }] as unknown as PromptItem[],
      unformated: createEmptyUnformatedSlots(),
      db,
    })
    expect(result).toMatchObject({ stopSending: false })
    if (result.stopSending === false) expect(result.historyTruncated).toBe(true)
    // m1 dropped; m2 is now the oldest surviving row.
    expect(currentChat.lastMemory).toBe('m2')
  })

  it('stops sending when the budget cannot be met without losing the last row', () => {
    const result = buildMemoryWindow({
      chats: [row('only', 'm1')],
      currentTokens: 1_000_000,
      maxContextTokens: 10,
      currentChat: makeChat(),
      memoryCardUsed: false,
      promptTemplate: null,
      unformated: createEmptyUnformatedSlots(),
      db,
    })
    expect(result).toEqual({ stopSending: true })
  })

  it('captures memory-memo rows into memories when a memory card is used', () => {
    const unformated = createEmptyUnformatedSlots()
    const result = buildMemoryWindow({
      chats: [row('summary', 'supaMemory'), row('live', 'm2')],
      currentTokens: 5,
      maxContextTokens: 1000,
      currentChat: makeChat(),
      memoryCardUsed: true,
      promptTemplate: [{ type: 'memory' }] as unknown as PromptItem[],
      unformated,
      db,
    })

    expect(result.stopSending).toBe(false)
    if (result.stopSending === false) {
      expect(result.memories.map((r) => r.content)).toEqual(['summary'])
    }
    // The captured row is replaced with an empty system row and filtered out.
    expect(unformated.chats.map((r) => r.content)).toEqual(['live'])
  })

  it('wraps memory-memo rows inline when no memory card consumes them', () => {
    const unformated = createEmptyUnformatedSlots()
    buildMemoryWindow({
      chats: [row('summary', 'supaMemory')],
      currentTokens: 5,
      maxContextTokens: 1000,
      currentChat: makeChat(),
      memoryCardUsed: false,
      promptTemplate: [{ type: 'chat' }] as unknown as PromptItem[],
      unformated,
      db,
    })
    expect(unformated.chats.map((r) => r.content)).toEqual(['<Previous Conversation>summary</Previous Conversation>'])
  })
})
