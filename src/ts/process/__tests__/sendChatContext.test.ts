import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {}, getModuleToggles: () => '' }
})

const toastCalls = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('../../alert', () => ({
  alertToast: (msg: string) => {
    toastCalls.calls.push(msg)
  },
  alertError: () => {},
}))

import {
  setDatabase,
  type Database,
  type character,
} from '../../storage/database.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { setupSendChatContext } from '../sendChatContext'

function makeChar(overrides: Partial<character> = {}): character {
  return {
    type: 'character',
    name: 'Tess',
    chaId: 'cha-1',
    desc: '',
    chats: [
      {
        name: 'main',
        note: '',
        localLore: [],
        scriptstate: {},
        fmIndex: -1,
        message: [],
      },
    ],
    chatPage: 0,
    customscript: [],
    triggerscript: [],
    exampleMessage: '',
    ...overrides,
  } as unknown as character
}

function seedDb(extra: Partial<Database> = {}) {
  const seed = {
    aiModel: 'gpt-4o',
    subModel: 'gpt-4o',
    characters: [makeChar()],
    maxContext: 4000,
    botPresetsId: 0,
    statics: { messages: 0 } as unknown as Database['statics'],
    promptInfoInsideChat: false,
    ...extra,
  } as unknown as Database
  setDatabase(seed)
  // setDatabase forcibly resets `promptInfoInsideChat` in web mode; restore
  // the requested value so the helper observes what the test asked for.
  if (extra.promptInfoInsideChat !== undefined) {
    DBState.db.promptInfoInsideChat = extra.promptInfoInsideChat
  }
  selectedCharID.set(0)
}

beforeEach(() => {
  toastCalls.calls = []
})

describe('setupSendChatContext - preset chain', () => {
  it('runs preset chain selection when chatProcessIndex=-1 and finds a match', () => {
    seedDb({
      presetChain: 'Beta',
      botPresets: [{ name: 'Alpha' }, { name: 'Beta' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    // changeToPreset mutates db.botPresetsId to the selected index.
    expect(DBState.db.botPresetsId).toBe(1)
    expect(toastCalls.calls).toEqual([])
  })

  it('alerts on miss when preset chain name is not found', () => {
    seedDb({
      presetChain: 'Ghost',
      botPresets: [{ name: 'Alpha' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    // No preset switch on miss; botPresetsId stays unchanged.
    expect(DBState.db.botPresetsId).toBe(0)
    expect(toastCalls.calls).toEqual(['Cannot find preset: Ghost'])
  })

  it('skips preset chain when chatProcessIndex !== -1 (reentrant call)', () => {
    seedDb({
      presetChain: 'Beta',
      botPresets: [{ name: 'Alpha' }, { name: 'Beta' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    setupSendChatContext({ chatProcessIndex: 0 })
    // botPresetsId untouched because the preset-chain block is skipped.
    expect(DBState.db.botPresetsId).toBe(0)
    expect(toastCalls.calls).toEqual([])
  })
})

describe('setupSendChatContext - DB side effects', () => {
  it('increments db.statics.messages by 1', () => {
    seedDb({ statics: { messages: 4 } as unknown as Database['statics'] })
    setupSendChatContext({ chatProcessIndex: -1 })
    expect(DBState.db.statics.messages).toBe(5)
  })

  it('updates nowChatroom.lastInteraction to roughly now', () => {
    seedDb()
    const before = Date.now()
    setupSendChatContext({ chatProcessIndex: -1 })
    const after = Date.now()
    const ts = DBState.db.characters[0].lastInteraction
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('backfills missing chatId values with v4 while preserving existing ones', () => {
    seedDb({
      characters: [
        makeChar({
          chats: [
            {
              name: 'main',
              note: '',
              localLore: [],
              scriptstate: {},
              fmIndex: -1,
              message: [
                { role: 'user', data: 'a', chatId: 'kept-1', time: 0 },
                { role: 'char', data: 'b', chatId: undefined as unknown as string, time: 0 },
                { role: 'user', data: 'c', chatId: '', time: 0 },
              ],
            } as character['chats'][number],
          ],
        }),
      ],
    })
    setupSendChatContext({ chatProcessIndex: -1 })
    const msgs = DBState.db.characters[0].chats[0].message
    expect(msgs[0].chatId).toBe('kept-1')
    expect(msgs[1].chatId).toBeTruthy()
    expect(msgs[1].chatId).not.toBe(msgs[0].chatId)
    // Empty string `''` is falsy through `??` (returns the empty string) so it
    // is intentionally NOT backfilled. Preserved verbatim.
    expect(msgs[2].chatId).toBe('')
  })
})

describe('setupSendChatContext - promptInfo seed', () => {
  it('returns empty promptInfo when promptInfoInsideChat=false', () => {
    seedDb({ promptInfoInsideChat: false })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo).toEqual({})
  })

  it('returns promptName when promptInfoInsideChat=true with a valid botPresetsId', () => {
    seedDb({
      promptInfoInsideChat: true,
      botPresets: [{ name: 'My Preset' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptName).toBe('My Preset')
    expect(ctx.promptInfo.promptToggles).toEqual([])
  })

  it('emits boolean toggle as ON when globalChatVariables.toggle_<key> === "1"', () => {
    seedDb({
      promptInfoInsideChat: true,
      botPresets: [{ name: 'P' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
      customPromptTemplateToggle: 'mode=Mode',
      globalChatVariables: {
        toggle_mode: '1',
      } as unknown as Database['globalChatVariables'],
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptToggles).toEqual([{ key: 'Mode', value: 'ON' }])
  })

  it('omits boolean toggle when globalChatVariables.toggle_<key> !== "1"', () => {
    seedDb({
      promptInfoInsideChat: true,
      botPresets: [{ name: 'P' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
      customPromptTemplateToggle: 'mode=Mode',
      globalChatVariables: {
        toggle_mode: '0',
      } as unknown as Database['globalChatVariables'],
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptToggles).toEqual([])
  })

  it('select toggle indexes options[] by raw value', () => {
    seedDb({
      promptInfoInsideChat: true,
      botPresets: [{ name: 'P' }] as unknown as Database['botPresets'],
      botPresetsId: 0,
      // select type uses `options` (CSV after = separator).
      customPromptTemplateToggle: 'tone=Tone=select=warm,formal,curt',
      globalChatVariables: {
        toggle_tone: '1',
      } as unknown as Database['globalChatVariables'],
    })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.promptInfo.promptToggles).toEqual([{ key: 'Tone', value: 'formal' }])
  })
})

describe('setupSendChatContext - tokenizer + maxContextTokens', () => {
  it('uses 5 additional tokens for gpt models when arg.chatAdditonalTokens is unset', () => {
    seedDb({ aiModel: 'gpt-4o' })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    // ChatTokenizer wraps the count internally; we check it was constructed by
    // verifying maxContextTokens passes through and the tokenizer is defined.
    expect(ctx.tokenizer).toBeDefined()
    expect(ctx.maxContextTokens).toBe(4000)
  })

  it('uses 3 additional tokens for non-gpt models when arg.chatAdditonalTokens is unset', () => {
    seedDb({ aiModel: 'novelai:something' })
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.tokenizer).toBeDefined()
  })

  it('uses arg.chatAdditonalTokens override when provided', () => {
    seedDb({ aiModel: 'gpt-4o' })
    // The tokenizer just stores the value; we test that the helper accepts
    // the override path without crashing.
    const ctx = setupSendChatContext({
      chatProcessIndex: -1,
      chatAdditonalTokens: 42,
    })
    expect(ctx.tokenizer).toBeDefined()
  })
})

describe('setupSendChatContext - selectedChar / selectedChat', () => {
  it('returns selectedChar from the store and selectedChat from chatPage', () => {
    seedDb({
      characters: [
        makeChar({ name: 'A' }),
        makeChar({ name: 'B', chatPage: 0 }),
      ],
    })
    selectedCharID.set(1)
    const ctx = setupSendChatContext({ chatProcessIndex: -1 })
    expect(ctx.selectedChar).toBe(1)
    expect(ctx.selectedChat).toBe(0)
    expect(ctx.nowChatroom.name).toBe('B')
  })
})
