import { beforeAll, describe, expect, it } from 'vitest'
import type {
  FastifyChat as Chat,
  FastifyCharacter as character,
  FastifyCustomScript as customscript,
  FastifyDatabase as Database,
} from '../src/prompt/serverTypes.js'
import { processScript, processScriptAsync } from '../src/prompt/scripts.js'
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

function regex(inPat: string, out: string, type: string, flag?: string, ableFlag = false): customscript {
  return { comment: '', in: inPat, out, type, flag, ableFlag }
}

describe('processScript', () => {
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

  it('allows regex OUT values above the former 128 KiB ceiling by default', () => {
    const replacement = 'x'.repeat(256 * 1024)
    const db = makeDatabase({
      presetRegex: [regex('foo', replacement, 'editprocess')],
    })

    expect(processScript(ctxFor(db), db.characters[0], 'foo', 'editprocess')).toHaveLength(replacement.length)
  })

  it('honors a configured regex output size limit', () => {
    const replacement = 'x'.repeat(1024 * 1024 + 1)
    const db = makeDatabase({
      regexOutputSizeLimitMiB: 1,
      presetRegex: [regex('foo', replacement, 'editprocess')],
    })

    expect(() => processScript(ctxFor(db), db.characters[0], 'foo', 'editprocess')).toThrow(
      /replacement length .* exceeds cap 1048576/,
    )
  })

  it('applies multiple scripts in declared order', () => {
    const db = makeDatabase({
      presetRegex: [regex('hello', 'hi', 'editprocess'), regex('hi', 'hey', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'hello world', 'editprocess')
    expect(out).toBe('hey world')
  })

  it('skips scripts whose `type` does not match the mode', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editoutput'), regex('baz', 'qux', 'editprocess')],
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

  it('runs global regex before prompt and character scripts', () => {
    const char = makeCharacter({
      customscript: [regex('C', 'D', 'editprocess')],
    })
    const db = makeDatabase({
      globalscript: [regex('A', 'B', 'editprocess')],
      presetRegex: [regex('B', 'C', 'editprocess')],
      characters: [char],
    })

    expect(processScript(ctxFor(db), char, 'A', 'editprocess')).toBe('D')
  })

  it('restarts a reused sticky action regex from index zero on every transformation', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', '@@bogus replacement', 'editprocess', 'y', true)],
    })
    const char = db.characters[0]

    expect(processScript(ctxFor(db), char, 'foo', 'editprocess')).toBe('@@bogus replacement')
    expect(processScript(ctxFor(db), char, 'foo', 'editprocess')).toBe('@@bogus replacement')
  })

  it('respects the `g` flag for global replacement', () => {
    const db = makeDatabase({
      presetRegex: [regex('a', 'z', 'editprocess', 'g')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'banana', 'editprocess')
    expect(out).toBe('bznznz')
  })

  it('honors the `i` flag only when ableFlag is true (SPA scripts.ts:182-185)', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editprocess', 'i', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'FOO baz', 'editprocess')
    expect(out).toBe('bar baz')
  })

  it('strips invalid flag chars and keeps the valid ones (with ableFlag)', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editprocess', 'gZ!i', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'FOO foo', 'editprocess')
    expect(out).toBe('bar bar')
  })

  it("defaults to flag 'g' (script.flag is ignored without ableFlag)", () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editprocess', 'i')],
    })
    // script.flag='i' is dropped because ableFlag=false; the SPA default
    // 'g' makes this a global replacement.
    const out = processScript(ctxFor(db), db.characters[0], 'foo foo', 'editprocess')
    expect(out).toBe('bar bar')
  })

  it('skips scripts with empty `in`', () => {
    const db = makeDatabase({
      presetRegex: [regex('', 'bar', 'editprocess'), regex('foo', 'baz', 'editprocess')],
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

  it('expands replacement CBS with the supplied current-message index', async () => {
    const chat = makeChatForScripts([
      { role: 'char', data: 'previous response' },
      { role: 'user', data: 'current request' },
    ])
    const char = makeCharacter({ chats: [chat] })
    const db = makeDatabase({
      characters: [char],
      presetRegex: [
        regex(
          '^current request$',
          '{{#if {{equal::{{chat_index}}::{{lastmessageid}}}}}}CURRENT{{/if}}' +
            '{{#if {{not_equal::{{chat_index}}::{{lastmessageid}}}}}}STALE{{/if}}',
          'editprocess',
        ),
      ],
    })

    const out = await processScriptAsync(ctxFor(db), char, 'current request', 'editprocess', {}, 1, chat)

    expect(out).toBe('CURRENT')
  })

  it('keeps state-changing CBS read-only during the whole-text parser pass', async () => {
    const db = makeDatabase()
    const out = await processScriptAsync(
      { database: db, runVar: true },
      db.characters[0],
      '{{setvar::sideEffect::changed}}visible',
      'editprocess',
    )

    expect(out).toBe('{{setvar::sideEffect::changed}}visible')
    expect(db.characters[0].chats[0].scriptstate?.['$sideEffect']).toBeUndefined()
  })

  it("preserves '$1' and '$&' backreferences via RegExp.replace (outScript ending in `>` auto-appends \\n per SPA scripts.ts:194-196)", () => {
    const db = makeDatabase({
      presetRegex: [regex('(\\w+)', '<$1:$&>', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'word', 'editprocess')
    expect(out).toBe('<word:word>\n')
  })

  it('swallows a bad regex and continues with the remaining scripts', () => {
    const db = makeDatabase({
      presetRegex: [regex('(unbalanced', 'never', 'editprocess'), regex('foo', 'bar', 'editprocess')],
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

describe('@@emo (no-op on the server)', () => {
  it('matches but does not modify data', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', '@@emo happy', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo bar', 'editprocess')
    expect(out).toBe('foo bar')
  })
})

describe('@@move_top / @@move_bottom', () => {
  it('@@move_top extracts a single match (no `g`) and prepends with newline', () => {
    const db = makeDatabase({
      presetRegex: [regex('TAG', '@@move_top $&', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'pre TAG post', 'editprocess')
    expect(out).toBe('TAG\npre  post')
  })

  it('@@move_top defangs `g` to non-global for the SPA move-action quirk', () => {
    const db = makeDatabase({
      // Even with ableFlag + flag='g', move_top strips 'g' before compile.
      presetRegex: [regex('TAG', '@@move_top $&', 'editprocess', 'g', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'TAG a TAG b', 'editprocess')
    // Only the first TAG matches; replace also affects only the first.
    expect(out).toBe('TAG\n a TAG b')
  })

  it('@@move_bottom appends instead of prepending', () => {
    const db = makeDatabase({
      presetRegex: [regex('TAG', '@@move_bottom $&', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'pre TAG post', 'editprocess')
    expect(out).toBe('pre  post\nTAG')
  })

  it('@@move_top substitutes `$1` from a capture group (the `>` ending also auto-appends \\n)', () => {
    const db = makeDatabase({
      presetRegex: [regex('\\[(\\w+)\\]', '@@move_top <$1>', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'pre [meta] post', 'editprocess')
    // outScript ends in `>` → SPA appends `\n`; after move_top strip and
    // substitution the prepended block is `<meta>\n`, then the move
    // adds its own `\n` separator.
    expect(out).toBe('<meta>\n\npre  post')
  })

  it('keeps an unmatched optional capture literal in move directives', () => {
    const db = makeDatabase({
      presetRegex: [regex('(a)?b', '@@move_top <$1>', 'editprocess')],
    })

    const out = processScript(ctxFor(db), db.characters[0], 'b', 'editprocess')

    // Accepted ST-9 divergence from baseline scripts.ts:219, which coerced the
    // missing capture to "undefined". The server intentionally preserves `$1`.
    expect(out).toBe('<$1>\n\n')
  })

  it('does nothing when the regex does not match', () => {
    const db = makeDatabase({
      presetRegex: [regex('NEVER', '@@move_top $&', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'plain', 'editprocess')
    expect(out).toBe('plain')
  })
})

describe('@@inject', () => {
  it('overwrites message[chatID].data with current data and strips the match', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'original-0' },
      { role: 'char', data: 'original-1' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('SECRET', '@@inject', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'visible SECRET tail', 'editprocess', {}, 1, chat)
    expect(out).toBe('visible  tail')
    expect(chat.message[1].data).toBe('visible SECRET tail')
    expect(chat.message[0].data).toBe('original-0')
  })

  it('is a no-op when chatID is the default -1', () => {
    const chat = makeChatForScripts([{ role: 'user', data: 'untouched' }])
    const db = makeDatabase({
      presetRegex: [regex('SECRET', '@@inject', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'SECRET payload', 'editprocess')
    expect(out).toBe('SECRET payload')
    expect(chat.message[0].data).toBe('untouched')
  })

  it('is a no-op when currentChat is undefined even with chatID >= 0', () => {
    const db = makeDatabase({
      presetRegex: [regex('SECRET', '@@inject', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'SECRET payload', 'editprocess', {}, 0)
    expect(out).toBe('SECRET payload')
  })
})

describe('@@repeat_back', () => {
  it('fires only when the regex does NOT match data; appends previous same-role match', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'prev contains KEY here' },
      { role: 'user', data: 'current has no token' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('KEY', '@@repeat_back', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'current has no token', 'editprocess', {}, 1, chat)
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
    const out = processScript(ctxFor(db), db.characters[0], 'no token', 'editprocess', {}, 1, chat)
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
    const out = processScript(ctxFor(db), db.characters[0], 'no token', 'editprocess', {}, 1, chat)
    expect(out).toBe('KEYno token')
  })

  it('falls back to currentChar.firstMessage when no previous same-role message exists', () => {
    const char = makeCharacter({ firstMessage: 'greeting with KEY inline' })
    const chat = makeChatForScripts([{ role: 'user', data: 'standalone' }])
    const db = makeDatabase({
      presetRegex: [regex('KEY', '@@repeat_back end', 'editprocess')],
      characters: [char],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'standalone', 'editprocess', {}, 0, chat)
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
    const out = processScript(ctxFor(db), db.characters[0], 'current KEY', 'editprocess', {}, 1, chat)
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
    const out = processScript(ctxFor(db), db.characters[0], 'no token here', 'editprocess', {}, 1, chat)
    expect(out).toBe('no token here')
  })
})

describe('unknown @@ prefix falls through to plain replace', () => {
  it('treats an unrecognized @@ outScript like a normal regex replacement', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', '@@bogus replacement', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo bar', 'editprocess')
    expect(out).toBe('@@bogus replacement bar')
  })
})

describe('ableFlag <order, actions> DSL parsing', () => {
  it('parses `<order N>` and stable-sorts by order desc', () => {
    const db = makeDatabase({
      presetRegex: [
        // ableFlag scripts: declared order beats declaration order.
        regex('A', '1<$&>', 'editprocess', '<order 1>', true),
        regex('B', '2<$&>', 'editprocess', '<order 5>', true),
        regex('C', '3<$&>', 'editprocess', '<order 3>', true),
      ],
    })
    // The sort ordering is observable through which substitution runs
    // first: order 5 (B) should run before order 3 (C) before order 1 (A).
    // Each replacement also tags the matched char so we can read the order.
    const out = processScript(ctxFor(db), db.characters[0], 'CBA', 'editprocess')
    // Order of operations: B -> C -> A. Each outScript ends with `>` so
    // the SPA appends `\n` per substitution.
    // 'CBA' --B-> 'C2<B>\nA' --C-> '3<C>\n2<B>\nA' --A-> '3<C>\n2<B>\n1<A>\n'
    expect(out).toBe('3<C>\n2<B>\n1<A>\n')
  })

  it('keeps a malformed order token in relative position before a valid order', () => {
    const db = makeDatabase({
      presetRegex: [
        regex('a', 'b', 'editprocess', '<order nope>', true),
        regex('b', 'c', 'editprocess', '<order 5>', true),
      ],
    })

    expect(processScript(ctxFor(db), db.characters[0], 'a', 'editprocess')).toBe('c')
  })

  it('parses `<action_name>` into the actions list', () => {
    // 'inject' action is equivalent to @@inject prefix. Outscript is
    // not '@@inject' so without the action we'd hit plain replace.
    const chat = makeChatForScripts([
      { role: 'user', data: 'pre' },
      { role: 'user', data: 'tail SECRET tail' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('SECRET', 'literal', 'editprocess', '<inject>', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'tail SECRET tail', 'editprocess', {}, 1, chat)
    expect(out).toBe('tail  tail')
    expect(chat.message[1].data).toBe('tail SECRET tail')
  })

  it('combines `<order N, action>` in a single segment', () => {
    const chat = makeChatForScripts([
      { role: 'user', data: 'pre' },
      { role: 'user', data: 'has KEY' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('KEY', 'lit', 'editprocess', '<order 9, inject>', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'has KEY', 'editprocess', {}, 1, chat)
    // Action fires (inject path).
    expect(out).toBe('has ')
  })

  it('ignores `<…>` segments when ableFlag is false (SPA scripts.ts:336)', () => {
    const db = makeDatabase({
      // ableFlag=false → the `<inject>` token stays as part of the flag
      // (which the SPA discards as 'g' default anyway). The action does
      // NOT fire.
      presetRegex: [regex('foo', 'BAR', 'editprocess', '<inject>', false)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo', 'editprocess')
    // Plain replace runs because we have no @@ prefix and no parsed
    // actions; the result is just the substituted text.
    expect(out).toBe('BAR')
  })

  it('preserves arbitrary action tokens (unknown actions are kept in actions list)', () => {
    // An unknown action like 'whatever' is parsed into actions[] but
    // doesn't trigger any path. processScript dispatches to the action
    // branch (actions.length > 0), so plain replace runs through the
    // unknown-prefix fallback rather than the bare plain branch.
    const db = makeDatabase({
      presetRegex: [regex('foo', 'bar', 'editprocess', '<whatever>', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo', 'editprocess')
    expect(out).toBe('bar')
  })
})

describe('`cbs` action pre-expands script.in', () => {
  it('expands {{user}} in the regex source before compiling', () => {
    const db = makeDatabase({
      username: 'Alex',
      presetRegex: [regex('{{user}}', 'redacted', 'editprocess', '<cbs>', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'hello Alex!', 'editprocess')
    expect(out).toBe('hello redacted!')
  })

  it('leaves CBS in the regex source literal when `cbs` action is not set', () => {
    const db = makeDatabase({
      username: 'Alex',
      presetRegex: [regex('{{user}}', 'redacted', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'hello Alex!', 'editprocess')
    // No expansion; the literal `{{user}}` regex doesn't match 'Alex'.
    expect(out).toBe('hello Alex!')
  })
})

describe('outScript prep', () => {
  it('leaves {{data}} as a literal in the replacement (SPA scripts.ts:181 `.replace(dreg, "$&")` is a no-op)', () => {
    // The SPA writes `outScript.replace(/{{data}}/g, '$&')`; in JS
    // replacement strings `$&` resolves to the inner regex's full
    // match, which is `{{data}}` itself — so this line preserves the
    // literal rather than substituting the outer match. We mirror.
    const db = makeDatabase({
      presetRegex: [regex('foo', '[{{data}}]', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo bar', 'editprocess')
    expect(out).toBe('[{{data}}] bar')
  })

  it('appends \\n when outScript ends with `>` (SPA scripts.ts:194-196)', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', '<tag>', 'editprocess')],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo bar', 'editprocess')
    expect(out).toBe('<tag>\n bar')
  })

  it('`no_end_nl` action suppresses the trailing-`>` newline', () => {
    const db = makeDatabase({
      presetRegex: [regex('foo', '<tag>', 'editprocess', '<no_end_nl>', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'foo bar', 'editprocess')
    expect(out).toBe('<tag> bar')
  })
})

describe('action-only dispatch matches @@ prefixes', () => {
  it('`<move_top>` action is equivalent to @@move_top prefix', () => {
    const db = makeDatabase({
      presetRegex: [regex('TAG', '$&', 'editprocess', '<move_top>', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'pre TAG post', 'editprocess')
    expect(out).toBe('TAG\npre  post')
  })

  it('`<repeat_back, end_nl>` action triggers @@repeat_back end_nl', () => {
    // Without an @@ prefix, applyRepeatBack reads the SPA's modifier
    // from outScript via split(' ', 2)[1]. With action-only dispatch
    // there's no @@-prefix outscript, so modifier comes from the
    // outscript itself.
    const chat = makeChatForScripts([
      { role: 'user', data: 'has KEY' },
      { role: 'user', data: 'no token' },
    ])
    const db = makeDatabase({
      presetRegex: [regex('KEY', 'literal end_nl', 'editprocess', '<repeat_back>', true)],
    })
    const out = processScript(ctxFor(db), db.characters[0], 'no token', 'editprocess', {}, 1, chat)
    // outScript.split(' ', 2)[1] = 'end_nl' → append with newline.
    expect(out).toBe('no token\nKEY')
  })
})

describe('module regex scripts join the chain', () => {
  it('runs module regex scripts after preset + character', () => {
    const db = makeDatabase({
      presetRegex: [regex('a', 'A', 'editprocess')],
      characters: [
        {
          ...makeCharacter(),
          customscript: [regex('b', 'B', 'editprocess')],
        },
      ],
      enabledModules: ['m1'],
      modules: [
        {
          name: 'm1',
          description: '',
          id: 'm1',
          regex: [regex('c', 'C', 'editprocess')],
        },
      ],
    } as Partial<Database>)
    const out = processScript(ctxFor(db), db.characters[0], 'abc', 'editprocess')
    expect(out).toBe('ABC')
  })

  it('honors the per-chat module list when the chat enables an extra module', () => {
    const chat = {
      ...makeChatForScripts([]),
      modules: ['extra'],
    } as Chat
    const db = makeDatabase({
      presetRegex: [],
      enabledModules: [],
      modules: [
        {
          name: 'extra',
          description: '',
          id: 'extra',
          regex: [regex('foo', 'bar', 'editprocess')],
        },
      ],
    } as Partial<Database>)
    const out = processScript(ctxFor(db), db.characters[0], 'foo', 'editprocess', {}, -1, chat)
    expect(out).toBe('bar')
  })

  it('skips modules with no regex array', () => {
    const db = makeDatabase({
      presetRegex: [regex('a', 'A', 'editprocess')],
      enabledModules: ['quiet'],
      modules: [
        {
          name: 'quiet',
          description: '',
          id: 'quiet',
        },
      ],
    } as Partial<Database>)
    const out = processScript(ctxFor(db), db.characters[0], 'abc', 'editprocess')
    expect(out).toBe('Abc')
  })
})

// M2 (Phase 7): the history walk calls `processScript` once per window message
// with identical script inputs. The per-script invariants (module resolution,
// `parseScripts`, flag/outScript prep, RegExp compile) must be paid once per
// assembly, not once per message. Compile counts are observed by swapping the
// global RegExp constructor for a counting subclass — `new RegExp(...)` inside
// `prepareOne` resolves the global binding at call time.
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

describe('per-assembly prepared-script memo', () => {
  it('a simulated history window compiles each script regex once, not once per message', () => {
    const mkDb = () =>
      makeDatabase({
        presetRegex: [regex('m2-pat-alpha\\d+', 'A', 'editprocess'), regex('m2-pat-beta\\d+', 'B', 'editprocess')],
      })

    // Baseline: a fresh database per call (memo can never hit) fixes expected output.
    const coldDb = mkDb()
    const expected: string[] = []
    for (let i = 0; i < 25; i++) {
      expected.push(
        processScript(
          ctxFor(mkDb()),
          coldDb.characters[0],
          `m2-pat-alpha${i} m2-pat-beta${i}`,
          'editprocess',
          { chatRole: 'user' },
          i,
          coldDb.characters[0].chats[0],
        ),
      )
    }

    // Hot path: one database across the whole window, like buildHistoryWindow.
    const db = mkDb()
    const ctx = ctxFor(db)
    const char = db.characters[0]
    const chat = char.chats[0]
    const { result: outputs, compiles } = countRegexCompiles(() => {
      const out: string[] = []
      for (let i = 0; i < 25; i++) {
        out.push(
          processScript(ctx, char, `m2-pat-alpha${i} m2-pat-beta${i}`, 'editprocess', { chatRole: 'user' }, i, chat),
        )
      }
      return out
    })

    // Output bytes are identical to the per-call cold baseline.
    expect(outputs).toEqual(expected)
    // Each script regex compiled exactly once for the whole 25-message window.
    expect(compiles.get('m2-pat-alpha\\d+')).toBe(1)
    expect(compiles.get('m2-pat-beta\\d+')).toBe(1)
  })

  it('cbs-action scripts still compile per message (their source pre-expands per call)', () => {
    const db = makeDatabase({
      presetRegex: [regex('m2-cbs-src', 'X', 'editprocess', '<cbs>', true)],
    })
    const ctx = ctxFor(db)
    const char = db.characters[0]
    const chat = char.chats[0]
    const { result: outputs, compiles } = countRegexCompiles(() => {
      const out: string[] = []
      for (let i = 0; i < 5; i++) {
        out.push(processScript(ctx, char, 'm2-cbs-src tail', 'editprocess', {}, i, chat))
      }
      return out
    })
    expect(outputs).toEqual(['X tail', 'X tail', 'X tail', 'X tail', 'X tail'])
    expect(compiles.get('m2-cbs-src')).toBe(5)
  })

  it('replacing the script list invalidates the memo (no stale prepared scripts)', () => {
    const db = makeDatabase({
      presetRegex: [regex('m2-stale-a', 'ONE', 'editprocess')],
    })
    const ctx = ctxFor(db)
    const char = db.characters[0]
    expect(processScript(ctx, char, 'm2-stale-a', 'editprocess')).toBe('ONE')

    // A replaced presetRegex array (new reference) must recompute the prep.
    db.presetRegex = [regex('m2-stale-a', 'TWO', 'editprocess')]
    expect(processScript(ctx, char, 'm2-stale-a', 'editprocess')).toBe('TWO')
  })

  it('replacing global scripts invalidates the prepared-script memo', () => {
    const db = makeDatabase({
      globalscript: [regex('m2-global', 'ONE', 'editprocess')],
    })
    const ctx = ctxFor(db)
    const char = db.characters[0]
    expect(processScript(ctx, char, 'm2-global', 'editprocess')).toBe('ONE')

    db.globalscript = [regex('m2-global', 'TWO', 'editprocess')]
    expect(processScript(ctx, char, 'm2-global', 'editprocess')).toBe('TWO')
  })

  it('an invalid precompiled regex stays a per-script no-op and the chain continues', () => {
    const db = makeDatabase({
      presetRegex: [regex('(m2-unbalanced', 'never', 'editprocess'), regex('m2-ok', 'fine', 'editprocess')],
    })
    const ctx = ctxFor(db)
    const char = db.characters[0]
    // Twice: once cold, once through the memo.
    expect(processScript(ctx, char, 'm2-ok', 'editprocess')).toBe('fine')
    expect(processScript(ctx, char, 'm2-ok', 'editprocess')).toBe('fine')
  })
})
