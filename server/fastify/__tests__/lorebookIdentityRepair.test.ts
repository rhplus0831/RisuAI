import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCharacterRecord } from '../src/commands/characters.js'
import { createChatRecord } from '../src/commands/chats.js'
import { createModuleRecord } from '../src/commands/modules.js'

function lorebookEntry(id?: string) {
  return {
    ...(id === undefined ? {} : { id }),
    key: 'seed',
    secondkey: '',
    insertorder: 10,
    comment: 'Lore',
    content: 'Lore content',
    mode: 'normal',
    alwaysActive: false,
    selective: false,
  }
}

function expectRepairedIds(entries: unknown): void {
  expect(Array.isArray(entries)).toBe(true)
  const ids = (entries as Array<{ id?: unknown }>).map((entry) => entry.id)
  expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids[1]).toBe('duplicate')
  expect(ids[2]).not.toBe('duplicate')
}

describe('command create lorebook identity repair', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('repairs missing and duplicate global-lore ids on character create', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const character = createCharacterRecord({
      chaId: 'character-a',
      name: 'Character',
      globalLore: [lorebookEntry(), lorebookEntry('duplicate'), lorebookEntry('duplicate')],
    })

    expectRepairedIds(character.globalLore)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('character character-a.globalLore'))
  })

  it('repairs missing and duplicate local-lore ids on chat create', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chat = createChatRecord({
      id: 'chat-a',
      name: 'Chat',
      note: '',
      message: [],
      localLore: [lorebookEntry(), lorebookEntry('duplicate'), lorebookEntry('duplicate')],
    })

    expectRepairedIds(chat.localLore)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('chat.localLore'))
  })

  it('repairs missing and duplicate lore ids on module create', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const module = createModuleRecord({
      id: 'module-a',
      name: 'Module',
      lorebook: [lorebookEntry(), lorebookEntry('duplicate'), lorebookEntry('duplicate')],
    })

    expectRepairedIds(module.lorebook)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('module.lorebook'))
  })
})
