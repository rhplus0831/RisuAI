import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  character,
} from '../../../src/ts/storage/database.svelte'
import {
  expandVariables,
  type ExpandContext,
} from '../src/prompt/variables.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'

/**
 * Phase 7-2c smoke suite for the server-side `expandVariables`. Covers
 * the "Minimum Server Slice" set from PARSER.md so subsequent Phase 7
 * slices have a regression target. The browser parser test suite in
 * `src/ts/parser/tests/cbs/*.test.ts` is the broader oracle; this file
 * verifies that the server adapter wires the canonical parser
 * correctly.
 */

beforeAll(() => {
  bootPromptVariables()
})

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    message: [],
    note: '',
    name: 'main',
    localLore: [],
    scriptstate: {},
    ...overrides,
  } as unknown as Chat
}

function makeCharacter(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    firstMessage: '',
    desc: 'A friendly assistant.',
    notes: '',
    chatPage: 0,
    viewScreen: 'none',
    bias: [],
    emotionImages: [],
    globalLore: [],
    chaId: 'char-tess',
    sdData: [],
    customscript: [],
    triggerscript: [],
    utilityBot: false,
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: 'cheerful',
    scenario: 'In a cosy library.',
    firstMsgIndex: -1,
    replaceGlobalNote: '',
    chats: [makeChat()],
    chatFolders: [],
    ...overrides,
  } as unknown as character
}

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    username: 'Alex',
    userIcon: '',
    personaPrompt: 'Alex is curious.',
    currentChar: 0,
    characters: [makeCharacter()],
    globalChatVariables: {},
    templateDefaultVariables: '',
    ...overrides,
  } as unknown as Database
}

function ctx(overrides: Partial<ExpandContext> = {}): ExpandContext {
  return { database: makeDatabase(), ...overrides }
}

describe('Phase 7-2c expandVariables — basic substitution', () => {
  it('substitutes {{user}} with the database username', () => {
    expect(expandVariables('Hi {{user}}', ctx()).text).toBe('Hi Alex')
  })

  it('substitutes {{char}} and the {{bot}} alias with the character name', () => {
    expect(expandVariables('{{char}} & {{bot}}', ctx()).text).toBe('Tess & Tess')
  })

  it('substitutes character fields {{description}}, {{personality}}, {{scenario}}', () => {
    const out = expandVariables(
      '[{{description}}|{{personality}}|{{scenario}}]',
      ctx(),
    ).text
    expect(out).toBe('[A friendly assistant.|cheerful|In a cosy library.]')
  })

  it('substitutes {{persona}} with database.personaPrompt', () => {
    expect(expandVariables('persona={{persona}}', ctx()).text).toBe('persona=Alex is curious.')
  })

  it('substitutes the <user> / <char> / <bot> shorthand', () => {
    expect(expandVariables('<user> meets <char>', ctx()).text).toBe('Alex meets Tess')
  })
})

describe('Phase 7-2c expandVariables — unknowns and trigger_id', () => {
  it('preserves unknown directives verbatim', () => {
    expect(expandVariables('{{totally_bogus_macro}} kept', ctx()).text).toBe(
      '{{totally_bogus_macro}} kept',
    )
  })

  it('returns "null" for {{trigger_id}} on the server', () => {
    expect(expandVariables('id={{trigger_id}}', ctx()).text).toBe('id=null')
  })
})

describe('Phase 7-2c expandVariables — conditionals', () => {
  it('{{#when 1}}...{{:else}}...{{/when}} takes the truthy branch', () => {
    expect(
      expandVariables('{{#when 1}}yes{{:else}}no{{/when}}', ctx()).text,
    ).toBe('yes')
  })

  it('{{#when 0}}...{{:else}}...{{/when}} takes the falsy branch', () => {
    expect(
      expandVariables('{{#when 0}}yes{{:else}}no{{/when}}', ctx()).text,
    ).toBe('no')
  })

  it('{{#when::1::and::1}} truthy, {{#when::1::and::0}} falsy', () => {
    expect(
      expandVariables('{{#when::1::and::1}}A{{:else}}B{{/when}}', ctx()).text,
    ).toBe('A')
    expect(
      expandVariables('{{#when::1::and::0}}A{{:else}}B{{/when}}', ctx()).text,
    ).toBe('B')
  })
})

describe('Phase 7-2c expandVariables — loops and expressions', () => {
  it('iterates {{#each ... as i}} with {{slot::i}} substitution', () => {
    const out = expandVariables(
      '{{#each [1,2,3] as i}}{{slot::i}}{{/each}}',
      ctx(),
    ).text
    expect(out).toBe('123')
  })

  it('evaluates {{? 1+2}} as 3', () => {
    expect(expandVariables('result={{? 1+2}}', ctx()).text).toBe('result=3')
  })
})

describe('Phase 7-2c expandVariables — chat variable write-back', () => {
  it('reads {{getvar::X}} as "null" when unset', () => {
    expect(expandVariables('v={{getvar::missing}}', ctx()).text).toBe('v=null')
  })

  it('writes via {{setvar}} when runVar=true and mutates scriptstate', () => {
    const db = makeDatabase()
    const result = expandVariables(
      '{{setvar::greeting::hello}}done',
      { database: db, runVar: true },
    )
    expect(result.text).toBe('done')
    expect(result.dirty).toBe(true)
    expect(db.characters[0].chats[0].scriptstate?.['$greeting']).toBe('hello')
  })

  it('skips writes when runVar is false (read-only mode)', () => {
    const db = makeDatabase()
    const result = expandVariables(
      '{{setvar::greeting::hello}}done',
      { database: db, runVar: false },
    )
    expect(result.dirty).toBe(false)
    expect(db.characters[0].chats[0].scriptstate?.['$greeting']).toBeUndefined()
  })

  it('round-trips setvar -> getvar within a single expansion', () => {
    const db = makeDatabase()
    const result = expandVariables(
      '{{setvar::n::42}}{{getvar::n}}',
      { database: db, runVar: true },
    )
    // The setvar callback returns its written value (the cbs ack
    // shape); the getvar callback reads from the same scope.
    expect(result.text.endsWith('42')).toBe(true)
    expect(db.characters[0].chats[0].scriptstate?.['$n']).toBe('42')
  })
})

describe('Phase 7-2c expandVariables — scope isolation across calls', () => {
  it('does not leak chat-var writes to a subsequent call with a different db', () => {
    const dbA = makeDatabase()
    expandVariables('{{setvar::leak::A}}', { database: dbA, runVar: true })
    expect(dbA.characters[0].chats[0].scriptstate?.['$leak']).toBe('A')

    const dbB = makeDatabase()
    // dbB starts with empty scriptstate. dbA's write must not bleed.
    const result = expandVariables('{{getvar::leak}}', { database: dbB })
    expect(result.text).toBe('null')
  })
})
