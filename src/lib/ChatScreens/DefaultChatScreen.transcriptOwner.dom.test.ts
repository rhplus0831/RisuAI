import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  resolveReadyOwnerValue,
  resolveTranscriptRenderMessages,
  resolveUniqueChatOwner,
} from './DefaultChatScreen.svelte'

describe('DefaultChatScreen transcript render owner', () => {
  it('ignores divergent aggregate rows when an owner projection is available', () => {
    const aggregate = [{ chatId: 'aggregate', data: 'stale' }] as any
    const owner = [{ chatId: 'owner', data: 'fresh' }] as any

    expect(resolveTranscriptRenderMessages({ messages: owner, projectionEpoch: 1 } as any, aggregate)).toBe(owner)
  })

  it('returns the refreshed owner array after its projection epoch advances', () => {
    const first = [{ chatId: 'm1', data: 'first' }] as any
    const second = [{ chatId: 'm1', data: 'second' }] as any
    const owner = { messages: first, projectionEpoch: 1 } as any

    expect(resolveTranscriptRenderMessages(owner, [])).toBe(first)
    owner.messages = second
    owner.projectionEpoch = 2
    expect(resolveTranscriptRenderMessages(owner, [])).toBe(second)
  })

  it('uses owner content for read decisions such as empty-history gates', () => {
    const aggregate = [{ chatId: 'stale', data: 'aggregate-only' }] as any
    const owner = [] as any

    expect(resolveTranscriptRenderMessages({ messages: owner, projectionEpoch: 3 } as any, aggregate)).toHaveLength(0)
  })

  it('falls back to aggregate rows only while no transcript owner exists', () => {
    const aggregate = [{ chatId: 'aggregate', data: 'bootstrap' }] as any

    expect(resolveTranscriptRenderMessages(undefined, aggregate)).toBe(aggregate)
  })
})

describe('DefaultChatScreen stable chat owner', () => {
  function character(characterId: string, chatId: string, data: string) {
    return {
      chaId: characterId,
      chats: [{ id: chatId, message: [{ role: 'user', data }] }],
    } as any
  }

  it('resolves a unique character/chat pair by stable ids', () => {
    const owner = character('character-a', 'chat-a', 'owner')

    expect(resolveUniqueChatOwner([owner], 'character-a', 'chat-a')).toEqual({
      character: owner,
      chat: owner.chats[0],
    })
  })

  it('fails closed for duplicate character or chat ids', () => {
    const first = character('character-a', 'chat-a', 'first')
    const duplicateCharacter = character('character-a', 'chat-a', 'second')
    const duplicateCharacterWithAnotherChat = character('character-a', 'chat-b', 'second')
    const duplicateChatOnAnotherCharacter = character('character-b', 'chat-a', 'second')
    const duplicateChat = character('character-a', 'chat-a', 'first')
    duplicateChat.chats.push({ ...duplicateChat.chats[0] })

    expect(resolveUniqueChatOwner([first, duplicateCharacter], 'character-a', 'chat-a')).toBeUndefined()
    expect(resolveUniqueChatOwner([first, duplicateCharacterWithAnotherChat], 'character-a', 'chat-a')).toBeUndefined()
    expect(resolveUniqueChatOwner([first, duplicateChatOnAnotherCharacter], 'character-a', 'chat-a')).toBeUndefined()
    expect(resolveUniqueChatOwner([duplicateChat], 'character-a', 'chat-a')).toBeUndefined()
  })

  it('keeps the component closed to the aggregate database facade', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/ChatScreens/DefaultChatScreen.svelte'), 'utf8')

    expect(source).not.toContain('getDatabase')
    expect(source).toContain("groupedSetting('advanced', 'inputHooks')")
    expect(source).toContain('getChatMetadataOwnerSnapshot')
    expect(source).toContain('getChatMessageOwnerState')
  })
})

describe('DefaultChatScreen settings owner readiness', () => {
  it('uses the pre-ready fallback only until the owner becomes ready', () => {
    expect(resolveReadyOwnerValue('loading', 'owner', 'fallback')).toBe('fallback')
    expect(resolveReadyOwnerValue('ready', 'owner', 'fallback')).toBe('owner')
  })

  it('keeps a missing ready owner value authoritative', () => {
    expect(resolveReadyOwnerValue('ready', undefined, 'fallback')).toBeUndefined()
  })
})
