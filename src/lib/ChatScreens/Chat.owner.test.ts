import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve('src/lib/ChatScreens/Chat.svelte'), 'utf8')

describe('Chat explicit owner reads', () => {
  it('isolates the only remaining aggregate reads behind classified compatibility seams', () => {
    expect(source.match(/getDatabase\(\)/g)).toHaveLength(3)
    expect(source).toContain('function preReadyCharacterRows()')
    expect(source).toContain('function mutableChatBridgeRows()')
    expect(source).toContain('function readSettingsGroup(group: SettingsGroup)')
    expect(source).not.toContain('getResourceDatabase')
  })

  it('retains aggregate compatibility only while settings and characters are idle or loading', () => {
    expect(source).toContain(
      "return charactersResourceState.status === 'idle' || charactersResourceState.status === 'loading'",
    )
    expect(source).toContain("if (status === 'ready') return settingsResourceState.value as Partial<Database>")
    expect(source).toContain("if (status === 'error' || settingsResourceState.status === 'error') return {}")
    expect(source).toContain("if (status === 'idle' || status === 'loading') return getDatabase()")
    expect(source).toContain('return {}')
  })

  it('requires unique stable character, chat, and message owners once ready', () => {
    expect(source).toContain("if (charactersResourceState.status === 'ready') return getSelectedCharacterOwner()")
    expect(source).toContain(
      'if (getCharacterResourceOwner(owner.character.chaId) !== owner.character) return undefined',
    )
    expect(source).toContain('if (!getChatMetadataOwnerState(chatId)) return undefined')
    expect(source).toContain('if (!getChatMetadataOwnerSnapshot(owner.character.chaId, chatId)) return undefined')
    expect(source).toContain("charactersResourceState.status === 'ready' ? getChatMessageOwnerState(chat.id)?.messages")
    expect(source).toContain('messages.filter((message) => message.chatId === candidate.chatId).length === 1')
  })

  it('reads settings from their owning groups instead of direct aggregate fields', () => {
    expect(source).toContain("readSettingsGroup('display')")
    expect(source).toContain("readSettingsGroup('language')")
    expect(source).toContain("readSettingsGroup('sidebar')")
    expect(source).toContain("readSettingsGroup('advanced')")
    for (const field of ['theme', 'translator', 'askRemoval', 'enableBookmark', 'guiHTML', 'iconsize', 'zoomsize']) {
      expect(source).not.toContain(`getDatabase().${field}`)
    }
  })
})
