import { beforeAll, describe, expect, it } from 'vitest'
import type {
  FastifyChat as Chat,
  FastifyCharacter as character,
  FastifyDatabase as Database,
} from '../src/prompt/serverTypes.js'
import { PHASE9_CBS_COMPATIBILITY_CORPUS } from '../../../test/fixtures/phase9CompatibilityCorpus.js'
import {
  PHASE9_BASELINE_DRIFT_FIXTURES,
  PHASE9_OVER_BUDGET_EACH_COUNT,
  phase9DriftCharacter,
  phase9DriftChat,
  phase9DriftDatabase,
  phase9DriftGroup,
  phase9OverBudgetEachInput,
} from '../../../test/fixtures/phase9BaselineDriftFixtures.js'
import { RisuParserBudgetError } from '@risuai/shared-core/risuchat-parser'
import { expandVariables, type ExpandContext } from '../src/prompt/variables.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'

/**
 * Smoke suite for server-side `expandVariables`. The browser parser test suite
 * in `src/ts/parser/tests/cbs/*.test.ts` is the broader oracle; this file
 * verifies that the server adapter wires the canonical parser correctly.
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

describe('expandVariables — basic substitution', () => {
  it.each(PHASE9_CBS_COMPATIBILITY_CORPUS)('runs the shared Phase 9 corpus: $name', ({ input, expected }) => {
    expect(expandVariables(input, ctx()).text).toBe(expected)
  })

  it('substitutes {{user}} with the database username', () => {
    expect(expandVariables('Hi {{user}}', ctx()).text).toBe('Hi Alex')
  })

  it('substitutes {{char}} and the {{bot}} alias with the character name', () => {
    expect(expandVariables('{{char}} & {{bot}}', ctx()).text).toBe('Tess & Tess')
  })

  it('substitutes character fields {{description}}, {{personality}}, {{scenario}}', () => {
    const out = expandVariables('[{{description}}|{{personality}}|{{scenario}}]', ctx()).text
    expect(out).toBe('[A friendly assistant.|cheerful|In a cosy library.]')
  })

  it.each([
    ['description', 'desc'],
    ['personality', 'personality'],
  ] as const)('stops self-referential {{%s}} expansion at the parser call-stack limit', (directive, field) => {
    const database = makeDatabase({
      characters: [makeCharacter({ [field]: `{{${directive}}}` })],
    })

    expect(expandVariables(`{{${directive}}}`, { database }).text).toBe('ERROR: Call stack limit reached')
  })

  it('substitutes {{persona}} with database.personaPrompt', () => {
    expect(expandVariables('persona={{persona}}', ctx()).text).toBe('persona=Alex is curious.')
  })

  it('uses the selected persona row when legacy profile scalars conflict', () => {
    const database = makeDatabase({
      selectedPersonaId: 'persona-row',
      selectedPersona: 0,
      username: 'STALE SCALAR',
      personaPrompt: 'STALE PROMPT',
      personas: [{ id: 'persona-row', name: 'Canonical Row', icon: '', personaPrompt: 'CANONICAL PROMPT', note: '' }],
    })

    expect(expandVariables('{{user}}|{{persona}}', { database }).text).toBe('Canonical Row|CANONICAL PROMPT')
  })

  it('does not use a numeric persona pointer when stable selection is missing', () => {
    const database = makeDatabase({
      selectedPersonaId: 'missing-row',
      selectedPersona: 0,
      username: 'Legacy Row',
      personaPrompt: 'LEGACY PROMPT',
      personas: [{ id: 'persona-row', name: 'Wrong Row', icon: '', personaPrompt: 'WRONG PROMPT', note: '' }],
    })

    expect(expandVariables('{{user}}|{{persona}}', { database }).text).toBe('Legacy Row|LEGACY PROMPT')
  })

  it('substitutes the <user> / <char> / <bot> shorthand', () => {
    expect(expandVariables('<user> meets <char>', ctx()).text).toBe('Alex meets Tess')
  })

  it('returns the most recent N stored messages through {{history::N}}', () => {
    const database = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: 'Greeting',
          chats: [
            makeChat({
              message: [
                { role: 'user', data: 'oldest' },
                { role: 'char', data: 'middle' },
                { role: 'user', data: 'newest' },
              ],
            }),
          ],
        }),
      ],
    })

    expect(JSON.parse(expandVariables('{{history::2}}', { database }).text)).toEqual(['middle', 'newest'])
  })

  it('pins the RH+-authorized baseline parser drifts through the Fastify adapter', () => {
    const fixtures = PHASE9_BASELINE_DRIFT_FIXTURES
    const group = phase9DriftGroup()
    const groupDatabase = phase9DriftDatabase([group, phase9DriftCharacter()]) as unknown as Database
    const historyCharacter = phase9DriftCharacter() as unknown as character
    historyCharacter.chats = [phase9DriftChat(fixtures.historyWindow.messages) as unknown as Chat]
    const historyDatabase = phase9DriftDatabase([historyCharacter]) as unknown as Database
    const metadataDatabase = phase9DriftDatabase([phase9DriftCharacter()]) as unknown as Database

    expect(
      expandVariables(fixtures.groupCharacter.input, { database: groupDatabase, chara: group as never }).text,
    ).toBe(fixtures.groupCharacter.currentExpected)
    expect(JSON.parse(expandVariables(fixtures.historyWindow.input, { database: historyDatabase }).text)).toEqual(
      fixtures.historyWindow.currentExpected,
    )
    expect(expandVariables(fixtures.reverse.input, { database: metadataDatabase }).text).toBe(
      fixtures.reverse.currentExpected,
    )
    expect(expandVariables(fixtures.metadata.input, { database: metadataDatabase }).text).toBe(
      fixtures.metadata.currentExpected,
    )
    expect(
      expandVariables(fixtures.standaloneSlot.input, {
        database: metadataDatabase,
        slot: { phase9: 'slot-value' },
      }).text,
    ).toBe(fixtures.standaloneSlot.currentExpected)
  })

  it('preserves malformed missing-fmIndex tags like the baseline', () => {
    const database = phase9DriftDatabase([phase9DriftCharacter()]) as unknown as Database

    expect(expandVariables(PHASE9_BASELINE_DRIFT_FIXTURES.missingFirstMessageIndex.input, { database }).text).toBe(
      PHASE9_BASELINE_DRIFT_FIXTURES.missingFirstMessageIndex.expected,
    )
  })

  it('propagates the RH+-authorized #each element cap through Fastify', () => {
    const database = phase9DriftDatabase([phase9DriftCharacter()]) as unknown as Database

    expect(() => expandVariables(phase9OverBudgetEachInput(), { database })).toThrow(RisuParserBudgetError)
    expect(() => expandVariables(phase9OverBudgetEachInput(), { database })).toThrow(
      `{{#each}} element budget exceeded: ${PHASE9_OVER_BUDGET_EACH_COUNT} > 4096`,
    )
  })
})

describe('expandVariables — active module CBS visibility', () => {
  it('exposes the baseline global/chat/character/integration module set to module and lore callbacks', () => {
    const database = makeDatabase({
      enabledModules: ['global-module'],
      moduleIntergration: 'integration-space',
      modules: [
        {
          id: 'character-module',
          name: 'Character module',
          description: '',
          namespace: 'character-space',
          lorebook: [{ content: 'Character module lore' }],
        },
        {
          id: 'global-module',
          name: 'Weather',
          description: '',
          namespace: 'weather',
          assets: [
            ['rain', 'rain-reference', 'image'],
            ['sun', 'sun-reference', 'image'],
          ],
          lorebook: [{ content: 'Weather module lore' }],
        },
        {
          id: 'chat-module',
          name: 'Chat module',
          description: '',
          namespace: 'chat-space',
          lorebook: [{ content: 'Chat module lore' }],
        },
        {
          id: 'integration-module',
          name: 'Integration module',
          description: '',
          namespace: 'integration-space',
          lorebook: [{ content: 'Integration module lore' }],
        },
        {
          id: 'inactive-module',
          name: 'Inactive module',
          description: '',
          namespace: 'inactive-space',
          lorebook: [{ content: 'Inactive module lore' }],
        },
      ] as Database['modules'],
      characters: [
        makeCharacter({
          modules: ['character-module'],
          chats: [makeChat({ modules: ['chat-module'] })],
        }),
      ],
    })

    expect(
      expandVariables(
        '{{moduleenabled::weather}}|{{moduleenabled::chat-space}}|{{moduleenabled::character-space}}|{{moduleenabled::integration-space}}|{{moduleenabled::inactive-space}}',
        { database },
      ).text,
    ).toBe('1|1|1|1|0')
    expect(JSON.parse(expandVariables('{{moduleassetlist::weather}}', { database }).text)).toEqual(['rain', 'sun'])

    const lore = JSON.parse(expandVariables('{{lorebook}}', { database }).text).map((entry: string) =>
      JSON.parse(entry),
    )
    expect(lore.map((entry: { content: string }) => entry.content)).toEqual([
      'Character module lore',
      'Weather module lore',
      'Chat module lore',
      'Integration module lore',
    ])
  })
})

describe('expandVariables — unknowns and trigger_id', () => {
  it('preserves unknown directives verbatim', () => {
    expect(expandVariables('{{totally_bogus_macro}} kept', ctx()).text).toBe('{{totally_bogus_macro}} kept')
  })

  it('returns "null" for {{trigger_id}} on the server', () => {
    expect(expandVariables('id={{trigger_id}}', ctx()).text).toBe('id=null')
  })
})

describe('expandVariables — conditionals', () => {
  it('{{#when 1}}...{{:else}}...{{/when}} takes the truthy branch', () => {
    expect(expandVariables('{{#when 1}}yes{{:else}}no{{/when}}', ctx()).text).toBe('yes')
  })

  it('{{#when 0}}...{{:else}}...{{/when}} takes the falsy branch', () => {
    expect(expandVariables('{{#when 0}}yes{{:else}}no{{/when}}', ctx()).text).toBe('no')
  })

  it('{{#when::1::and::1}} truthy, {{#when::1::and::0}} falsy', () => {
    expect(expandVariables('{{#when::1::and::1}}A{{:else}}B{{/when}}', ctx()).text).toBe('A')
    expect(expandVariables('{{#when::1::and::0}}A{{:else}}B{{/when}}', ctx()).text).toBe('B')
  })

  it('reads #when chat variables and toggles from the request-scoped Fastify backend', () => {
    const database = makeDatabase({
      globalChatVariables: { toggle_mode: '1' },
      characters: [makeCharacter({ chats: [makeChat({ scriptstate: { $ready: '1' } })] })],
    })

    expect(
      expandVariables(
        '{{#when::var::ready}}VAR{{/when}}|{{#when::toggle::mode}}TOGGLE{{/when}}|{{#when::mode::tis::1}}ON{{/when}}',
        { database },
      ).text,
    ).toBe('VAR|TOGGLE|ON')
  })
})

describe('expandVariables — loops and expressions', () => {
  it('iterates {{#each ... as i}} with {{slot::i}} substitution', () => {
    const out = expandVariables('{{#each [1,2,3] as i}}{{slot::i}}{{/each}}', ctx()).text
    expect(out).toBe('123')
  })

  it('evaluates {{? 1+2}} as 3', () => {
    expect(expandVariables('result={{? 1+2}}', ctx()).text).toBe('result=3')
  })
})

describe('expandVariables — chat variable write-back', () => {
  it('reads {{getvar::X}} as "null" when unset', () => {
    expect(expandVariables('v={{getvar::missing}}', ctx()).text).toBe('v=null')
  })

  it('falls back to character defaults before template defaults with parseKeyValue semantics', () => {
    const database = makeDatabase({
      templateDefaultVariables: 'shared=template\ntemplateOnly=blue',
      characters: [
        makeCharacter({
          defaultVariables: 'shared=character\ncharacterOnly=green\nwithEquals=first=discarded',
        }),
      ],
    })

    expect(
      expandVariables('{{getvar::shared}}|{{getvar::characterOnly}}|{{getvar::templateOnly}}|{{getvar::withEquals}}', {
        database,
      }).text,
    ).toBe('character|green|blue|first')
  })

  it('starts {{addvar}} arithmetic from a default-backed value', () => {
    const database = makeDatabase({
      characters: [makeCharacter({ defaultVariables: 'count=2' })],
    })

    const result = expandVariables('{{addvar::count::1}}{{getvar::count}}', {
      database,
      runVar: true,
    })

    expect(result.text).toBe('3')
    expect(result.dirty).toBe(true)
    expect(database.characters[0].chats[0].scriptstate?.['$count']).toBe('3')
  })

  it('writes via {{setvar}} when runVar=true and mutates scriptstate', () => {
    const db = makeDatabase()
    const result = expandVariables('{{setvar::greeting::hello}}done', { database: db, runVar: true })
    expect(result.text).toBe('done')
    expect(result.dirty).toBe(true)
    expect(db.characters[0].chats[0].scriptstate?.['$greeting']).toBe('hello')
  })

  it('writes via {{setdefaultvar}} when the chat variable is missing', () => {
    const db = makeDatabase()
    const result = expandVariables('{{setdefaultvar::greeting::hello}}{{getvar::greeting}}', {
      database: db,
      runVar: true,
    })

    expect(result.text.endsWith('hello')).toBe(true)
    expect(result.dirty).toBe(true)
    expect(db.characters[0].chats[0].scriptstate?.['$greeting']).toBe('hello')
  })

  it('does not replace an existing value via {{setdefaultvar}}', () => {
    const db = makeDatabase({
      characters: [makeCharacter({ chats: [makeChat({ scriptstate: { $greeting: 'existing' } })] })],
    })
    const result = expandVariables('{{setdefaultvar::greeting::hello}}{{getvar::greeting}}', {
      database: db,
      runVar: true,
    })

    expect(result.text.endsWith('existing')).toBe(true)
    expect(result.dirty).toBe(false)
    expect(db.characters[0].chats[0].scriptstate?.['$greeting']).toBe('existing')
  })

  it("replaces the 'null' sentinel via {{setdefaultvar}}", () => {
    const db = makeDatabase({
      characters: [makeCharacter({ chats: [makeChat({ scriptstate: { $greeting: 'null' } })] })],
    })
    const result = expandVariables('{{setdefaultvar::greeting::hello}}{{getvar::greeting}}', {
      database: db,
      runVar: true,
    })

    expect(result.text.endsWith('hello')).toBe(true)
    expect(result.dirty).toBe(true)
    expect(db.characters[0].chats[0].scriptstate?.['$greeting']).toBe('hello')
  })

  it('skips writes when runVar is false (read-only mode)', () => {
    const db = makeDatabase()
    const result = expandVariables('{{setvar::greeting::hello}}done', { database: db, runVar: false })
    expect(result.dirty).toBe(false)
    expect(db.characters[0].chats[0].scriptstate?.['$greeting']).toBeUndefined()
  })

  it('round-trips setvar -> getvar within a single expansion', () => {
    const db = makeDatabase()
    const result = expandVariables('{{setvar::n::42}}{{getvar::n}}', { database: db, runVar: true })
    // The setvar callback returns its written value (the cbs ack
    // shape); the getvar callback reads from the same scope.
    expect(result.text.endsWith('42')).toBe(true)
    expect(db.characters[0].chats[0].scriptstate?.['$n']).toBe('42')
  })
})

describe('expandVariables — scope isolation across calls', () => {
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
