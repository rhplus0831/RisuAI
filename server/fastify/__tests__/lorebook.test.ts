import { beforeAll, describe, expect, it } from 'vitest'
import type { Chat, Database, Message, character, loreBook } from '../../../src/ts/storage/database.svelte'
import type { RisuModule } from '../../../src/ts/process/modules'
import {
  activateLorebook,
  activateLorebookAsync,
  buildLorebookContext,
  getLorebookSearchEntryListInstrumentation,
  getLorebookSearchNormalizationInstrumentation,
  resetLorebookSearchEntryListInstrumentation,
  resetLorebookSearchNormalizationInstrumentation,
  type UnformatedLorebookSlots,
} from '../src/prompt/lorebook.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import type { ExpandContext } from '../src/prompt/variables.js'

beforeAll(() => {
  bootPromptVariables()
})

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

describe('activateLorebook — sources', () => {
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
        globalLore: [makeLore({ comment: 'World info', content: 'Quiet seaside village.' })],
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
        tokens: 4,
        source: 'World info',
        inject: null,
      },
    ])
  })

  it('categorically excludes Agent-only entries from normal lorebook activation', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            comment: 'Agent Reference',
            content: 'Must never enter the main prompt.',
            key: 'reference',
            alwaysActive: true,
            agentOnly: true,
          }),
        ],
      }),
      currentChat: makeChat(),
    })

    expect(report.actives).toEqual([])
    expect(report.matchLog).toEqual([])
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

describe('activateLorebook — decorators', () => {
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

describe('activateLorebook — inject_lore', () => {
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

describe('activateLorebook — inject_at', () => {
  it.each([
    {
      name: 'append',
      decorators: '@@inject_at globalNote',
      operation: 'append' as const,
      param: '',
    },
    {
      name: 'prepend',
      decorators: '@@inject_at main\n@@inject_prepend',
      operation: 'prepend' as const,
      param: '',
    },
    {
      name: 'replace',
      decorators: '@@inject_at description\n@@inject_replace SLOT',
      operation: 'replace' as const,
      param: 'SLOT',
    },
  ])('retains a non-lore $name injector for template rendering', ({ decorators, operation, param }) => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [makeLore({ content: `${decorators}\nInjected body` })],
      }),
      currentChat: makeChat(),
    })

    expect(report.actives).toHaveLength(1)
    expect(report.actives[0]).toMatchObject({
      prompt: 'Injected body',
      inject: {
        operation,
        location: operation === 'append' ? 'globalNote' : operation === 'prepend' ? 'main' : 'description',
        param,
        lore: false,
      },
    })
  })
})

describe('activateLorebook — keyword matching', () => {
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

  it('parses slash-delimited regex keys with an empty flag set', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            useRegex: true,
            key: '/cat.+sun/',
            content: 'Sunlit cats.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'A cat naps under the sun.' })],
      }),
    })

    expect(report.actives.map((entry) => entry.prompt)).toEqual(['Sunlit cats.'])
    expect(report.matchLog.map((entry) => entry.activated)).toEqual(['/cat.+sun/'])
  })

  it('valid imported lorebook useRegex output remains unchanged under bounds', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            useRegex: true,
            key: '/cat\\s+(?:under|beside)\\s+sun/i',
            comment: 'regex lore',
            content: 'Sunlit cats.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'The CAT under SUN naps.' })],
      }),
    })

    expect(report.actives.map((entry) => entry.prompt)).toEqual(['Sunlit cats.'])
    expect(report.matchLog).toEqual([
      {
        activated: '/cat\\s+(?:under|beside)\\s+sun/i',
        prompt: '\x01{{user}}:The CAT under SUN naps.\x01',
        source: 'message 0 by user',
      },
    ])
  })

  it('imported lorebook useRegex rejects unsafe keys before search', () => {
    expect(() =>
      activateLorebook({
        database: makeDb(),
        currentChar: makeChar({
          globalLore: [
            makeLore({
              alwaysActive: false,
              useRegex: true,
              key: '/(a+)+$/',
              content: 'Never reaches search.',
            }),
          ],
        }),
        currentChat: makeChat({
          message: [makeMessage({ data: 'a'.repeat(32) + '!' })],
        }),
      }),
    ).toThrow(/bounded regex rejected: lorebook useRegex key: complexity screen/)
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
        globalLore: [makeLore({ alwaysActive: false, key: 'cat', content: 'Cat body.' })],
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

  it('treats a bare @@exclude_keys_all as an empty all-match and suppresses the entry', async () => {
    const input = {
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            content: '@@exclude_keys_all\nCats nap.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'A cat naps nearby.' })],
      }),
    }

    expect(activateLorebook(input).actives).toEqual([])
    expect((await activateLorebookAsync(input)).actives).toEqual([])
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
        globalLore: [makeLore({ content: '@@probability 100\nAlways.' })],
      }),
      currentChat: makeChat(),
    })
    expect(always.actives).toHaveLength(1)

    const never = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [makeLore({ content: '@@probability 0\nNever.' })],
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

  it('@@keep_activate_after_match reads its sticky key from template defaults', () => {
    const lore = makeLore({
      id: 'lore-default-keep',
      alwaysActive: false,
      key: 'cat',
      content: '@@keep_activate_after_match\nDefault sticky.',
    })
    const currentChar = makeChar({ globalLore: [lore] })
    const report = activateLorebook({
      database: makeDb({ templateDefaultVariables: '__internal_ka_lore-default-keep=true' }),
      currentChar,
      currentChat: makeChat({ message: [makeMessage({ data: 'unrelated' })] }),
    })

    expect(report.actives).toHaveLength(1)
    expect(report.actives[0].prompt).toBe('Default sticky.')
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

describe('activateLorebook — recursion', () => {
  it('chains A -> B: B fires on the second pass via A activated body', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            comment: 'A',
            content: 'A body mentions dog.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'dog',
            comment: 'B',
            content: 'B body about dogs.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    const sources = report.actives.map((a) => a.source).sort()
    expect(sources).toEqual(['A', 'B'])
    expect(report.matchLog.find((m) => m.activated === 'dog')?.source).toBe('lorebook A')
  })

  it('deep chain A -> B -> C activates all three across three passes', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'alpha',
            comment: 'A',
            content: 'A links to bravo.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'bravo',
            comment: 'B',
            content: 'B links to charlie.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'charlie',
            comment: 'C',
            content: 'C body.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Start with alpha.' })],
      }),
    })
    expect(report.actives.map((a) => a.source).sort()).toEqual(['A', 'B', 'C'])
  })

  it('a constant entry seeds the recursive layer without any user message', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: true,
            comment: 'Always',
            content: 'Always-on body mentions secret.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'secret',
            comment: 'Followup',
            content: 'Followup body.',
          }),
        ],
      }),
      currentChat: makeChat({ message: [] }),
    })
    expect(report.actives.map((a) => a.source).sort()).toEqual(['Always', 'Followup'])
  })

  it('global loreSettings.recursiveScanning=false suppresses the chain', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        loreSettings: {
          tokenBudget: 800,
          scanDepth: 5,
          recursiveScanning: false,
        },
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            comment: 'A',
            content: 'A body mentions dog.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'dog',
            comment: 'B',
            content: 'B body.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    expect(report.actives.map((a) => a.source)).toEqual(['A'])
  })

  it('@@unrecursive on the parent blocks the chain even when global is true', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            comment: 'A',
            content: '@@unrecursive\nA mentions dog.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'dog',
            comment: 'B',
            content: 'B body.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    expect(report.actives.map((a) => a.source)).toEqual(['A'])
  })

  it('@@recursive on an entry overrides a globally-disabled recursiveScanning', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        loreSettings: {
          tokenBudget: 800,
          scanDepth: 5,
          recursiveScanning: false,
        },
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            comment: 'A',
            content: '@@recursive\nA mentions dog.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'dog',
            comment: 'B',
            content: 'B body.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    expect(report.actives.map((a) => a.source).sort()).toEqual(['A', 'B'])
  })

  it('@@no_recursive_search makes one entry ignore the recursive layer only', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'cat',
            comment: 'A',
            content: 'A body mentions dog.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'dog',
            comment: 'B',
            content: '@@no_recursive_search\nB body.',
          }),
        ],
      }),
      currentChat: makeChat({
        message: [makeMessage({ data: 'Tell me about cats.' })],
      }),
    })
    // B's keyword `dog` lives only in A's recursive entry; with
    // @@no_recursive_search B's search skips that layer and the
    // real message has no `dog`, so B never fires.
    expect(report.actives.map((a) => a.source)).toEqual(['A'])
  })

  it('terminates when always-on entries mention each other', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({ alwaysActive: true, comment: 'A', content: 'mentions B and C' }),
          makeLore({ alwaysActive: true, comment: 'B', content: 'mentions A and C' }),
          makeLore({ alwaysActive: true, comment: 'C', content: 'mentions A and B' }),
        ],
      }),
      currentChat: makeChat({ message: [] }),
    })
    // Each entry can only fire once; the loop terminates cleanly.
    expect(report.actives).toHaveLength(3)
    expect(report.actives.map((a) => a.source).sort()).toEqual(['A', 'B', 'C'])
  })
})

import {
  getDepthPrompts,
  resolvePosition,
  type LoreEntryActive,
  type LorebookActivationReport,
} from '../src/prompt/lorebook.js'

function makeActive(overrides: Partial<LoreEntryActive> = {}): LoreEntryActive {
  return {
    depth: 0,
    pos: '',
    prompt: '',
    role: 'system',
    order: 100,
    priority: 100,
    tokens: 0,
    source: '',
    inject: null,
    ...overrides,
  }
}

function makeReport(actives: LoreEntryActive[]): LorebookActivationReport {
  return { actives, disabledUIPrompts: [], matchLog: [] }
}

describe('getDepthPrompts', () => {
  it('keeps `pos=depth` entries with depth > 0', () => {
    const r = makeReport([
      makeActive({ pos: 'depth', depth: 1, source: 'a' }),
      makeActive({ pos: 'depth', depth: 3, source: 'b' }),
    ])
    expect(getDepthPrompts(r).map((a) => a.source)).toEqual(['a', 'b'])
  })

  it('keeps `pos=reverse_depth` entries (any depth)', () => {
    const r = makeReport([
      makeActive({ pos: 'reverse_depth', depth: 0, source: 'a' }),
      makeActive({ pos: 'reverse_depth', depth: 2, source: 'b' }),
    ])
    expect(getDepthPrompts(r).map((a) => a.source)).toEqual(['a', 'b'])
  })

  it('excludes `pos=depth` with depth === 0 (those land in postEverything)', () => {
    const r = makeReport([
      makeActive({ pos: 'depth', depth: 0, source: 'end' }),
      makeActive({ pos: 'depth', depth: 1, source: 'd1' }),
    ])
    expect(getDepthPrompts(r).map((a) => a.source)).toEqual(['d1'])
  })

  it('excludes other positions (`""`, `after_desc`, `pt_*`, etc.)', () => {
    const r = makeReport([
      makeActive({ pos: '', source: 'plain' }),
      makeActive({ pos: 'after_desc', source: 'desc' }),
      makeActive({ pos: 'pt_slot', source: 'slot' }),
      makeActive({ pos: 'depth', depth: 2, source: 'd2' }),
    ])
    expect(getDepthPrompts(r).map((a) => a.source)).toEqual(['d2'])
  })
})

describe('resolvePosition', () => {
  it('substitutes {{position::name}} with the matching pt_<name> body', () => {
    const r = makeReport([makeActive({ pos: 'pt_slot', prompt: 'SLOT VALUE' })])
    expect(resolvePosition('before {{position::slot}} after', r)).toBe('before SLOT VALUE after')
  })

  it('joins multiple pt_<name> matches with newlines', () => {
    const r = makeReport([makeActive({ pos: 'pt_slot', prompt: 'A' }), makeActive({ pos: 'pt_slot', prompt: 'B' })])
    expect(resolvePosition('{{position::slot}}', r)).toBe('A\nB')
  })

  it('resolves transitive references up to maxDepth', () => {
    // pt_outer body itself contains {{position::inner}}, which resolves
    // to "INNER" on the second pass.
    const r = makeReport([
      makeActive({ pos: 'pt_outer', prompt: 'wrapping {{position::inner}}' }),
      makeActive({ pos: 'pt_inner', prompt: 'INNER' }),
    ])
    expect(resolvePosition('{{position::outer}}', r)).toBe('wrapping INNER')
  })

  it('strips unresolved markers after the nesting cap', () => {
    // pt_loop references itself; after 5 passes the marker is stripped.
    const r = makeReport([makeActive({ pos: 'pt_loop', prompt: '{{position::loop}}' })])
    expect(resolvePosition('{{position::loop}}', r)).toBe('')
  })

  it('strips markers with no matching pt_ entry', () => {
    expect(resolvePosition('a {{position::missing}} b', makeReport([]))).toBe('a  b')
  })
})

describe('activateLorebook — budget truncation', () => {
  it('attaches per-entry tokens under the default cl100k_base encoding', () => {
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          // 'high priority entry' tokenizes to 3 on cl100k_base.
          makeLore({ comment: 'a', content: 'high priority entry' }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives).toHaveLength(1)
    expect(report.actives[0].tokens).toBe(3)
  })

  it('counts CBS-evaluated content for cutoff without firing variable writes', () => {
    const currentChat = makeChat({ scriptstate: {} })
    const collapsedBranch = 'large hidden branch '.repeat(40)
    const currentChar = makeChar({
      chatPage: 0,
      chats: [currentChat],
      globalLore: [
        makeLore({
          comment: 'collapsed',
          content: `{{#if 0}}{{setvar::preflightGuard::changed}}${collapsedBranch}{{/}}tiny`,
        }),
      ],
      loreSettings: { tokenBudget: 1, scanDepth: 5, recursiveScanning: true },
    })
    const database = makeDb({ characters: [currentChar], currentChar: 0 } as Partial<Database>)

    const report = activateLorebook({ database, currentChar, currentChat })

    expect(report.actives).toHaveLength(1)
    expect(report.actives[0]).toMatchObject({ source: 'collapsed', tokens: 1 })
    expect(report.actives[0].prompt).toContain(collapsedBranch)
    expect(currentChat.scriptstate).toEqual({})
  })

  it('rejects raw-small CBS source when its evaluated content exceeds the cutoff', () => {
    const currentChat = makeChat()
    const currentChar = makeChar({
      chatPage: 0,
      chats: [currentChat],
      desc: 'large expanded description '.repeat(40),
      globalLore: [makeLore({ comment: 'expanded', content: '{{description}}' })],
      loreSettings: { tokenBudget: 2, scanDepth: 5, recursiveScanning: true },
    })
    const database = makeDb({ characters: [currentChar], currentChar: 0 } as Partial<Database>)

    const report = activateLorebook({ database, currentChar, currentChat })

    expect(report.actives).toEqual([])
  })

  it('routes to o200k_base when the database model is in the o200k prefix list', () => {
    // `café résumé 漢字` diverges: cl100k_base → 9, o200k_base → 6.
    const lore = makeLore({ comment: 'a', content: 'café résumé 漢字' })
    const cl = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({ globalLore: [lore] }),
      currentChat: makeChat(),
    })
    const o200 = activateLorebook({
      database: makeDb({ aiModel: 'gpt-4o' }),
      currentChar: makeChar({ globalLore: [lore] }),
      currentChat: makeChat(),
    })
    expect(cl.actives[0].tokens).toBe(9)
    expect(o200.actives[0].tokens).toBe(6)
  })

  it('keeps highest-priority entries until the budget is exhausted', () => {
    // Each body is 3 tokens on cl100k_base; budget 7 fits two and
    // drops the third.
    const lores = [
      makeLore({
        comment: 'high',
        content: 'high priority entry',
        insertorder: 1,
      }),
      makeLore({
        comment: 'mid',
        content: 'mid priority entry',
        insertorder: 2,
      }),
      makeLore({
        comment: 'low',
        content: 'low priority entry',
        insertorder: 3,
      }),
    ]
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: lores,
        loreSettings: { tokenBudget: 7, scanDepth: 5, recursiveScanning: true },
      }),
      currentChat: makeChat(),
    })
    // SPA priority defaults to insertorder, so 'low' (3) ranks above
    // 'mid' (2) and 'high' (1). The 7-token budget fits two 3-token
    // entries; the final `survivors.reverse()` flips order-desc into
    // ascending insertorder, putting 'mid' before 'low'.
    expect(report.actives.map((a) => a.source)).toEqual(['mid', 'low'])
  })

  it('drops @@ignore_on_max_context entries first via the -1000 priority demotion', () => {
    // Budget 3 holds exactly one 3-token entry. The ignored entry's
    // decorator demotes priority to -1000, so it sorts last and is
    // dropped first.
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            comment: 'ignored',
            content: '@@ignore_on_max_context\nhigh priority entry',
          }),
          makeLore({
            comment: 'kept',
            content: 'mid priority entry',
          }),
        ],
        loreSettings: { tokenBudget: 3, scanDepth: 5, recursiveScanning: true },
      }),
      currentChat: makeChat(),
    })
    expect(report.actives.map((a) => a.source)).toEqual(['kept'])
  })

  it('falls back to database.loreBookToken when loreSettings.tokenBudget is missing', () => {
    const report = activateLorebook({
      database: makeDb({ loreBookToken: 3 } as Partial<Database>),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            comment: 'high',
            content: 'high priority entry',
            insertorder: 10,
          }),
          makeLore({
            comment: 'low',
            content: 'low priority entry',
            insertorder: 1,
          }),
        ],
      }),
      currentChat: makeChat(),
    })
    expect(report.actives.map((a) => a.source)).toEqual(['high'])
  })

  it('re-sorts survivors by order desc after the budget filter', () => {
    // Two 3-token entries both fit a 6-token budget; surviving order
    // should be insertorder desc, not priority desc.
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            comment: 'low-order',
            content: 'high priority entry',
            insertorder: 1,
          }),
          makeLore({
            comment: 'high-order',
            content: 'mid priority entry',
            insertorder: 10,
          }),
        ],
        loreSettings: { tokenBudget: 6, scanDepth: 5, recursiveScanning: true },
      }),
      currentChat: makeChat(),
    })
    // After the SPA's final reverse() the assembly-facing order is
    // ascending by `order`, so the low-order entry comes first.
    expect(report.actives.map((a) => a.source)).toEqual(['low-order', 'high-order'])
  })

  it('skips an oversized high-priority entry and admits a lower-priority entry that fits', () => {
    // SPA semantics: the filter is sequential through priority-desc;
    // an entry that doesn't fit is rejected, but a later (lower-priority)
    // entry that *does* fit still slips in.
    const report = activateLorebook({
      database: makeDb(),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            comment: 'oversized',
            content: 'high priority entry mid priority entry low priority entry',
            insertorder: 10,
          }),
          makeLore({
            comment: 'fits',
            content: 'short',
            insertorder: 1,
          }),
        ],
        loreSettings: { tokenBudget: 4, scanDepth: 5, recursiveScanning: true },
      }),
      currentChat: makeChat(),
    })
    // 'oversized' (9 tokens) > 4 → rejected; 'fits' (1 token) ≤ 4 → kept.
    expect(report.actives.map((a) => a.source)).toEqual(['fits'])
  })
})

describe('buildLorebookContext', () => {
  const ctxFor = (): ExpandContext => ({
    database: makeDb({ characters: [makeChar()], currentChar: 0 } as Partial<Database>),
  })

  const makeActive = (overrides: Partial<LoreEntryActive>): LoreEntryActive => ({
    depth: 0,
    pos: '',
    prompt: '',
    role: 'system',
    order: 0,
    priority: 0,
    tokens: 0,
    source: '',
    inject: null,
    ...overrides,
  })

  const makeReport = (actives: LoreEntryActive[]): LorebookActivationReport => ({
    actives,
    disabledUIPrompts: [],
    matchLog: [],
  })

  const emptySlots = (
    description: { role: 'system' | 'user' | 'assistant'; content: string }[] = [],
  ): UnformatedLorebookSlots => ({
    lorebook: [],
    description: [...description],
    postEverything: [],
  })

  it('routes entries to slots by position', () => {
    const slots = emptySlots([{ role: 'system', content: 'EXISTING' }])
    buildLorebookContext(
      ctxFor(),
      makeChar(),
      makeReport([
        makeActive({ pos: '', prompt: 'CONST' }),
        makeActive({ pos: 'after_desc', prompt: 'AFTER' }),
        makeActive({ pos: 'before_desc', prompt: 'BEFORE' }),
        makeActive({ pos: 'depth', depth: 0, prompt: 'POST' }),
      ]),
      slots,
    )
    expect(slots.lorebook.map((r) => r.content)).toEqual(['CONST'])
    // before_desc unshifts ahead of the existing row; after_desc pushes after.
    expect(slots.description.map((r) => r.content)).toEqual(['BEFORE', 'EXISTING', 'AFTER'])
    expect(slots.postEverything.map((r) => r.content)).toEqual(['POST'])
  })

  it('keeps the assistant prefill last in postEverything', () => {
    const slots = emptySlots()
    buildLorebookContext(
      ctxFor(),
      makeChar(),
      makeReport([
        makeActive({ pos: 'depth', depth: 0, role: 'assistant', prompt: 'PREFILL' }),
        makeActive({ pos: 'depth', depth: 0, role: 'system', prompt: 'SYS' }),
      ]),
      slots,
    )
    expect(slots.postEverything.map((r) => r.content)).toEqual(['SYS', 'PREFILL'])
  })

  it('returns only depth>0 / reverse_depth entries as depthPrompts', () => {
    const { depthPrompts } = buildLorebookContext(
      ctxFor(),
      makeChar(),
      makeReport([
        makeActive({ pos: 'depth', depth: 2, prompt: 'D2' }),
        makeActive({ pos: 'reverse_depth', depth: 1, prompt: 'RD' }),
        makeActive({ pos: 'depth', depth: 0, prompt: 'D0' }),
      ]),
      emptySlots(),
    )
    expect(depthPrompts.map((d) => d.prompt)).toEqual(['D2', 'RD'])
  })

  it('builds a positionParser that resolves {{position::}} markers', () => {
    const { positionParser } = buildLorebookContext(
      ctxFor(),
      makeChar(),
      makeReport([makeActive({ pos: 'pt_x', prompt: 'XVAL' })]),
      emptySlots(),
    )
    expect(positionParser('a {{position::x}} b', 'anyloc')).toBe('a XVAL b')
  })

  it('applies append, prepend, and replace injectors at their target locations', () => {
    const { positionParser } = buildLorebookContext(
      ctxFor(),
      makeChar(),
      makeReport([
        makeActive({
          prompt: 'APPEND {{position::suffix}}',
          inject: { operation: 'append', location: 'globalNote', param: '', lore: false },
        }),
        makeActive({
          prompt: 'PREPEND',
          inject: { operation: 'prepend', location: 'main', param: '', lore: false },
        }),
        makeActive({
          prompt: 'REPLACEMENT',
          inject: { operation: 'replace', location: 'description', param: 'SLOT', lore: false },
        }),
        makeActive({ pos: 'pt_suffix', prompt: 'SUFFIX' }),
      ]),
      emptySlots(),
    )

    expect(positionParser('BASE', 'globalNote')).toBe('BASE APPEND SUFFIX')
    expect(positionParser('BASE', 'main')).toBe('PREPEND BASE')
    expect(positionParser('left SLOT right', 'description')).toBe('left REPLACEMENT right')
    expect(positionParser('UNCHANGED', 'authornote')).toBe('UNCHANGED')
  })

  it('resolves {{position::}} inside a distributed row before expanding', () => {
    const slots = emptySlots()
    buildLorebookContext(
      ctxFor(),
      makeChar(),
      makeReport([makeActive({ pos: '', prompt: 'hi {{position::y}}' }), makeActive({ pos: 'pt_y', prompt: 'YY' })]),
      slots,
    )
    expect(slots.lorebook.map((r) => r.content)).toEqual(['hi YY'])
  })
})
// L3 (Phase 7): the recursive activation loop re-runs `searchMatch` over the
// same regex-form keys once per pass × per message; the compiled key regex is
// memoized so one activation compiles each key string at most once. Compile
// counts are observed by swapping the global RegExp constructor for a counting
// subclass — `new RegExp(...)` in the cache miss path resolves the global
// binding at call time.
function countRegexCompiles<T>(fn: () => T): { result: T; compiles: Map<string, number> } {
  const RealRegExp = globalThis.RegExp
  const compiles = new Map<string, number>()
  class CountingRegExp extends RealRegExp {
    constructor(pattern: string | RegExp, flags?: string) {
      super(pattern as string, flags)
      const key = typeof pattern === 'string' ? pattern : pattern.source
      compiles.set(key, (compiles.get(key) ?? 0) + 1)
    }
  }
  ;(globalThis as { RegExp: RegExpConstructor }).RegExp = CountingRegExp as unknown as RegExpConstructor
  try {
    return { result: fn(), compiles }
  } finally {
    ;(globalThis as { RegExp: RegExpConstructor }).RegExp = RealRegExp
  }
}

describe('lorebook keyword regex memoization', () => {
  it('compiles each regex key once across messages, recursive passes, and entries', () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      makeMessage({ data: `filler message ${i} l3-needle-${i}`, chatId: `l3-m-${i}` }),
    )
    const { result: report, compiles } = countRegexCompiles(() =>
      activateLorebook({
        database: makeDb({ loreBookDepth: 8 } as Partial<Database>),
        currentChar: makeChar({
          globalLore: [
            // Activates on the real messages; its content feeds the recursive layer.
            makeLore({
              alwaysActive: false,
              useRegex: true,
              key: '/l3-needle-[0-9]+/i',
              content: 'recursive body with l3-bridge token.',
            }),
            // Activates only via the recursive layer (second pass).
            makeLore({
              alwaysActive: false,
              useRegex: true,
              key: '/l3-bridge/',
              content: 'Second-layer body.',
            }),
            // Never matches: searched against every message on every pass.
            makeLore({
              alwaysActive: false,
              useRegex: true,
              key: '/l3-never-matches-zzz/',
              content: 'Never activates.',
            }),
          ],
        }),
        currentChat: makeChat({ message: messages }),
      }),
    )

    // Both reachable entries activated (the second through recursion).
    expect(report.actives.map((a) => a.prompt).sort()).toEqual([
      'Second-layer body.',
      'recursive body with l3-bridge token.',
    ])
    // Each key string compiled exactly once for the whole activation.
    expect(compiles.get('l3-needle-[0-9]+')).toBe(1)
    expect(compiles.get('l3-bridge')).toBe(1)
    expect(compiles.get('l3-never-matches-zzz')).toBe(1)
  })

  it('a malformed regex key still deactivates the query without throwing (cached miss)', () => {
    const run = () =>
      activateLorebook({
        database: makeDb(),
        currentChar: makeChar({
          globalLore: [
            makeLore({
              alwaysActive: false,
              useRegex: true,
              key: '/l3-unclosed(/',
              content: 'Never activates.',
            }),
          ],
        }),
        currentChat: makeChat({
          message: [makeMessage({ data: 'l3-unclosed( literal text' })],
        }),
      })
    // Twice: once compiling (and caching the failure), once from the cache.
    expect(run().actives).toEqual([])
    expect(run().actives).toEqual([])
  })
})

describe('lorebook search normalization', () => {
  it('normalizes base searchable messages once across recursive search passes', () => {
    resetLorebookSearchNormalizationInstrumentation()
    const messages = Array.from({ length: 6 }, (_, i) =>
      makeMessage({
        data: i === 5 ? 'Alpha {{comment:hidden}} seed with filler.' : `filler ${i} {{//ignored}}`,
        chatId: `l5-m-${i}`,
      }),
    )

    const report = activateLorebook({
      database: makeDb({ loreBookDepth: 6 } as Partial<Database>),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'alpha',
            comment: 'A',
            content: 'A recursive body mentions bravo.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'bravo',
            comment: 'B',
            content: 'B recursive body mentions charlie.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'charlie',
            comment: 'C',
            content: 'C body.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'never-matches-l5',
            comment: 'D',
            content: 'D body.',
          }),
        ],
      }),
      currentChat: makeChat({ message: messages }),
    })

    expect(report.actives.map((a) => a.source).sort()).toEqual(['A', 'B', 'C'])
    expect(report.matchLog.map((entry) => entry.activated)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(getLorebookSearchNormalizationInstrumentation()).toEqual({
      baseMessageNormalizations: messages.length,
      recursivePromptNormalizations: 3,
    })
  })
})

describe('lorebook search entry lists', () => {
  it('preserves recursive activation output without per-query combined arrays', () => {
    resetLorebookSearchEntryListInstrumentation()
    const messages = Array.from({ length: 6 }, (_, i) =>
      makeMessage({
        data: i === 5 ? 'Alpha seed with filler.' : `filler ${i}`,
        chatId: `l7-m-${i}`,
      }),
    )

    const report = activateLorebook({
      database: makeDb({ loreBookDepth: 6 } as Partial<Database>),
      currentChar: makeChar({
        globalLore: [
          makeLore({
            alwaysActive: false,
            key: 'alpha',
            comment: 'A',
            content: 'A recursive body mentions bravo.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'bravo',
            comment: 'B',
            content: 'B recursive body mentions charlie.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'charlie',
            comment: 'C',
            content: 'C body.',
          }),
          makeLore({
            alwaysActive: false,
            key: 'never-matches-l7',
            comment: 'D',
            content: 'D body.',
          }),
        ],
      }),
      currentChat: makeChat({ message: messages }),
    })

    expect(report.actives.map((a) => a.source).sort()).toEqual(['A', 'B', 'C'])
    expect(report.matchLog.map((entry) => entry.activated)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(getLorebookSearchEntryListInstrumentation()).toEqual({
      searchMatchCalls: 5,
      depthSliceBuilds: 1,
      combinedSearchEntryArrayBuilds: 0,
    })
  })
})
