import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  character,
  customscript,
} from '../../../src/ts/storage/database.svelte'
import { processScript } from '../src/prompt/scripts.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import type { ExpandContext } from '../src/prompt/variables.js'

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
    fmIndex: -1,
    ...overrides,
  } as unknown as Chat
}

function makeCharacter(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    firstMessage: '',
    desc: '',
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
    personality: '',
    scenario: '',
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
    personaPrompt: '',
    currentChar: 0,
    characters: [makeCharacter()],
    globalChatVariables: {},
    templateDefaultVariables: '',
    presetRegex: [],
    ...overrides,
  } as unknown as Database
}

function ctxFor(db: Database): ExpandContext {
  return { database: db }
}

function regex(
  inPat: string,
  out: string,
  type: string,
  flag?: string,
): customscript {
  return { comment: '', in: inPat, out, type, flag, ableFlag: false }
}

describe('Phase 7-6a processScript', () => {
  it('returns input unchanged when no scripts are registered', () => {
    const db = makeDatabase()
    const out = processScript(ctxFor(db), db.characters[0], 'hello', 'editprocess')
    expect(out).toBe('hello')
  })

  it('applies a single regex replacement', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo baz', 'editprocess')
    expect(out).toBe('bar baz')
  })

  it('applies multiple scripts in declared order', () => {
    const db = makeDatabase({
      presetRegex: [
        regex('hello', 'hi', 'editprocess'),
        regex('hi', 'hey', 'editprocess'),
      ],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'hello world', 'editprocess')
    expect(out).toBe('hey world')
  })

  it('skips scripts whose `type` does not match the mode', () => {
    const db = makeDatabase({
      presetRegex: [
        regex('foo', 'bar', 'editoutput'),
        regex('baz', 'qux', 'editprocess'),
      ],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo baz', 'editprocess')
    expect(out).toBe('foo qux')
  })

  it('runs presetRegex before character.customscript', () => {
    const char = makeCharacter({
      customscript: [regex('B', 'C', 'editprocess')],
    })
    const db = makeDatabase({
      presetRegex: [regex('A', 'B', 'editprocess')],
      characters: [char],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'A', 'editprocess')
    expect(out).toBe('C')
  })

  it('respects the `g` flag for global replacement', () => {
    const db = makeDatabase({
      presetRegex: [regex('a', 'z', 'editprocess', 'g')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'banana', 'editprocess')
    expect(out).toBe('bznznz')
  })

  it('respects the `i` flag for case-insensitive matching', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editprocess', 'i')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'FOO baz', 'editprocess')
    expect(out).toBe('bar baz')
  })

  it('strips invalid flag chars and keeps the valid ones', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editprocess', 'gZ!i')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'FOO foo', 'editprocess')
    expect(out).toBe('bar bar')
  })

  it("defaults to flag 'u' when the flag is empty / missing", () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editprocess', '')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo foo', 'editprocess')
    expect(out).toBe('bar foo')
  })

  it('skips scripts with empty `in`', () => {
    const db = makeDatabase({
      presetRegex: [
        regex('', 'bar', 'editprocess'),
        regex('foo', 'baz', 'editprocess'),
      ],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo', 'editprocess')
    expect(out).toBe('baz')
  })

  it("translates the SPA's '$n' literal to a real newline in the replacement", () => {
    const db = makeDatabase({
      presetRegex: [regex(' ', '$n', 'editprocess', 'g')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'a b c', 'editprocess')
    expect(out).toBe('a\nb\nc')
  })

  it('expands CBS in the replacement output', () => {
    const db = makeDatabase({
      presetRegex: [regex('NAME', '{{user}}', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'Hello, NAME!', 'editprocess')
    expect(out).toBe('Hello, Alex!')
  })

  it("preserves '$1' and '$&' backreferences via RegExp.replace", () => {
    const db = makeDatabase({
      presetRegex: [regex('(\\w+)', '<$1:$&>', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'word', 'editprocess')
    expect(out).toBe('<word:word>')
  })

  it('swallows a bad regex and continues with the remaining scripts', () => {
    const db = makeDatabase({
      presetRegex: [
        regex('(unbalanced', 'never', 'editprocess'),
        regex('foo', 'bar', 'editprocess'),
      ],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo', 'editprocess')
    expect(out).toBe('bar')
  })
})
