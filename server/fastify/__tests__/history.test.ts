import { beforeAll, describe, expect, it } from 'vitest'
import type {
  Chat,
  Database,
  Message,
  character,
} from '../../../src/ts/storage/database.svelte'
import {
  applyDepthPrompts,
  buildHistoryWindow,
  exampleMessage,
  type AssetLookup,
} from '../src/prompt/history.js'
import type {
  LoreEntryActive,
  LorebookActivationReport,
} from '../src/prompt/lorebook.js'
import type { MultiModal, OpenAIChat } from '../../../src/ts/process/index.svelte'
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

function imageMM(base64 = 'IMG'): MultiModal {
  return { type: 'image', base64 }
}

function findUser(messages: import('vitest').Mock extends never ? never : any) {
  return messages.find((m: any) => m.role === 'user' && m.memo !== undefined)
}

describe('Phase 7-5c char-role inlay tag handling', () => {
  it('strips {{inlay::x}} from char-role content without pushing a multimodal', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data: 'pre {{inlay::asset-1}} post',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const lookup: AssetLookup = {
      getInlay: () => imageMM('UNEXPECTED'),
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = result.messages.find(
      (m) => m.role === 'assistant' && m.memo !== undefined,
    )
    expect(msg?.content).toBe('pre  post')
    expect(msg?.multimodals).toBeUndefined()
  })

  it('strips {{inlayed::x}} without pushing a multimodal', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data: 'A {{inlayed::asset-2}} B',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const lookup: AssetLookup = {
      getInlay: () => imageMM('UNEXPECTED'),
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = result.messages.find(
      (m) => m.role === 'assistant' && m.memo !== undefined,
    )
    expect(msg?.content).toBe('A  B')
    expect(msg?.multimodals).toBeUndefined()
  })

  it('strips {{inlayeddata::x}} and pushes the resolved multimodal', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data: 'before {{inlayeddata::sig-7}} after',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const lookup: AssetLookup = {
      getInlay: (id) =>
        id === 'sig-7' ? { type: 'image', base64: 'SIG7' } : undefined,
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = result.messages.find(
      (m) => m.role === 'assistant' && m.memo !== undefined,
    )
    expect(msg?.content).toBe('before  after')
    expect(msg?.multimodals).toEqual([{ type: 'image', base64: 'SIG7' }])
  })

  it('strips inlay tag even when the lookup returns nothing', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data: 'x {{inlayeddata::missing}} y',
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
    const msg = result.messages.find(
      (m) => m.role === 'assistant' && m.memo !== undefined,
    )
    expect(msg?.content).toBe('x  y')
    expect(msg?.multimodals).toBeUndefined()
  })
})

describe('Phase 7-5c user-role inlay tag handling', () => {
  it('looks up and strips all three inlay tag types', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'user',
                  data: 'see {{inlay::u-1}} and {{inlayeddata::u-2}}',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const lookup: AssetLookup = {
      getInlay: (id) =>
        id === 'u-1' || id === 'u-2'
          ? { type: 'image', base64: `data-${id}` }
          : undefined,
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = findUser(result.messages)
    expect(msg?.content).toBe('see  and ')
    expect(msg?.multimodals).toEqual([
      { type: 'image', base64: 'data-u-1' },
      { type: 'image', base64: 'data-u-2' },
    ])
  })

  it('caps video / audio multimodals at one entry total', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'user',
                  data: '{{inlayeddata::v1}} {{inlayeddata::v2}}',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const lookup: AssetLookup = {
      getInlay: (id) => ({
        type: 'video',
        base64: `vid-${id}`,
      }),
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = findUser(result.messages)
    expect(msg?.multimodals).toEqual([{ type: 'video', base64: 'vid-v1' }])
  })
})

describe('Phase 7-5c {{asset_prompt::name}} handling', () => {
  it('resolves a matching additionalAssets entry into a multimodal', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          additionalAssets: [['logo', 'asset-id-1', 'image']],
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'user',
                  data: 'see {{asset_prompt::logo}} thanks',
                }),
              ],
            }),
          ],
        } as Partial<character>),
      ],
    })
    const lookup: AssetLookup = {
      getAsset: (name) =>
        name === 'logo' ? { type: 'image', base64: 'LOGO' } : undefined,
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = findUser(result.messages)
    expect(msg?.content).toBe('see  thanks')
    expect(msg?.multimodals).toEqual([{ type: 'image', base64: 'LOGO' }])
  })

  it("falls through to getCharIcon when the name is 'icon' and no asset matches", () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: '{{asset_prompt::icon}}' }),
              ],
            }),
          ],
        }),
      ],
    })
    const lookup: AssetLookup = {
      getCharIcon: () => ({ type: 'image', base64: 'ICON' }),
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = findUser(result.messages)
    expect(msg?.content).toBe('')
    expect(msg?.multimodals).toEqual([{ type: 'image', base64: 'ICON' }])
  })

  it('strips the tag even when no asset matches and the name is not "icon"', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: 'pre {{asset_prompt::unknown}} post' }),
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
    const msg = findUser(result.messages)
    expect(msg?.content).toBe('pre  post')
    expect(msg?.multimodals).toBeUndefined()
  })

  it('also matches the underscore-less {{assetprompt::name}} syntax (SPA `asset_?prompt`)', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          additionalAssets: [['logo', 'asset-id-1', 'image']],
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: '{{assetprompt::logo}}' }),
              ],
            }),
          ],
        } as Partial<character>),
      ],
    })
    const lookup: AssetLookup = {
      getAsset: () => ({ type: 'image', base64: 'LOGO' }),
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = findUser(result.messages)
    expect(msg?.content).toBe('')
    expect(msg?.multimodals).toEqual([{ type: 'image', base64: 'LOGO' }])
  })

  it('pulls asset names from active modules as well as the character', () => {
    const db = makeDatabase({
      enabledModules: ['m1'],
      modules: [
        {
          name: 'm1',
          description: '',
          id: 'm1',
          assets: [['shared', 'shared-id', 'image']],
        },
      ],
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: '{{asset_prompt::shared}}' }),
              ],
            }),
          ],
        }),
      ],
    } as Partial<Database>)
    const lookup: AssetLookup = {
      getAsset: (name) =>
        name === 'shared' ? { type: 'image', base64: 'SHARED' } : undefined,
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = findUser(result.messages)
    expect(msg?.content).toBe('')
    expect(msg?.multimodals).toEqual([{ type: 'image', base64: 'SHARED' }])
  })

  it('omits the multimodals field entirely when nothing resolves', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({ role: 'user', data: 'plain content' }),
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
    const msg = findUser(result.messages)
    expect(msg).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(msg, 'multimodals')).toBe(false)
  })
})

describe('Phase 7-5c multimodals + thoughts coexist on the same chat', () => {
  it('keeps both fields on a single char-role message', () => {
    const db = makeDatabase({
      characters: [
        makeCharacter({
          firstMessage: '',
          chats: [
            makeChat({
              message: [
                makeMessage({
                  role: 'char',
                  data:
                    'visible<Thoughts>secret</Thoughts> {{inlayeddata::pic}}',
                }),
              ],
            }),
          ],
        }),
      ],
    })
    const lookup: AssetLookup = {
      getInlay: (id) =>
        id === 'pic' ? { type: 'image', base64: 'PIC' } : undefined,
    }
    const result = buildHistoryWindow(
      ctxFor(db),
      db.characters[0],
      db.characters[0].chats[0],
      false,
      lookup,
    )
    const msg = result.messages.find(
      (m) => m.role === 'assistant' && m.memo !== undefined,
    )
    expect(msg?.content).toBe('visible ')
    expect(msg?.thoughts).toEqual(['secret'])
    expect(msg?.multimodals).toEqual([{ type: 'image', base64: 'PIC' }])
  })
})

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

function makeReport(actives: LoreEntryActive[] = []): LorebookActivationReport {
  return { actives, disabledUIPrompts: [], matchLog: [] }
}

function depthCtx(): ExpandContext {
  return { database: makeDatabase() }
}

describe('Phase 7-7e applyDepthPrompts', () => {
  it('returns the array unchanged when no depth entries are active', () => {
    const messages: OpenAIChat[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]
    const out = applyDepthPrompts(
      messages,
      depthCtx(),
      makeCharacter(),
      makeReport([
        makeActive({ pos: '', prompt: 'plain' }),
        makeActive({ pos: 'after_desc', prompt: 'desc' }),
      ]),
    )
    expect(out).toBe(messages)
    expect(out.map((m) => m.content)).toEqual(['hello', 'hi'])
  })

  it('@@depth 1 inserts at index 1 (right after the first message)', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: '[Start a new chat]' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]
    applyDepthPrompts(
      messages,
      depthCtx(),
      makeCharacter(),
      makeReport([
        makeActive({ pos: 'depth', depth: 1, prompt: 'INSERTED', source: 'd1' }),
      ]),
    )
    expect(messages.map((m) => m.content)).toEqual([
      '[Start a new chat]',
      'INSERTED',
      'first',
      'reply',
    ])
  })

  it('@@reverse_depth 1 inserts at length-1 (just before the last message)', () => {
    const messages: OpenAIChat[] = [
      { role: 'system', content: '[Start a new chat]' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'last' },
    ]
    applyDepthPrompts(
      messages,
      depthCtx(),
      makeCharacter(),
      makeReport([
        makeActive({ pos: 'reverse_depth', depth: 1, prompt: 'TAIL', source: 'r1' }),
      ]),
    )
    expect(messages.map((m) => m.content)).toEqual([
      '[Start a new chat]',
      'first',
      'TAIL',
      'last',
    ])
  })

  it('honors the entry role on the inserted chat', () => {
    const messages: OpenAIChat[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]
    applyDepthPrompts(
      messages,
      depthCtx(),
      makeCharacter(),
      makeReport([
        makeActive({ pos: 'depth', depth: 1, prompt: 'U', role: 'user', source: 'd' }),
      ]),
    )
    expect(messages[1]).toEqual({ role: 'user', content: 'U' })
  })

  it('iterates report.actives in order; reverse_depth uses the live length', () => {
    // Mirrors the SPA fixture lorebook-position-depth.json: when both
    // a reverse_depth=1 and depth=1 entry fire, the resulting layout
    // depends on the order they appear in `report.actives` (which is
    // the post-sort+reverse order from activateLorebook).
    const messages: OpenAIChat[] = [
      { role: 'system', content: 'NewChat' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ]
    applyDepthPrompts(
      messages,
      depthCtx(),
      makeCharacter(),
      makeReport([
        makeActive({ pos: 'reverse_depth', depth: 1, prompt: 'REV', source: 'r' }),
        makeActive({ pos: 'depth', depth: 1, prompt: 'FWD', source: 'd' }),
      ]),
    )
    // Step 1: splice REV at length-1 = 3 -> [NewChat, first, reply, REV, second]
    // Step 2: splice FWD at 1 -> [NewChat, FWD, first, reply, REV, second]
    expect(messages.map((m) => m.content)).toEqual([
      'NewChat',
      'FWD',
      'first',
      'reply',
      'REV',
      'second',
    ])
  })

  it('expands {{user}} CBS in the depth-prompt body', () => {
    const messages: OpenAIChat[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]
    applyDepthPrompts(
      messages,
      depthCtx(),
      makeCharacter(),
      makeReport([
        makeActive({
          pos: 'depth',
          depth: 1,
          prompt: 'hello {{user}}',
          source: 'cbs',
        }),
      ]),
    )
    // makeDatabase sets username='Alex'.
    expect(messages[1].content).toBe('hello Alex')
  })

  it('resolves {{position::pt_slot}} markers against the same report', () => {
    const messages: OpenAIChat[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]
    applyDepthPrompts(
      messages,
      depthCtx(),
      makeCharacter(),
      makeReport([
        makeActive({
          pos: 'depth',
          depth: 1,
          prompt: 'top: {{position::slot}}',
          source: 'd',
        }),
        makeActive({ pos: 'pt_slot', prompt: 'SLOTBODY' }),
      ]),
    )
    expect(messages[1].content).toBe('top: SLOTBODY')
  })
})

describe('Phase 7-5e buildHistoryWindow token accumulation', () => {
  it('sums per-message tokens with gpt overhead 5 and noName', () => {
    // gpt-4o-mini → o200k_base, overhead 5, useName 'noName'.
    // First message is suppressed by setting both firstMessage and
    // fmIndex's slot to empty strings, so the only contributors are
    // the start-new-chat marker ([Start a new chat] = 6 tokens) and
    // the two user messages.
    const db = makeDatabase({ aiModel: 'gpt-4o-mini' })
    const result = buildHistoryWindow(
      ctxFor(db),
      makeCharacter({ firstMessage: '', alternateGreetings: [''] }),
      makeChat({
        fmIndex: 0,
        message: [
          makeMessage({ role: 'user', data: 'hi', chatId: 'a' }),
          makeMessage({ role: 'char', data: 'hello', chatId: 'b' }),
        ],
      }),
    )
    // marker: 6 + 5 = 11; empty first message: 0 + 5 = 5;
    // user 'hi': 1 + 5 = 6; assistant 'hello': 1 + 5 = 6.
    expect(result.addedTokens).toBe(11 + 5 + 6 + 6)
  })

  it('uses non-gpt overhead 3 and counts `name` when present', () => {
    // claude → cl100k_base, overhead 3, useName 'name'. Example
    // messages emit `name: 'example_user' | 'example_assistant'`,
    // which adds (name tokens + 1 separator) per row.
    const db = makeDatabase({
      aiModel: 'claude-3-5-sonnet',
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
      makeCharacter({
        firstMessage: '',
        alternateGreetings: [''],
        exampleMessage: '{{user}}: hi\n{{char}}: hello',
      }),
      makeChat({ fmIndex: 0 }),
    )
    // example_user 'hi': 1 + 3 + (2 + 1) = 7
    // example_assistant 'hello': 1 + 3 + (3 + 1) = 8
    // empty first message: 0 + 3 = 3 (no name)
    // start-new-chat marker is trimmed via trimStartNewChat.
    expect(result.addedTokens).toBe(7 + 8 + 3)
  })

  it('routes through o200k_base for the gpt-4o family', () => {
    // `café résumé 漢字` diverges: cl100k_base → 9, o200k_base → 6.
    const db = makeDatabase({
      aiModel: 'gpt-4o',
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
      makeCharacter({ firstMessage: 'café résumé 漢字' }),
      makeChat(),
    )
    // o200k tokenization of the first message: 6 + 5 (gpt overhead) = 11.
    expect(result.addedTokens).toBe(11)
  })

  it('folds depth-prompt tokens into addedTokens when a report is provided', () => {
    const db = makeDatabase({
      aiModel: 'gpt-4o',
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
    const report = makeReport([
      makeActive({ pos: 'depth', depth: 1, prompt: 'depth body' }),
    ])
    const withReport = buildHistoryWindow(
      ctxFor(db),
      makeCharacter({ firstMessage: '' }),
      makeChat({ fmIndex: 0, alternateGreetings: [] } as Partial<Chat>),
      false,
      undefined,
      report,
    )
    const without = buildHistoryWindow(
      ctxFor(db),
      makeCharacter({ firstMessage: '' }),
      makeChat({ fmIndex: 0, alternateGreetings: [] } as Partial<Chat>),
    )
    // Depth prompt 'depth body' on o200k_base = 2 tokens + 5 overhead.
    expect(withReport.addedTokens - without.addedTokens).toBe(2 + 5)
  })

  it('returns zero depth-prompt contribution when no report is provided', () => {
    const db = makeDatabase({
      aiModel: 'gpt-4o',
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
      makeCharacter({ firstMessage: 'default greeting' }),
      makeChat(),
    )
    // First message 'default greeting' on o200k = 2 + 5 = 7.
    expect(result.addedTokens).toBe(7)
  })

  it('tokenizes depth prompts after {{position::pt_}} resolution, not the raw marker', () => {
    const db = makeDatabase({
      aiModel: 'gpt-4o',
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
    const report = makeReport([
      makeActive({
        pos: 'depth',
        depth: 1,
        prompt: 'before {{position::slot}} after',
      }),
      makeActive({ pos: 'pt_slot', prompt: 'SLOT VALUE' }),
    ])
    const result = buildHistoryWindow(
      ctxFor(db),
      makeCharacter({ firstMessage: '' }),
      makeChat(),
      false,
      undefined,
      report,
    )
    // Resolved body 'before SLOT VALUE after' = 4 tokens + 5 overhead.
    // First message is empty: 0 + 5 = 5. Total = 5 + 9 = 14. The raw
    // 'before {{position::slot}} after' (7 tokens) would give 5 + 12 = 17.
    expect(result.addedTokens).toBe(5 + 4 + 5)
  })

  it('counts examples and the start-new-chat marker in addedTokens', () => {
    // gpt → overhead 5, noName. The example block emits a `<start>`
    // row plus per-line bot/user rows. Combined with the default
    // start-new-chat marker emitted afterward, addedTokens covers
    // every emitted row.
    const db = makeDatabase({ aiModel: 'gpt4' })
    const result = buildHistoryWindow(
      ctxFor(db),
      makeCharacter({
        firstMessage: '',
        alternateGreetings: [''],
        exampleMessage: '<start>\n{{user}}: hi\n{{char}}: hello',
      }),
      makeChat({ fmIndex: 0 }),
    )
    // Example rows on cl100k_base (gpt4 is NOT in the o200k prefix list):
    //   '[Start a new chat]' marker from <start>: 6 + 5 = 11
    //   'hi' (user, noName so name ignored): 1 + 5 = 6
    //   'hello' (assistant, noName): 1 + 5 = 6
    // Marker after examples: 6 + 5 = 11
    // First message empty: 0 + 5 = 5
    expect(result.addedTokens).toBe(11 + 6 + 6 + 11 + 5)
  })
})
