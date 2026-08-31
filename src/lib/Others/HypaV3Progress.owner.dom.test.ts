import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOpenChatId, resolveUniqueChatLabel, resolveUniqueOpenChatId } from './HypaV3Progress.svelte'

const source = fs.readFileSync(path.resolve('src/lib/Others/HypaV3Progress.svelte'), 'utf8')

describe('HypaV3Progress owner reads', () => {
  it('selects only the selected owner chat', () => {
    const owner = { chatPage: 1, chats: [{ id: 'old' }, { id: 'open' }] }
    expect(resolveOpenChatId(owner as any)).toBe('open')
    expect(resolveOpenChatId(undefined)).toBeNull()
  })

  it('requires unique character and chat ownership for the open-chat filter', () => {
    const owner = { chaId: 'alpha', chatPage: 0, chats: [{ id: 'open' }] }
    const other = { chaId: 'beta', chatPage: 0, chats: [{ id: 'other' }] }
    expect(resolveUniqueOpenChatId(owner as any, [owner, other] as any)).toBe('open')
    expect(resolveUniqueOpenChatId(owner as any, [owner, { ...other, chats: [{ id: 'open' }] }] as any)).toBeNull()
    expect(resolveUniqueOpenChatId(owner as any, [owner, { ...owner }] as any)).toBeNull()
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

  it('reads progress filtering settings through the display owner group', () => {
    expect(source).toContain('settingsResourceState.groupStatuses.display')
    expect(source).toContain("if (status === 'ready') return settingsResourceState.value.hypaV3ProgressOpenChatOnly")
    expect(source).toContain("if (status === 'idle' || status === 'loading')")
  })
})
