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

function makeChatForScripts(messages: { role: 'user' | 'char'; data: string }[] = []) {
  return {
    message: messages.map((m, i) => ({
      role: m.role,
      data: m.data,
      chatId: `m-${i}`,
      time: 0,
    })),
    note: '',
    name: 'main',
    localLore: [],
    scriptstate: {},
    fmIndex: -1,
  } as unknown as Chat
}

describe('Phase 7-6b @@emo (no-op on the server)', () => {
  it('matches but does not modify data', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', '@@emo happy', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'foo bar',
      'editprocess',
    )
    expect(out).toBe('foo bar')
  })
})

describe('Phase 7-6b @@move_top / @@move_bottom', () => {
  it('@@move_top extracts a single match (no `g`) and prepends with newline', () => {
    const db = makeDatabase({
      presetRegex: [regex('TAG', '@@move_top $&', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'pre TAG post',
      'editprocess',
    )
    expect(out).toBe('TAG\npre  post')
  })

  it('@@move_top with `g` flag extracts all matches and prepends each', () => {
    const db = makeDatabase({
      presetRegex: [regex('TAG', '@@move_top $&', 'editprocess', 'g')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'TAG a TAG b',
      'editprocess',
    )
    expect(out).toBe('TAG\nTAG\n a  b')
  })

  it('@@move_bottom appends instead of prepending', () => {
    const db = makeDatabase({
      presetRegex: [regex('TAG', '@@move_bottom $&', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'pre TAG post',
      'editprocess',
    )
    expect(out).toBe('pre  post\nTAG')
  })

  it('@@move_top substitutes `$1` from a capture group', () => {
    const db = makeDatabase({
      presetRegex: [regex('\\[(\\w+)\\]', '@@move_top <$1>', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'pre [meta] post',
      'editprocess',
    )
    expect(out).toBe('<meta>\npre  post')
  })

  it('does nothing when the regex does not match', () => {
    const db = makeDatabase({
      presetRegex: [regex('NEVER', '@@move_top $&', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'plain',
      'editprocess',
    )
    expect(out).toBe('plain')
  })
})

describe('Phase 7-6b @@inject', () => {
  it('overwrites message[chatID].data with current data and strips the match', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'original-0' },
      { role: 'char', data: 'original-1' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('SECRET', '@@inject', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'visible SECRET tail',
      'editprocess',
      {},
      1,
      chat,
    )
    expect(out).toBe('visible  tail')
    expect(chat.message[1].data).toBe('visible SECRET tail')
    expect(chat.message[0].data).toBe('original-0')
  })

  it('is a no-op when chatID is the default -1', () => {
    const chat = makeChatForScripts([{ role: 'user', data: 'untouched' }])
    const db = makeDatabase({
      presetRegex: [regex('SECRET', '@@inject', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'SECRET payload',
      'editprocess',
    )
    expect(out).toBe('SECRET payload')
    expect(chat.message[0].data).toBe('untouched')
  })

  it('is a no-op when currentChat is undefined even with chatID >= 0', () => {
    const db = makeDatabase({
      presetRegex: [regex('SECRET', '@@inject', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'SECRET payload',
      'editprocess',
      {},
      0,
    )
    expect(out).toBe('SECRET payload')
  })
})

describe('Phase 7-6b @@repeat_back', () => {
  it('fires only when the regex does NOT match data; appends previous same-role match', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'prev contains KEY here' },
      { role: 'user', data: 'current has no token' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('KEY', '@@repeat_back', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'current has no token',
      'editprocess',
      {},
      1,
      chat,
    )
    expect(out).toBe('current has no tokenKEY')
  })

  it('applies the `end_nl` positional modifier (appends with newline)', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'has KEY' },
      { role: 'user', data: 'no token' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('KEY', '@@repeat_back end_nl', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'no token',
      'editprocess',
      {},
      1,
      chat,
    )
    expect(out).toBe('no token\nKEY')
  })

  it('applies the `start` positional modifier (prepends without newline)', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'has KEY' },
      { role: 'user', data: 'no token' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('KEY', '@@repeat_back start', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'no token',
      'editprocess',
      {},
      1,
      chat,
    )
    expect(out).toBe('KEYno token')
  })

  it('falls back to currentChar.firstMessage when no previous same-role message exists', () => {
    const char = makeCharacter({ firstMessage: 'greeting with KEY inline' })
    const chat = makeChatForScripts([{ role: 'user', data: 'standalone' }])
    const db = makeDatabase({
      presetRegex: [regex('KEY', '@@repeat_back end', 'editprocess')],
      characters: [char],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'standalone',
      'editprocess',
      {},
      0,
      chat,
    )
    expect(out).toBe('standaloneKEY')
  })

  it('falls through to plain replace when the regex matches data (mirrors SPA scripts.ts:284-286)', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'prev KEY' },
      { role: 'user', data: 'current KEY' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('KEY', '@@repeat_back end', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'current KEY',
      'editprocess',
      {},
      1,
      chat,
    )
    expect(out).toBe('current @@repeat_back end')
  })

  it('gracefully handles no match on lastChat (SPA r[0] guard)', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'no relevant content' },
      { role: 'user', data: 'no token here' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('KEY', '@@repeat_back', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'no token here',
      'editprocess',
      {},
      1,
      chat,
    )
    expect(out).toBe('no token here')
  })
})

describe('Phase 7-6b unknown @@ prefix falls through to plain replace', () => {
  it('treats an unrecognized @@ outScript like a normal regex replacement', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', '@@bogus replacement', 'editprocess')],
    })
    const out = processScript(
      ctxFor(db),
      db.characters[0],
      'foo bar',
      'editprocess',
    )
    expect(out).toBe('@@bogus replacement bar')
  })
})
