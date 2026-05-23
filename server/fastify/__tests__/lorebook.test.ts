import { describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  Message,
  character,
  loreBook,
} from '../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../src/ts/process/modules'
import { activateLorebook } from '../src/prompt/lorebook.js'

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    role: 'user',
    data: '',
    chatId: 'msg-0',
    time: 0,
    ...overrides,
  } as Message
}

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

describe('Phase 7-7b activateLorebook — keyword matching', () => {
  it('activates a keyword entry when a recent message contains the key', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            comment: 'About cats',
            content: 'Cats nap in sunbeams.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    expect(report.actives).toHaveLength(1)
    expect(report.actives[0].source).toBe('About cats')
    expect(report.matchLog).toHaveLength(1)
    expect(report.matchLog[0].activated).toBe('cat')
  })

  it('skips when no recent message contains the key', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'dog',
            content: 'Dogs bark.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    expect(report.actives).toEqual([])
    expect(report.matchLog).toEqual([])
  })

  it('treats `key` as a comma-separated OR list', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'dog, cat',
            content: 'Pets vary.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'I love cats.' })],
      }),
    })
    expect(report.actives).toHaveLength(1)
  })

  it('respects useRegex with /pattern/flags', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            useRegex: true,
            key: '/cat.+sun/i',
            content: 'Sunlit cats.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'CATS love SUN.' })],
      }),
    })
    expect(report.actives).toHaveLength(1)
  })

  it('requires both `key` and `secondkey` when selective is true', () => {
    const baseLore = makeLore({
      alwaysActive: false,
      selective: true,
      key: 'cat',
      secondkey: 'sun',
      content: 'Sunlit cats.',
    })
    const onlyCat = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [baseLore] }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    expect(onlyCat.actives).toEqual([])

    const both = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [baseLore] }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Cats love sun.' })],
      }),
    })
    expect(both.actives).toHaveLength(1)
  })

  it('limits the search to db.loreBookDepth most recent messages', () => {
    const db = makeDb({ loreBookDepth: 1 } as Partial<Database>)
    const messages = [
      makeMessage({ data: 'Old cat message.', chatId: 'm-0' }),
      makeMessage({ data: 'Newer dog message.', chatId: 'm-1' }),
    ]
    const report = activateLorebook({
      database: db,
      currentChar: makeChar({
        globalLore: [
          makeLore({ alwaysActive: false, key: 'cat', content: 'Cat body.' }),
        ],
      }),
      currentChat: makeChat({ message: messages }),
    })
    expect(report.actives).toEqual([])
  })

  it('@@additional_keys adds a required AND-combined query (SPA semantics)', () => {
    const lore = makeLore({
      alwaysActive: false,
      key: 'dog',
      content: '@@additional_keys cat\nPet lore.',
    })

    const justDog = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [lore] }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'A dog ran by.' })],
      }),
    })
    // `cat` query has no hit; AND-required, so activation fails.
    expect(justDog.actives).toEqual([])

    const both = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [lore] }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'My dog and my cat play.' })],
      }),
    })
    expect(both.actives).toHaveLength(1)
    expect(both.actives[0].prompt).not.toContain('@@additional_keys')
  })

  it('@@exclude_keys blocks activation when the excluded key matches', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            content: '@@exclude_keys angry\nCats nap.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Angry cat hisses.' })],
      }),
    })
    expect(report.actives).toEqual([])
  })

  it('@@match_full_word distinguishes whole-word vs substring', () => {
    const partial = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            content: '@@match_full_word\nWhole word only.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'I concatenate strings.' })],
      }),
    })
    expect(partial.actives).toEqual([])

    const whole = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            content: '@@match_full_word\nWhole word only.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'My cat napped.' })],
      }),
    })
    expect(whole.actives).toHaveLength(1)
  })

  it('@@scan_depth overrides the default search window', () => {
    const messages = [
      makeMessage({ data: 'Old cat note.', chatId: 'm-0' }),
      makeMessage({ data: 'New unrelated note.', chatId: 'm-1' }),
    ]
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            content: '@@scan_depth 1\nCat body.',
          }),
        ],
      }),
      currentChat: makeChat({ message: messages }),
    })
    expect(report.actives).toEqual([])
  })

  it('child mode mirrors the previous parent when the parent did not fire', () => {
    const parent = makeLore({
      id: 'shared-id',
      alwaysActive: false,
      key: 'dog',
      comment: 'Parent',
      content: 'Parent body.',
    })
    const child = makeLore({
      id: 'shared-id',
      mode: 'child',
      // alwaysActive=true is what the SPA's UI sets on child entries
      // so they pass the `!alwaysActive && !key` early gate
      // (lorebook.svelte.ts:269) and reach the mirror branch.
      alwaysActive: true,
      key: '',
      comment: 'placeholder',
      content: 'placeholder',
    })
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [parent, child] }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'No matching keyword here.' })],
      }),
    })
    // Parent's `dog` keyword doesn't match, so the child takes over
    // and mirrors parent's content + force-activates.
    expect(report.actives).toHaveLength(1)
    expect(report.actives[0].source).toBe('Parent')
    expect(report.actives[0].prompt).toBe('Parent body.')
  })

  it('@@activate_only_after blocks activation when chatLength is below the threshold', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            content: '@@activate_only_after 5\nLater-only.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Cats are great.' })],
      }),
    })
    // chatLength = 1 + 1 = 2 < 5 -> blocked
    expect(report.actives).toEqual([])
  })

  it('@@is_greeting only fires when fmIndex + 1 matches the arg', () => {
    const lore = makeLore({
      alwaysActive: true,
      content: '@@is_greeting 2\nGreeting-only.',
    })
    const matchingChat = makeChat({ fmIndex: 1 })
    const skipChat = makeChat({ fmIndex: 0 })

    const matched = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [lore] }),
      currentChat: matchingChat,
    })
    expect(matched.actives).toHaveLength(1)

    const skipped = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [lore] }),
      currentChat: skipChat,
    })
    expect(skipped.actives).toEqual([])
  })

  it('@@probability 100 always activates, @@probability 0 never does', () => {
    const always = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({ content: '@@probability 100\nAlways.' }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(always.actives).toHaveLength(1)

    const never = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({ content: '@@probability 0\nNever.' }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(never.actives).toEqual([])
  })

  it('@@activate forces a non-matching keyword entry on, @@dont_activate forces always-on off', () => {
    const forcedOn = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'dog',
            content: '@@activate\nForced.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'No matching keyword.' })],
      }),
    })
    expect(forcedOn.actives).toHaveLength(1)

    const forcedOff = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: true,
            content: '@@dont_activate\nSuppressed.',
          }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(forcedOff.actives).toEqual([])
  })

  it('@@keep_activate_after_match writes the chat-var and re-activates on the next pass', () => {
    const lore = makeLore({
      id: 'lore-keep',
      alwaysActive: false,
      key: 'cat',
      content: '@@keep_activate_after_match\nSticky.',
    })
    const chat = makeChat({
      message: [makeMessage({ data: 'Tell me about cats.' })],
    })

    const first = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [lore] }),
      currentChat: chat,
    })
    expect(first.actives).toHaveLength(1)
    expect(chat.scriptstate?.['$__internal_ka_lore-keep']).toBe('true')
    // The decorator is stripped from the body by ccardlib; only the
    // `$__internal_ka_*` chat-var carries forward to the next pass.
    expect(first.actives[0].prompt).toBe('Sticky.')

    const second = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [lore] }),
      // chat has the persisted scriptstate; no keyword in messages.
      currentChat: { ...chat, message: [makeMessage({ data: 'unrelated' })] } as Chat,
    })
    expect(second.actives).toHaveLength(1)
  })

  it('falls back to pickHashRand for the chat-var key when entry.id is absent', () => {
    const lore = makeLore({
      alwaysActive: false,
      key: 'cat',
      content: '@@keep_activate_after_match\nNoIdSticky.',
    })
    const chat = makeChat({
      message: [makeMessage({ data: 'Tell me about cats.' })],
    })

    activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [lore] }),
      currentChat: chat,
    })

    const keys = Object.keys(chat.scriptstate ?? {})
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^\$__internal_ka_-?\d/)
  })

  it('matchLog records the matched key with SPA-shaped source labels', () => {
    const report = activateLorebook({
      database: makeDb({ username: 'Alex' } as Partial<Database>),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            content: 'Cats.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    expect(report.matchLog).toEqual([
      {
        activated: 'cat',
        source: 'message 0 by user',
        prompt: '\x01{{alex}}:tell me about cats.\x01',
      },
    ])
  })
})