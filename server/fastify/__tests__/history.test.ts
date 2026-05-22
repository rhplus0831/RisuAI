import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  Message,
  character,
} from '../../../src/ts/storage/database.svelte'
import {
  buildHistoryWindow,
  exampleMessage,
} from '../src/prompt/history.js'
import { bootPromptVariables } from '../src/prompt/promptVariablesBoot.js'
import type { ExpandContext } from '../src/prompt/variables.js'

beforeAll(() => {
  bootPromptVariables()
})

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    role: 'user',
    data: '',
    chatId: 'm',
    time: 0,
    ...overrides,
  } as Message
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

function makeCharacter(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    firstMessage: 'default greeting',
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
    aiModel: 'gpt4',
    promptSettings: {
      assistantPrefill: '',
      postEndInnerFormat: '',
      sendChatAsSystem: false,
      sendName: false,
      utilOverride: false,
      customChainOfThought: false,
      maxThoughtTagDepth: -1,
      trimStartNewChat: false,
    },
    ...overrides,
  } as unknown as Database
}

function ctxFor(db: Database): ExpandContext {
  return { database: db }
}

describe('Phase 7-5a exampleMessage', () => {
  it('returns [] when char.exampleMessage is empty', () => {
    const db = makeDatabase()
    expect(exampleMessage(ctxFor(db), db.characters[0])).toEqual([])
  })

  it('emits a NewChatExample marker on <start>', () => {
    const db = makeDatabase({
      characters: [makeCharacter({ exampleMessage: '<start>' })],
    })
    expect(exampleMessage(ctxFor(db), db.characters[0])).toEqual([
      { role: 'system', content: '[Start a new chat]', memo: 'NewChatExample' },
    ])
  })

  it('maps {{char}}: / <bot>: / `${name}:` to example_assistant', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          name: 'tess',
          exampleMessage: '{{char}}: hi\n<bot>: there\ntess: friend',
        }),
      ],
    })
    expect(exampleMessage(ctxFor(db), db.characters[0])).toEqual([
      { role: 'assistant', content: 'hi', name: 'example_assistant' },
      { role: 'assistant', content: 'there', name: 'example_assistant' },
      { role: 'assistant', content: 'friend', name: 'example_assistant' },
    ])
  })

  it('maps {{user}}: and <user>: to example_user', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          exampleMessage: '{{user}}: hello\n<user>: again',
        }),
      ],
    })
    expect(exampleMessage(ctxFor(db), db.characters[0])).toEqual([
      { role: 'user', content: 'hello', name: 'example_user' },
      { role: 'user', content: 'again', name: 'example_user' },
    ])
  })

  it('appends continuation lines to the current message with \\n', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          exampleMessage: '{{char}}: line one\nline two\nline three',
        }),
      ],
    })
    expect(exampleMessage(ctxFor(db), db.characters[0])).toEqual([
      {
        role: 'assistant',
        content: 'line one\nline two\nline three',
        name: 'example_assistant',
      },
    ])
  })

  it('expands {{user}} / {{char}} in the final content', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          exampleMessage: '{{user}}: hi {{char}}',
        }),
      ],
    })
    expect(exampleMessage(ctxFor(db), db.characters[0])).toEqual([
      { role: 'user', content: 'hi Tess', name: 'example_user' },
    ])
  })
})

describe('Phase 7-5a buildHistoryWindow start-new-chat marker', () => {
  it('emits the marker when neither novelai nor trimStartNewChat applies', () => {
    const db = makeDatabase()
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(
      result.messages.some((m) => m.content === '[Start a new chat]'),
    ).toBe(true)
  })

  it('omits the marker when aiModel starts with "novelai"', () => {
    const db = makeDatabase({ aiModel: 'novelai:kayra' })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(
      result.messages.some((m) => m.content === '[Start a new chat]'),
    ).toBe(false)
  })

  it('omits the marker when promptSettings.trimStartNewChat is true', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: true,
      } as Database['promptSettings'],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(
      result.messages.some((m) => m.content === '[Start a new chat]'),
    ).toBe(false)
  })
})

describe('Phase 7-5a buildHistoryWindow first message', () => {
  it('uses currentChar.firstMessage when fmIndex === -1', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: 'default greeting',
          alternateGreetings: ['alt-0', 'alt-1'],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(
      result.messages.some(
        (m) => m.role === 'assistant' && m.content === 'default greeting',
      ),
    ).toBe(true)
  })

  it('uses alternateGreetings[fmIndex] when fmIndex !== -1', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: 'default greeting',
          alternateGreetings: ['alt-0', 'alt-1', 'alt-2'],
          chats: [makeChat({ fmIndex: 1 })],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(
      result.messages.some(
        (m) => m.role === 'assistant' && m.content === 'alt-1',
      ),
    ).toBe(true)
    expect(
      result.messages.some((m) => m.content === 'default greeting'),
    ).toBe(false)
  })

  it('expands {{user}} / {{char}} in the first message', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({ firstMessage: 'Hi {{user}}, I am {{char}}.' }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(
      result.messages.some(
        (m) =>
          m.role === 'assistant' && m.content === 'Hi Alex, I am Tess.',
      ),
    ).toBe(true)
  })
})

describe('Phase 7-5a buildHistoryWindow makeMs filter', () => {
  it('drops messages flagged disabled: true', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: 'keep-1', chatId: 'm1' }),
                makeMessage({
                  role: 'user',
                  data: 'dropped',
                  chatId: 'm2',
                  disabled: true,
                }),
                makeMessage({ role: 'user', data: 'keep-2', chatId: 'm3' }),
              ],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(result.messages.some((m) => m.content === 'dropped')).toBe(false)
    expect(result.messages.some((m) => m.content === 'keep-1')).toBe(true)
    expect(result.messages.some((m) => m.content === 'keep-2')).toBe(true)
  })

  it("treats disabled: 'allBefore' as a reset and suppresses the first-message block", () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: 'default greeting',
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: 'before', chatId: 'm1' }),
                makeMessage({
                  role: 'user',
                  data: 'cutoff',
                  chatId: 'm2',
                  disabled: 'allBefore',
                }),
                makeMessage({ role: 'user', data: 'after', chatId: 'm3' }),
              ],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(
      result.messages.some((m) => m.content === 'default greeting'),
    ).toBe(false)
    expect(result.messages.some((m) => m.content === 'before')).toBe(false)
    expect(result.messages.some((m) => m.content === 'cutoff')).toBe(false)
    expect(result.messages.some((m) => m.content === 'after')).toBe(true)
  })
})

describe('Phase 7-5a buildHistoryWindow role mapping', () => {
  it("maps msg.role 'user' to 'user' and 'char' to 'assistant'", () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: 'hello' }),
                makeMessage({ role: 'char', data: 'hi there' }),
              ],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    const userMsg = result.messages.find((m) => m.content === 'hello')
    const botMsg = result.messages.find((m) => m.content === 'hi there')
    expect(userMsg?.role).toBe('user')
    expect(botMsg?.role).toBe('assistant')
  })

  it('expands variables in per-message data', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: 'I am {{user}}' }),
              ],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(result.messages.some((m) => m.content === 'I am Alex')).toBe(true)
  })
})

function regex(
  inPat: string,
  out: string,
  type: string,
  flag?: string,
): { comment: string; in: string; out: string; type: string; flag?: string; ableFlag?: boolean } {
  return { comment: '', in: inPat, out, type, flag, ableFlag: false }
}

describe('Phase 7-5b buildHistoryWindow per-message processScript', () => {
  it("runs editprocess regex against each message's data", () => {
    const db = makeDatabase({
      presetRegex: [regex('hello', 'hi', 'editprocess')],
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [makeMessage({ role: 'user', data: 'hello world' })],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(result.messages.some((m) => m.content === 'hi world')).toBe(true)
  })

  it('runs editprocess regex against the first message body', () => {
    const db = makeDatabase({
      presetRegex: [regex('greeting', 'hail', 'editprocess')],
      characters: [
        makeCharacter({
          firstMessage: 'default greeting',
          chats: [makeChat()],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(
      result.messages.some(
        (m) => m.role === 'assistant' && m.content === 'default hail',
      ),
    ).toBe(true)
  })

  it("does not run editoutput regex during the editprocess pass", () => {
    const db = makeDatabase({
      presetRegex: [regex('hello', 'hi', 'editoutput')],
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [makeMessage({ role: 'user', data: 'hello world' })],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(result.messages.some((m) => m.content === 'hello world')).toBe(true)
  })
})

describe('Phase 7-5b buildHistoryWindow memo / chatId backfill', () => {
  it('passes msg.chatId through to memo when present', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: 'hi', chatId: 'msg-42' }),
              ],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    expect(result.messages.find((m) => m.content === 'hi')?.memo).toBe('msg-42')
  })

  it('backfills missing msg.chatId with a uuid (mutated in place)', () => {
    const msg = makeMessage({ role: 'user', data: 'hi' })
    // simulate a Message without a pre-assigned chatId
    delete (msg as { chatId?: string }).chatId
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [makeChat({ message: [msg] })],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    const formatted = result.messages.find((m) => m.content === 'hi')
    expect(formatted?.memo).toMatch(/^[0-9a-f-]{36}$/i)
    expect((msg as { chatId?: string }).chatId).toBe(formatted?.memo)
  })
})

describe('Phase 7-5b buildHistoryWindow sendName wrapper', () => {
  it('does not prefix the first message when sendName is false', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({ firstMessage: 'hello', chats: [makeChat()] }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      true,
    )
    const first = result.messages.find(
      (m) => m.role === 'assistant' && m.content === 'hello',
    )
    expect(first?.attr).toBeUndefined()
  })

  it('prefixes the first message with `${char.name}: ` when usingPromptTemplate + sendName', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: true,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      } as Database['promptSettings'],
      characters: [
        makeCharacter({
          name: 'Lyra',
          firstMessage: 'hi there',
          chats: [makeChat()],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      true,
    )
    const first = result.messages.find((m) =>
      m.content?.startsWith('Lyra: '),
    )
    expect(first).toBeDefined()
    expect(first?.attr).toEqual(['nameAdded'])
  })

  it('does not prefix the first message when usingPromptTemplate is false even with sendName', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: true,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      } as Database['promptSettings'],
      characters: [
        makeCharacter({
          name: 'Lyra',
          firstMessage: 'hi there',
          chats: [makeChat()],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
    )
    const first = result.messages.find(
      (m) => m.role === 'assistant' && m.content === 'hi there',
    )
    expect(first?.attr).toBeUndefined()
  })

  it("wraps per-message content in `<{{char}}'s Message>` when usingPromptTemplate + sendName", () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: true,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      } as Database['promptSettings'],
      characters: [
        makeCharacter({
          name: 'Lyra',
          firstMessage: '',
          chats: [
            makeChat({
              message: [makeMessage({ role: 'user', data: 'hello' })],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      true,
    )
    const wrapped = result.messages.find((m) => m.role === 'user')
    expect(wrapped?.content).toBe(
      "<Lyra's Message>\nhello\n</Lyra's Message>",
    )
  })

  it('resolves the wrapper `{{char}}` against currentChar (matches SPA behavior with the dead `chara: saying` override)', () => {
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: true,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: -1,
        trimStartNewChat: false,
      } as Database['promptSettings'],
      characters: [
        makeCharacter({
          name: 'Lyra',
          chaId: 'char-lyra',
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data: 'hi',
                  saying: 'char-rex',
                }),
              ],
            }),
          ],
        }),
        makeCharacter({ name: 'Rex', chaId: 'char-rex' }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      true,
    )
    const wrapped = result.messages.find(
      (m) => m.memo !== undefined && m.role === 'assistant',
    )
    expect(wrapped?.content).toBe("<Lyra's Message>\nhi\n</Lyra's Message>")
  })
})

describe('Phase 7-5b buildHistoryWindow <Thoughts> extraction', () => {
  it('strips <Thoughts> from content', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data: 'Hello there.<Thoughts>plotting</Thoughts>',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    const msg = result.messages.find((m) => m.memo !== undefined && m.role === 'assistant')
    expect(msg?.content).toBe('Hello there.')
  })

  it('captures the thought body when maxThoughtTagDepth === -1', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data: 'visible<Thoughts>secret</Thoughts>',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    const msg = result.messages.find((m) => m.memo !== undefined && m.role === 'assistant')
    expect(msg?.thoughts).toEqual(['secret'])
  })

  it("strips but doesn't capture when maxThoughtTagDepth - totalCount > index", () => {
    // 1 message, totalCount = 1, index = 0, maxThoughtTagDepth = 5
    // → 5 - 1 = 4, and 4 > 0, so capture is skipped (still stripped).
    const db = makeDatabase({
      promptSettings: {
        assistantPrefill: '',
        postEndInnerFormat: '',
        sendChatAsSystem: false,
        sendName: false,
        utilOverride: false,
        customChainOfThought: false,
        maxThoughtTagDepth: 5,
        trimStartNewChat: false,
      } as Database['promptSettings'],
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data: 'visible<Thoughts>secret</Thoughts>',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
    )
    const msg = result.messages.find((m) => m.memo !== undefined && m.role === 'assistant')
    expect(msg?.content).toBe('visible')
    expect(msg?.thoughts).toBeUndefined()
  })
})
