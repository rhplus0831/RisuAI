import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import ChatDraftHookSelector from './ChatDraftHookSelector.svelte'
import { resolveOwnedDraftHooks, resolveOwnedSelectedDraftHookId } from './ChatDraftHookSelector.svelte'
import { replaceResourceDatabase } from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function character(characterId: string | undefined, chatIds: Array<string | undefined>) {
  return {
    ...(characterId === undefined ? {} : { chaId: characterId }),
    name: characterId ?? 'Missing id',
    chatPage: 0,
    chats: chatIds.map((chatId) => ({
      ...(chatId === undefined ? {} : { id: chatId }),
      name: chatId ?? 'Missing id',
      selectedDraftHookId: 'draft-b',
      message: [],
      localLore: [],
    })),
  }
}

function seedCharacters(characters: ReturnType<typeof character>[]): void {
  replaceResourceDatabase({
    currentChar: 0,
    inputHooks: [{ id: 'draft-b', type: 'draft', name: 'Draft B', prompt: 'prompt' }],
    characters,
  } as never)
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(async () => {
  if (component) {
    await unmount(component)
    component = undefined
  }
  target.remove()
  replaceResourceDatabase({} as never)
})

describe('ChatDraftHookSelector resource owners', () => {
  it('uses only ready, uniquely identified draft hooks', () => {
    const hooks = [
      { id: 'draft-a', type: 'draft', name: 'Draft A' },
      { id: 'draft-a', type: 'draft', name: 'Duplicate Draft A' },
      { id: 'draft-b', type: 'draft', name: 'Draft B' },
      { id: '', type: 'draft', name: 'Missing id' },
      { id: 'btw-a', type: 'btw', name: 'BTW A' },
    ]

    expect(resolveOwnedDraftHooks('loading', hooks)).toEqual([])
    expect(resolveOwnedDraftHooks('ready', hooks)).toEqual([{ id: 'draft-b', type: 'draft', name: 'Draft B' }])
    expect(resolveOwnedDraftHooks('ready', undefined)).toEqual([])
  })

  it('fails closed for missing or malformed selected hook ids', () => {
    expect(resolveOwnedSelectedDraftHookId({ selectedDraftHookId: 'draft-a' })).toBe('draft-a')
    expect(resolveOwnedSelectedDraftHookId({ selectedDraftHookId: '' })).toBeUndefined()
    expect(resolveOwnedSelectedDraftHookId({ selectedDraftHookId: 3 })).toBeUndefined()
    expect(resolveOwnedSelectedDraftHookId(undefined)).toBeUndefined()
  })

  it.each([
    ['duplicate character ids', [character('character-a', ['chat-a']), character('character-a', ['chat-b'])]],
    ['duplicate chat ids', [character('character-a', ['chat-a', 'chat-a'])]],
    ['missing character id', [character(undefined, ['chat-a'])]],
    ['blank character id', [character('   ', ['chat-a'])]],
    ['missing chat id', [character('character-a', [undefined])]],
    ['blank chat id', [character('character-a', ['   '])]],
  ])('disables selection for %s', async (_label, characters) => {
    seedCharacters(characters)
    component = mount(ChatDraftHookSelector, { target })
    await tick()

    const button = target.querySelector<HTMLButtonElement>('[data-risu-draft-hook-selector] button')
    expect(button).toBeTruthy()
    expect(button?.disabled).toBe(true)
    expect(target.querySelector('[data-risu-draft-hook-selector]')?.getAttribute('data-risu-selected-id')).toBe('')
  })

  it('renders the uniquely owned selected chat metadata', async () => {
    seedCharacters([character('character-a', ['chat-a'])])
    component = mount(ChatDraftHookSelector, { target })
    await tick()

    const button = target.querySelector<HTMLButtonElement>('[data-risu-draft-hook-selector] button')
    expect(button?.disabled).toBe(false)
    expect(button?.textContent).toContain('Draft B')
    expect(target.querySelector('[data-risu-draft-hook-selector]')?.getAttribute('data-risu-selected-id')).toBe(
      'draft-b',
    )
  })

  it('reads only canonical owners and scopes the durable write to their selection', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/SideBars/ChatDraftHookSelector.svelte'), 'utf8')

    expect(source).not.toContain('getDatabase')
    expect(source).not.toContain('selectedCharID')
    expect(source).toContain('getSelectedCharacterOwner')
    expect(source).toContain('getChatMetadataOwnerSnapshot')
    expect(source).toContain('settingsResourceState.groupStatuses.advanced')
    expect(source).toContain('selectedChar: selection.selectedCharacter')
    expect(source).toContain('selectedChat: selection.selectedChat')
  })
})
