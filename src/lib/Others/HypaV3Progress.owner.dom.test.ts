import { describe, expect, it } from 'vitest'
import { resolveOpenChatId, resolveUniqueChatLabel } from './HypaV3Progress.svelte'

describe('HypaV3Progress owner reads', () => {
  it('selects only the selected owner chat', () => {
    const owner = { chatPage: 1, chats: [{ id: 'old' }, { id: 'open' }] }
    expect(resolveOpenChatId(owner as any)).toBe('open')
    expect(resolveOpenChatId(undefined)).toBeNull()
  })

  it('fails closed for duplicate chat IDs while labeling unique chats', () => {
    const characters = [
      { chaId: 'alpha', name: 'Alpha', chats: [{ id: 'chat-a', name: '' }] },
      { chaId: 'beta', name: 'Beta', chats: [{ id: 'chat-b', name: 'Named' }] },
    ]
    expect(resolveUniqueChatLabel(characters as any, 'chat-b', 'Unnamed', 'Unknown')).toBe('Beta — Named')
    expect(resolveUniqueChatLabel(characters as any, 'chat-a', 'Unnamed', 'Unknown')).toBe('Alpha — Unnamed')
    expect(
      resolveUniqueChatLabel(
        [...characters, { chaId: 'duplicate', name: 'Duplicate', chats: [{ id: 'chat-b', name: 'Other' }] }] as any,
        'chat-b',
        'Unnamed',
        'Unknown',
      ),
    ).toBe('Unknown')
    expect(
      resolveUniqueChatLabel(
        [{ name: 'Missing ID', chats: [{ id: 'chat-c', name: 'Named' }] }] as any,
        'chat-c',
        'Unnamed',
        'Unknown',
      ),
    ).toBe('Unknown')
    expect(
      resolveUniqueChatLabel(
        [...characters, { chaId: 'beta', name: 'Duplicate owner', chats: [{ id: 'chat-c', name: 'Other' }] }] as any,
        'chat-c',
        'Unnamed',
        'Unknown',
      ),
    ).toBe('Unknown')
  })
})
