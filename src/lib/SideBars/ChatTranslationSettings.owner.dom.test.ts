import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandSpies = vi.hoisted(() => ({
  setCurrentChatTranslationSettingWithOutcome: vi.fn(async () => ({ status: 'accepted' as const })),
}))

vi.mock('src/ts/chatCommands', () => commandSpies)

import ChatTranslationSettings, {
  resolveChatTranslationSettingsOwner,
  resolveGlobalTranslatorPresetOwner,
  resolveTranslatorLanguageSettingsOwner,
  resolveTranslatorPresetCollectionOwner,
} from './ChatTranslationSettings.svelte'
import {
  collectionsResourceState,
  replaceResourceDatabase,
  settingsResourceState,
} from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function preset(id: string, name: string) {
  return {
    id,
    name,
    prompt: `${name} prompt`,
    maxResponse: 256,
    steps: [
      {
        id: `${id}-step`,
        name: 'Step 1',
        enabled: true,
        prompt: `${name} prompt`,
        maxResponse: 256,
        model: { mode: 'inheritTranslate' as const },
      },
    ],
  }
}

function character(characterId: string | undefined, chatIds: Array<string | undefined>) {
  return {
    ...(characterId === undefined ? {} : { chaId: characterId }),
    name: characterId ?? 'Missing id',
    chatPage: 0,
    chats: chatIds.map((chatId) => ({
      ...(chatId === undefined ? {} : { id: chatId }),
      name: chatId ?? 'Missing id',
      message: [],
      localLore: [],
    })),
  }
}

function seedOwners(characters = [character('character-a', ['chat-a'])]): void {
  replaceResourceDatabase({
    currentChar: 0,
    translator: 'ko',
    translatorType: 'llm',
    translatorPresetId: 'translator-a',
    translatorPresets: [preset('translator-a', 'Translator Alpha'), preset('translator-b', 'Translator Beta')],
    characters,
  } as never)
}

function translatorPresetSelect(): HTMLSelectElement {
  const select = target.querySelector<HTMLSelectElement>(
    '[data-risu-chat-translation-setting="translatorPresetId"] select',
  )
  expect(select).toBeTruthy()
  return select!
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  commandSpies.setCurrentChatTranslationSettingWithOutcome.mockClear()
  seedOwners()
})

afterEach(async () => {
  if (component) {
    await unmount(component)
    component = undefined
  }
  target.remove()
  replaceResourceDatabase({} as never)
})

describe('ChatTranslationSettings resource owners', () => {
  it('resolves only ready, canonical translator settings and preset owners', () => {
    const presets = [preset('translator-a', 'Translator Alpha'), preset('translator-b', 'Translator Beta')]

    expect(
      resolveTranslatorLanguageSettingsOwner('ready', {
        translator: 'ko',
        translatorType: 'llm',
        translatorPresetId: 'translator-a',
      }),
    ).toEqual({ translator: 'ko', translatorType: 'llm', translatorPresetId: 'translator-a' })
    expect(
      resolveTranslatorLanguageSettingsOwner('loading', {
        translator: 'ko',
        translatorType: 'llm',
        translatorPresetId: 'translator-a',
      }),
    ).toBeUndefined()
    expect(
      resolveTranslatorLanguageSettingsOwner('ready', {
        translator: 'ko',
        translatorType: 'llm',
        translatorPresetId: 0,
      }),
    ).toBeUndefined()

    const owner = resolveTranslatorPresetCollectionOwner('ready', presets)
    expect(owner).toEqual(presets)
    expect(resolveGlobalTranslatorPresetOwner(owner, 'translator-a')?.name).toBe('Translator Alpha')
    expect(resolveTranslatorPresetCollectionOwner('error', presets)).toBeUndefined()
    expect(
      resolveTranslatorPresetCollectionOwner('ready', [...presets, preset('translator-a', 'Duplicate')]),
    ).toBeUndefined()
    expect(resolveGlobalTranslatorPresetOwner(owner, 'missing')).toBeUndefined()
  })

  it('rejects malformed chat metadata without repairing it', () => {
    expect(resolveChatTranslationSettingsOwner({ autoTranslate: true, bilingualEmphasis: 'translation' })).toEqual({
      autoTranslate: true,
      bilingualEmphasis: 'translation',
    })
    expect(resolveChatTranslationSettingsOwner({ translatorPresetId: '' })).toBeUndefined()
    expect(resolveChatTranslationSettingsOwner({ autoTranslate: 'true' })).toBeUndefined()
    expect(resolveChatTranslationSettingsOwner({ bilingualEmphasis: 'both' })).toBeUndefined()
  })

  it('renders ready owners and preserves the scoped durable command UI', async () => {
    component = mount(ChatTranslationSettings, { target })
    await tick()

    const select = translatorPresetSelect()
    expect(select.disabled).toBe(false)
    expect(select.options[0].textContent).toContain('Translator Alpha')
    expect([...select.options].map((option) => option.value)).toEqual(['', 'translator-a', 'translator-b'])

    const autoTranslate = target.querySelector<HTMLInputElement>(
      '[data-risu-chat-translation-setting="autoTranslate"] input',
    )
    expect(autoTranslate?.disabled).toBe(false)
    autoTranslate?.click()
    await vi.waitFor(() => {
      expect(commandSpies.setCurrentChatTranslationSettingWithOutcome).toHaveBeenCalledWith('autoTranslate', true)
    })
  })

  it.each([
    ['duplicate character ids', [character('character-a', ['chat-a']), character('character-a', ['chat-b'])]],
    ['duplicate chat ids in one character', [character('character-a', ['chat-a', 'chat-a'])]],
    [
      'duplicate chat ids across characters',
      [character('character-a', ['chat-a']), character('character-b', ['chat-a'])],
    ],
    ['missing character id', [character(undefined, ['chat-a'])]],
    ['missing chat id', [character('character-a', [undefined])]],
  ])('disables chat writes for %s', async (_label, characters) => {
    seedOwners(characters)
    component = mount(ChatTranslationSettings, { target })
    await tick()

    const controls = target.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-risu-chat-translation-setting] input, [data-risu-chat-translation-setting] select',
    )
    expect(controls.length).toBeGreaterThan(0)
    expect([...controls].every((control) => control.disabled)).toBe(true)
  })

  it('fails closed when the language or preset owner is unavailable', async () => {
    settingsResourceState.groupStatuses.language = 'error'
    component = mount(ChatTranslationSettings, { target })
    await tick()
    expect(target.querySelector('[data-risu-chat-translation-settings]')).toBeNull()

    await unmount(component)
    component = undefined
    seedOwners()
    collectionsResourceState.statuses.translatorPresets = 'error'
    component = mount(ChatTranslationSettings, { target })
    await tick()
    expect(translatorPresetSelect().disabled).toBe(true)
  })

  it('does not depend on the aggregate database facade', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/SideBars/ChatTranslationSettings.svelte'), 'utf8')

    expect(source).not.toContain('getDatabase')
    expect(source).not.toContain('selectedCharID')
    expect(source).toContain('getSelectedCharacterOwner')
    expect(source).toContain('getChatMetadataOwnerSnapshot')
    expect(source).toContain('settingsResourceState.groupStatuses.language')
    expect(source).toContain('collectionsResourceState.statuses.translatorPresets')
    expect(source).toContain('setCurrentChatTranslationSettingWithOutcome')
  })
})
