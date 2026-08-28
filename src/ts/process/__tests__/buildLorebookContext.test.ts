import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import type { OpenAIChat } from '../index.svelte'
import { buildLorebookContext, type UnformatedLorebookSlots } from '../promptAssembly/buildLorebookContext'

interface LoreEntry {
  key?: string
  comment?: string
  content: string
  mode?: 'multiple' | 'constant' | 'normal' | 'child' | 'folder'
  insertorder?: number
  alwaysActive?: boolean
  secondkey?: string
  selective?: boolean
}

function makeChar(globalLore: LoreEntry[] = []): character {
  return {
    type: 'character',
    name: 'Test',
    chaId: 'cha-1',
    desc: '',
    personality: '',
    scenario: '',
    additionalText: '',
    systemPrompt: '',
    replaceGlobalNote: '',
    chatPage: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: globalLore.map((entry) => ({
      key: '',
      secondkey: '',
      insertorder: 100,
      comment: '',
      mode: 'normal',
      alwaysActive: true,
      selective: false,
      ...entry,
    })),
    chaVer: 0,
    firstMessage: '',
    notes: '',
    utilityBot: false,
    sdData: [],
    customscript: [],
    triggerscript: [],
    exampleMessage: '',
    creatorNotes: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    firstMsgIndex: -1,
    chatFolders: [],
    chats: [
      {
        name: 'main',
        note: '',
        localLore: [],
        scriptstate: {},
        fmIndex: -1,
        message: [],
      } as character['chats'][number],
    ],
  } as unknown as character
}

function seedWithLore(globalLore: LoreEntry[] = []) {
  setDatabase({
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar(globalLore)],
  } as unknown as Database)
  selectedCharID.set(0)
}

function emptySlots(): UnformatedLorebookSlots & {
  lorebook: OpenAIChat[]
  description: OpenAIChat[]
  postEverything: OpenAIChat[]
} {
  return {
    lorebook: [],
    description: [],
    postEverything: [],
  }
}

describe('buildLorebookContext - placement', () => {
  beforeEach(() => {
    seedWithLore()
  })

  it('routes normal lore (no pos, no inject) into unformated.lorebook', () => {
    seedWithLore([{ content: 'Plain lore body' }])
    const slots = emptySlots()
    return buildLorebookContext(makeChar(), slots).then(() => {
      expect(slots.lorebook).toEqual([{ role: 'system', content: 'Plain lore body' }])
      expect(slots.description).toEqual([])
      expect(slots.postEverything).toEqual([])
    })
  })

  it('unshifts before_desc lore into unformated.description', async () => {
    seedWithLore([{ content: '@@position before_desc\nBefore' }])
    const slots = emptySlots()
    // Seed description with a prior entry so we can confirm the unshift order.
    slots.description.push({ role: 'system', content: 'PRIOR' })
    await buildLorebookContext(makeChar(), slots)
    expect(slots.description).toEqual([
      { role: 'system', content: 'Before' },
      { role: 'system', content: 'PRIOR' },
    ])
  })

  it('appends after_desc lore into unformated.description', async () => {
    seedWithLore([{ content: '@@position after_desc\nAfter' }])
    const slots = emptySlots()
    slots.description.push({ role: 'system', content: 'PRIOR' })
    await buildLorebookContext(makeChar(), slots)
    expect(slots.description).toEqual([
      { role: 'system', content: 'PRIOR' },
      { role: 'system', content: 'After' },
    ])
  })

  it('routes depth=0 system-role lore into postEverything before assistant-role lore', async () => {
    seedWithLore([{ content: '@@end\nSystem entry' }, { content: '@@end\n@@role assistant\nAssistant entry' }])
    const slots = emptySlots()
    await buildLorebookContext(makeChar(), slots)
    expect(slots.postEverything).toEqual([
      { role: 'system', content: 'System entry' },
      { role: 'assistant', content: 'Assistant entry' },
    ])
  })
})

describe('buildLorebookContext - resolvePosition', () => {
  beforeEach(() => {
    seedWithLore()
  })

  it('substitutes {{position::name}} with the matching pt_<name> slot content', async () => {
    seedWithLore([{ content: '@@position pt_slot\nSlot value' }])
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.resolvePosition('Pre {{position::slot}} Post')).toBe('Pre Slot value Post')
  })

  it('returns text unchanged when no {{position::...}} markers are present', async () => {
    seedWithLore()
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.resolvePosition('plain text')).toBe('plain text')
  })

  it('drops unresolved {{position::...}} markers when no matching slot exists', async () => {
    seedWithLore()
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.resolvePosition('Pre {{position::missing}} Post')).toBe('Pre  Post')
  })
})

describe('buildLorebookContext - positionParser', () => {
  beforeEach(() => {
    seedWithLore()
  })

  it('returns input unchanged through resolvePosition when no inject lore matches', async () => {
    seedWithLore()
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.positionParser('hello', 'unknown_location')).toBe('hello')
  })

  it.each([
    {
      operation: 'append',
      directive: '',
      input: 'BASE',
      expected: 'BASE INJECTED',
    },
    {
      operation: 'prepend',
      directive: '@@inject_prepend\n',
      input: 'BASE',
      expected: 'INJECTED BASE',
    },
    {
      operation: 'replace',
      directive: '@@inject_replace SLOT\n',
      input: 'left SLOT right',
      expected: 'left INJECTED right',
    },
  ])('applies $operation injection at its named location', async ({ directive, input, expected }) => {
    seedWithLore([{ content: `@@inject_at description\n${directive}INJECTED` }])
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.positionParser(input, 'description')).toBe(expected)
    expect(lore.positionParser(input, 'other')).toBe(input)
  })

  it('applies multiple injectors in activation order before resolving named positions', async () => {
    seedWithLore([
      { content: '@@inject_at description\nAPPEND' },
      { content: '@@inject_at description\n@@inject_prepend\nPREPEND' },
      { content: '@@inject_at description\n@@inject_replace SLOT\nREPLACED {{position::slot}}' },
      { content: '@@position pt_slot\nPOSITION' },
    ])
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.positionParser('BASE SLOT', 'description')).toBe('PREPEND BASE REPLACED POSITION APPEND')
  })
})

describe('buildLorebookContext - depthPrompts', () => {
  beforeEach(() => {
    seedWithLore()
  })

  it('returns lore with @@depth > 0 entries', async () => {
    seedWithLore([{ content: '@@depth 2\nAt depth 2' }])
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.depthPrompts).toHaveLength(1)
    expect(lore.depthPrompts[0].pos).toBe('depth')
    expect(lore.depthPrompts[0].depth).toBe(2)
    expect(lore.depthPrompts[0].prompt).toBe('At depth 2')
  })

  it('returns lore with @@reverse_depth entries', async () => {
    seedWithLore([{ content: '@@reverse_depth 1\nReverse' }])
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.depthPrompts).toHaveLength(1)
    expect(lore.depthPrompts[0].pos).toBe('reverse_depth')
  })

  it('excludes @@end (depth=0) entries because those land in postEverything instead', async () => {
    seedWithLore([{ content: '@@end\nAt end' }, { content: '@@depth 1\nAt depth 1' }])
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.depthPrompts).toHaveLength(1)
    expect(lore.depthPrompts[0].prompt).toBe('At depth 1')
  })

  it('excludes normal (positionless, no-inject) entries', async () => {
    seedWithLore([{ content: 'plain' }, { content: '@@depth 3\nDepth 3' }])
    const lore = await buildLorebookContext(makeChar(), emptySlots())
    expect(lore.depthPrompts).toHaveLength(1)
    expect(lore.depthPrompts[0].depth).toBe(3)
  })
})
