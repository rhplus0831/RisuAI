import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'
import {
  RegexDisplayReloadPointer,
  RegexDisplayReloadScope,
  regexDisplayReloadTokenForContext,
  reloadRegexDisplay,
  resetRegexDisplayReloadForTests,
} from './regexDisplayReload'

function currentToken(): string {
  return regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope), {
    characterId: 'char-a',
    chatId: 'chat-a',
  })
}

beforeEach(() => {
  resetRegexDisplayReloadForTests()
  testDatabaseState.db = {
    characters: [
      {
        chaId: 'char-a',
        name: 'Character A',
        type: 'character',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            note: '',
            localLore: [],
            message: [],
            modules: ['module-a'],
            generationSettings: { promptPresetId: 'preset-a' },
          },
        ],
      },
      {
        chaId: 'char-b',
        name: 'Character B',
        type: 'character',
        chatPage: 0,
        chats: [],
      },
    ],
    modules: [
      { id: 'module-a', name: 'Module A', description: '' },
      { id: 'module-b', name: 'Module B', description: '' },
    ],
    promptPresets: [{ id: 'preset-a', name: 'Preset A' }],
    enabledModules: [],
  } as any
})

describe('regex display reload scoping', () => {
  it('keeps the active context token stable for unrelated owners', () => {
    const initial = currentToken()

    reloadRegexDisplay('char-b')
    expect(currentToken()).toBe(initial)

    reloadRegexDisplay('module:module-b')
    expect(currentToken()).toBe(initial)

    reloadRegexDisplay('preset:preset-b')
    expect(currentToken()).toBe(initial)
  })

  it.each(['char-a', 'module:module-a', 'preset:preset-a', 'global'])(
    'changes the active context token for %s',
    (ownerKey) => {
      const initial = currentToken()
      reloadRegexDisplay(ownerKey)
      expect(currentToken()).not.toBe(initial)
    },
  )
})
