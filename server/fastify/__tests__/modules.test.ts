import { describe, expect, it } from 'vitest'
import type { Chat, Database, character, customscript, loreBook } from '../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../src/ts/process/modules'
import { getActiveModules, getModuleLorebooks, getModuleRegexScripts } from '../src/prompt/modules.js'

function makeModule(overrides: Partial<RisuModule> = {}): RisuModule {
  return {
    name: 'mod',
    description: '',
    id: 'mod-1',
    ...overrides,
  } as RisuModule
}

function regex(inPat: string, out: string, type: string): customscript {
  return { comment: '', in: inPat, out, type, ableFlag: false }
}

function lore(overrides: Partial<loreBook> = {}): loreBook {
  return {
    key: '',
    secondkey: '',
    insertorder: 100,
    comment: 'preset',
    content: '',
    mode: 'normal',
    alwaysActive: false,
    selective: false,
    ...overrides,
  }
}

function makeDb(overrides: Partial<Database> = {}): Database {
  return {
    modules: [],
    enabledModules: [],
    moduleIntergration: '',
    ...overrides,
  } as unknown as Database
}

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'char-tess',
    ...overrides,
  } as unknown as character
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    message: [],
    note: '',
    name: 'main',
    localLore: [],
    scriptstate: {},
    fmIndex: -1,
    ...overrides,
  } as unknown as Chat
}

describe('Phase 7-6d getActiveModules', () => {
  it('returns [] when nothing is enabled', () => {
    const db = makeDb({
      modules: [makeModule({ id: 'a' })],
      enabledModules: [],
    })
    expect(getActiveModules(db, undefined, undefined)).toEqual([])
  })

  it('picks up modules from db.enabledModules', () => {
    const a = makeModule({ id: 'a' })
    const b = makeModule({ id: 'b' })
    const db = makeDb({ modules: [a, b], enabledModules: ['b'] })
    expect(getActiveModules(db, undefined, undefined)).toEqual([b])
  })

  it('adds modules from currentChat.modules', () => {
    const a = makeModule({ id: 'a' })
    const b = makeModule({ id: 'b' })
    const db = makeDb({ modules: [a, b], enabledModules: [] })
    const chat = makeChat({ modules: ['b'] } as Partial<Chat>)
    expect(getActiveModules(db, undefined, chat)).toEqual([b])
  })

  it('adds modules from currentChar.modules', () => {
    const a = makeModule({ id: 'a' })
    const b = makeModule({ id: 'b' })
    const db = makeDb({ modules: [a, b], enabledModules: [] })
    const char = makeChar({ modules: ['a'] } as Partial<character>)
    expect(getActiveModules(db, char, undefined)).toEqual([a])
  })

  it('adds modules linked to the Persona selected for the chat', () => {
    const linked = makeModule({ id: 'persona-module' })
    const db = makeDb({
      modules: [linked],
      selectedPersona: 0,
      personas: [
        { id: 'persona-global', name: 'Global', icon: '', personaPrompt: '', modules: [] },
        {
          id: 'persona-chat',
          name: 'Chat',
          icon: '',
          personaPrompt: '',
          modules: ['persona-module'],
        },
      ],
    })
    const currentChat = makeChat({ generationSettings: { personaId: 'persona-chat' } })

    expect(getActiveModules(db, undefined, currentChat)).toEqual([linked])
  })

  it('parses db.moduleIntergration as a comma-separated list', () => {
    const a = makeModule({ id: 'a' })
    const b = makeModule({ id: 'b' })
    const c = makeModule({ id: 'c' })
    const db = makeDb({
      modules: [a, b, c],
      enabledModules: [],
      moduleIntergration: 'a, c ,',
    })
    expect(getActiveModules(db, undefined, undefined).map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('matches against module.namespace as well as module.id', () => {
    const m = makeModule({ id: 'm-uuid', namespace: 'shared' })
    const db = makeDb({ modules: [m], enabledModules: ['shared'] })
    expect(getActiveModules(db, undefined, undefined)).toEqual([m])
  })

  it('dedupes by id when the same module is picked up multiple times', () => {
    const m = makeModule({ id: 'a', namespace: 'shared' })
    const db = makeDb({
      modules: [m],
      enabledModules: ['a', 'shared'],
      moduleIntergration: 'a',
    })
    expect(getActiveModules(db, undefined, undefined)).toEqual([m])
  })
})

describe('Phase 7-6d getModuleRegexScripts', () => {
  it('returns [] when no module has regex', () => {
    const m = makeModule({ id: 'm' })
    expect(getModuleRegexScripts([m])).toEqual([])
  })

  it('concatenates regex from every passed module in order', () => {
    const r1 = regex('a', '1', 'editprocess')
    const r2 = regex('b', '2', 'editprocess')
    const r3 = regex('c', '3', 'editprocess')
    const m1 = makeModule({ id: 'm1', regex: [r1] })
    const m2 = makeModule({ id: 'm2', regex: [r2, r3] })
    expect(getModuleRegexScripts([m1, m2])).toEqual([r1, r2, r3])
  })
})

describe('getModuleLorebooks', () => {
  it('concatenates lorebooks from every passed module in order', () => {
    const l1 = lore({ id: 'l1', content: 'one' })
    const l2 = lore({ id: 'l2', content: 'two' })
    const l3 = lore({ id: 'l3', content: 'three' })
    const m1 = makeModule({ id: 'm1', lorebook: [l1] })
    const m2 = makeModule({ id: 'm2', lorebook: [l2, l3] })

    expect(getModuleLorebooks([m1, m2])).toEqual([l1, l2, l3])
  })
})
