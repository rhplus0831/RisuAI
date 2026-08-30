import { describe, expect, it } from 'vitest'
import {
  buildPromptMemoryQueryTexts,
  type PromptMemoryQueryDatabase,
  type PromptMemoryQueryMessage,
} from '../src/promptMemoryQuery.js'

function database(messages: PromptMemoryQueryMessage[]): PromptMemoryQueryDatabase {
  return {
    characters: [
      {
        chaId: 'character-a',
        chats: [{ id: 'chat-a', message: messages }],
      },
    ],
  }
}

const source = {
  chatId: 'chat-a',
  characterId: 'character-a',
  mode: 'send' as const,
}

describe('prompt memory query text projection', () => {
  it('deduplicates an appended send and includes a distinct pending user message', () => {
    const messages: PromptMemoryQueryMessage[] = [
      { role: 'char', data: 'answer' },
      { role: 'user', data: 'already appended' },
    ]

    expect(buildPromptMemoryQueryTexts(database(messages), { ...source, userMessage: 'already appended' }, 0)).toEqual([
      'answer',
      'already appended',
    ])
    expect(buildPromptMemoryQueryTexts(database(messages), { ...source, userMessage: 'pending input' }, 0)).toEqual([
      'answer',
      'already appended',
      'pending input',
    ])
  })

  it('trims a regenerate tail before filtering reset, disabled, empty, and count-limited rows', () => {
    const messages: PromptMemoryQueryMessage[] = [
      { role: 'user', data: 'before reset' },
      { role: 'char', data: 'reset marker', disabled: 'allBefore' },
      { role: 'user', data: 'disabled', disabled: true },
      { role: 'user', data: 'recent user' },
      { role: 'char', data: 'kept alternate', chatId: 'alternate-1', saying: 'Tess' },
      { role: 'char', data: 'other speaker', chatId: 'alternate-2', saying: 'Other' },
      { role: 'char', data: 'regenerate target', chatId: 'target', saying: 'Tess' },
      { role: 'user', data: '   ' },
    ]

    expect(
      buildPromptMemoryQueryTexts(
        database(messages.slice(0, -1)),
        { chatId: 'chat-a', characterId: 'character-a', mode: 'regenerate', regenerateMessageId: 'target' },
        2,
      ),
    ).toEqual(['recent user', 'kept alternate'])

    expect(buildPromptMemoryQueryTexts(database(messages), source, 2)).toEqual(['regenerate target'])
  })

  it('returns no queries for an unknown chat', () => {
    expect(buildPromptMemoryQueryTexts(database([]), { ...source, chatId: 'missing' }, 0)).toEqual([])
  })
})
