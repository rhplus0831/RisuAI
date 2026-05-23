import { describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  character,
  loreBook,
} from '../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../src/ts/process/modules'
import { activateLorebook } from '../src/prompt/lorebook.js'

function makeLore(overrides: Partial<loreBook> = {}): loreBook {
  return {
    key: '',
    secondkey: '',
    insertorder: 100,
    comment: '',
    content: '',
    mode: 'normal',
    alwaysActive: true,
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
    globalLore: [],
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

function makeModule(overrides: Partial<RisuModule> = {}): RisuModule {
  return {
    name: 'mod',
    description: '',
    id: 'mod-1',
    ...overrides,
  } as RisuModule
}

describe('Phase 7-7a activateLorebook — sources', () => {
  it('returns no actives when no lore is configured', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar(),
      currentChat: makeChat(),
    })
    expect(report.actives).toEqual([])
    expect(report.disabledUIPrompts).toEqual([])
    expect(report.matchLog).toEqual([])
  })

  it('picks up character.globalLore (alwaysActive)', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({ comment: 'World info', content: 'Quiet seaside village.' }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives).toEqual([
      {
        depth: 0,
        pos: '',
        prompt: 'Quiet seaside village.',
        role: 'system',
        order: 100,
        priority: 100,
        source: 'World info',
        inject: null,
      },
    ])
  })

  it('picks up chat.localLore', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar(),
      currentChat: makeChat({
        localLore: [makeLore({ content: 'Local secret.' })],
      }),
    })
    expect(report.actives).toHaveLength(1)
    expect(report.actives[0].prompt).toBe('Local secret.')
    expect(report.actives[0].source).toBe('lorebook 0')
  })

  it('picks up module lorebooks via getActiveModules', () => {
    const mod = makeModule({
      id: 'mod-A',
      lorebook: [makeLore({ comment: 'Module lore', content: 'Module body.' })],
    })
    const report = activateLorebook({
      database: makeDb({ modules: [mod], enabledModules: ['mod-A'] }),
      currentChar: makeChar(),
      currentChat: makeChat(),
    })
    expect(report.actives).toHaveLength(1)
    expect(report.actives[0]).toMatchObject({
      prompt: 'Module body.',
      source: 'Module lore',
    })
  })

  it('skips entries without alwaysActive (keyword-only entries land in 7-7b)', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'magic',
            content: 'Keyword body.',
          }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives).toEqual([])
  })

  it('skips folder entries', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [makeLore({ mode: 'folder', content: 'ignored' })],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives).toEqual([])
  })
})

describe('Phase 7-7a activateLorebook — decorators', () => {
  it('@@role user flips role and strips the decorator', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [makeLore({ content: '@@role user\nUser-voiced lore' })],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives[0].role).toBe('user')
    expect(report.actives[0].prompt).not.toContain('@@role')
    expect(report.actives[0].prompt).toContain('User-voiced lore')
  })

  it('@@position after_desc sets pos and strips', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [makeLore({ content: '@@position after_desc\nDesc tail' })],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives[0].pos).toBe('after_desc')
    expect(report.actives[0].prompt).not.toContain('@@position')
  })

  it('@@position pt_<name> threads through to a custom slot', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [makeLore({ content: '@@position pt_slot\nSlot value' })],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives[0].pos).toBe('pt_slot')
  })

  it('@@end yields pos=depth, depth=0 (postEverything-bound)', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [makeLore({ content: '@@end\nGoes at end' })],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives[0].pos).toBe('depth')
    expect(report.actives[0].depth).toBe(0)
    expect(report.actives[0].prompt).not.toContain('@@end')
  })

  it('@@priority overrides priority and @@ignore_on_max_context forces -1000', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            comment: 'High',
            insertorder: 100,
            content: '@@priority 5\nHigh-pri',
          }),
          makeLore({
            comment: 'Low',
            insertorder: 100,
            content: '@@ignore_on_max_context\nLow-pri',
          }),
        ],
      }),
      currentChat: makeChat(),
    })
    const byComment = Object.fromEntries(report.actives.map((a) => [a.source, a]))
    expect(byComment.High.priority).toBe(5)
    expect(byComment.Low.priority).toBe(-1000)
  })

  it('sorts by insertorder ascending (after the SPA reverse)', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({ comment: 'Late', insertorder: 200, content: 'late' }),
          makeLore({ comment: 'Early', insertorder: 50, content: 'early' }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives.map((a) => a.source)).toEqual(['Early', 'Late'])
  })

  it('strips multi-decorator stacks without leaving @@-tokens behind', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            content: '@@role assistant\n@@position before_desc\n@@priority 7\nBody',
          }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives[0].prompt).not.toMatch(/@@/)
    expect(report.actives[0].role).toBe('assistant')
    expect(report.actives[0].pos).toBe('before_desc')
    expect(report.actives[0].priority).toBe(7)
  })

  it('@@disable_ui_prompt surfaces in the report and is stripped', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            content: '@@disable_ui_prompt post_history_instructions\nBody',
          }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(report.disabledUIPrompts).toEqual(['post_history_instructions'])
    expect(report.actives[0].prompt).not.toContain('@@disable_ui_prompt')
  })
})

describe('Phase 7-7a activateLorebook — inject_lore', () => {
  it('appends an injector entry onto a sibling identified by comment', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({ comment: 'Target', content: 'base prompt' }),
          makeLore({
            comment: 'Extra',
            content: '@@inject_lore Target\nappended',
          }),
        ],
      }),
      currentChat: makeChat(),
    })
    // Injector itself drops out of the active list; only the target
    // survives with its prompt rewritten.
    expect(report.actives).toHaveLength(1)
    expect(report.actives[0].source).toBe('Target')
    expect(report.actives[0].prompt).toBe('base prompt appended')
  })

  it('inject_replace swaps the param substring on the target', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({ comment: 'Target', content: 'hello SLOT world' }),
          makeLore({
            comment: 'Override',
            content: '@@inject_lore Target\n@@inject_replace SLOT\nFRIEND',
          }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives).toHaveLength(1)
    expect(report.actives[0].prompt).toBe('hello FRIEND world')
  })
})
