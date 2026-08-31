import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve('src/lib/ChatScreens/Chat.svelte'), 'utf8')

describe('Chat explicit owner reads', () => {
  it('keeps character, chat, and settings reads off the aggregate facade', () => {
    expect(source).not.toContain('getDatabase')
    expect(source).not.toContain('function preReadyCharacterRows()')
    expect(source).toContain('function mutableChatBridgeRows()')
    expect(source).toContain('function readSettingsGroup(group: SettingsGroup)')
    expect(source).not.toContain('getResourceDatabase')
  })

  it('waits for ready character and settings owners', () => {
    expect(source).toContain(
      "return charactersResourceState.status === 'ready' ? charactersResourceState.characters : []",
    )
    expect(source).toContain(
      "return charactersResourceState.status === 'ready' ? getSelectedCharacterOwner() : undefined",
    )
    expect(source).toContain("if (status === 'ready') return settingsResourceState.value as Partial<Database>")
    expect(source).toContain('return {}')
  })

  it('requires unique stable character, chat, and message owners once ready', () => {
    expect(source).toContain(
      'if (getCharacterResourceOwner(owner.character.chaId) !== owner.character) return undefined',
    )
    expect(source).toContain('if (!getChatMetadataOwnerState(chatId)) return undefined')
    expect(source).toContain('if (!getChatMetadataOwnerSnapshot(owner.character.chaId, chatId)) return undefined')
    expect(source).toContain('return getChatMessageOwnerState(chat.id)?.messages')
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
