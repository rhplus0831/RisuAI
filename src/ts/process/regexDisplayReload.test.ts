import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { testDatabaseState } from '../__tests__/resourceDatabaseState'
import { selectedCharID } from '../stores.svelte'
import {
  charactersResourceState,
  collectionsResourceState,
  settingsResourceState,
} from '../server/resourceState.svelte'
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
    personas: [],
    agentPresets: [],
    moduleIntergration: '',
    enabledModules: [],
    currentChar: 0,
  } as any
  selectedCharID.set(0)
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

  it('uses the ready selected-character owner instead of the compatibility selection', () => {
    charactersResourceState.currentChar = 1
    selectedCharID.set(0)

    const initial = regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope))
    reloadRegexDisplay('char-a')
    expect(regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope))).toBe(
      initial,
    )

    reloadRegexDisplay('char-b')
    expect(regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope))).not.toBe(
      initial,
    )
  })

  it('ignores the compatibility selection while character owners are loading', () => {
    charactersResourceState.status = 'loading'
    charactersResourceState.currentChar = 1
    selectedCharID.set(0)

    const initial = regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope))
    reloadRegexDisplay('char-a')
    expect(regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope))).toBe(
      initial,
    )
  })

  it('does not reuse compatibility characters after the owner resource fails', () => {
    charactersResourceState.status = 'error'

    const initial = regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope))
    reloadRegexDisplay('char-a')
    expect(regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope))).toBe(
      initial,
    )
  })

  it('omits module owners when a required activation owner fails', () => {
    collectionsResourceState.statuses.modules = 'error'

    const initial = currentToken()
    reloadRegexDisplay('module:module-a')

    expect(currentToken()).toBe(initial)
    expect(settingsResourceState.groupStatuses.modules).toBe('ready')
  })

  it('fails closed for duplicate character and chat stable IDs', () => {
    const duplicateCharacter = { ...charactersResourceState.characters[0], chats: [] }
    charactersResourceState.characters.push(duplicateCharacter)

    const duplicateCharacterToken = currentToken()
    reloadRegexDisplay('char-a')
    expect(currentToken()).toBe(duplicateCharacterToken)
    reloadRegexDisplay('preset:preset-a')
    expect(currentToken()).toBe(duplicateCharacterToken)

    testDatabaseState.db = {
      ...testDatabaseState.db,
      characters: [
        testDatabaseState.db.characters[0],
        {
          ...testDatabaseState.db.characters[1],
          chats: [
            {
              id: 'chat-a',
              name: 'Duplicate chat',
              note: '',
              localLore: [],
              message: [],
              generationSettings: { promptPresetId: 'preset-b' },
            },
          ],
        },
      ],
    }

    const duplicateChatToken = currentToken()
    reloadRegexDisplay('preset:preset-a')
    expect(currentToken()).toBe(duplicateChatToken)
    reloadRegexDisplay('module:module-a')
    expect(currentToken()).toBe(duplicateChatToken)
  })

  it('does not scope reloads to missing explicit stable IDs', () => {
    const token = regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope), {
      characterId: 'char-missing',
      chatId: 'chat-a',
    })

    reloadRegexDisplay('char-missing')
    expect(
      regexDisplayReloadTokenForContext(get(RegexDisplayReloadPointer), get(RegexDisplayReloadScope), {
        characterId: 'char-missing',
        chatId: 'chat-a',
      }),
    ).toBe(token)
  })
})
