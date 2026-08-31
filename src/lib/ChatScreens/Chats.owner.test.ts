import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve('src/lib/ChatScreens/Chats.svelte'), 'utf8')

describe('Chats owner reads', () => {
  it('keeps metadata fallback pre-ready and fails closed for ready/error ambiguity', () => {
    expect(source).toContain('const characterOwner = getCharacterResourceOwner(characterId)')
    expect(source).toContain("charactersResourceState.rowStatuses[characterId] === 'error'")
    expect(source).toContain('chatMatches.length === 1 ? getChatMetadataOwnerState(chatId) : undefined')
    expect(source).toContain(
      "if (charactersResourceState.status !== 'idle' && charactersResourceState.status !== 'loading') return undefined",
    )
    expect(source).toContain('characterMatches.length !== 1')
    expect(source).toContain('globalChatMatches === 1')
    expect(source).toContain('getChatMetadataOwnerState(chatId)')
    expect(source).not.toContain('preferChatMetadataOwner')
    expect(source).not.toContain('getDatabase')
  })

  it('reads display and scrolling settings through their owner groups', () => {
    expect(source).toContain("readSettingsGroup('display').showMemoryLimit")
    expect(source).toContain("readSettingsGroup('sidebar').autoScrollToNewMessage")
    expect(source).toContain("readSettingsGroup('sidebar').alwaysScrollToNewMessage")
    expect(source).toContain("settingsResourceState.groupStatuses.sidebar === 'error'")
    expect(source).not.toContain('database.showMemoryLimit')
    expect(source).not.toContain('database.autoScrollToNewMessage')
    expect(source).not.toContain('database.alwaysScrollToNewMessage')
    expect(source).not.toContain('getDatabase')
  })
})
