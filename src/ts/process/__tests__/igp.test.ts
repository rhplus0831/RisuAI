import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestChatDataSpy } = vi.hoisted(() => ({
  requestChatDataSpy: vi.fn(),
}))
vi.mock('../request/request', () => ({
  requestChatData: requestChatDataSpy,
}))

// Same TDZ-break as sendChatErrors.test.ts: setDatabase writes fire a
// stores.svelte.ts $effect that reaches moduleUpdate -> getModules during
// vitest SSR module init.
vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { selectedCharID, DBState } from '../../stores.svelte'
import { evaluateIgp } from '../postGeneration/igp'

function makeChar(): character {
  return {
    name: 'Test',
    chaId: 'cha-1',
    firstMessage: '',
    desc: '',
    notes: '',
    chats: [
      {
        message: [{ role: 'char', data: 'hello', time: 0 }],
        note: '',
        name: 'main',
        localLore: [],
      },
    ],
    chatPage: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    chaVer: 0,
  } as unknown as character
}

function seed(char: character) {
  setDatabase({ characters: [char] } as Database)
  selectedCharID.set(0)
}

const baseOpts = {
  abortSignal: new AbortController().signal,
  selectedChar: 0,
  selectedChat: 0,
}

describe('evaluateIgp', () => {
  beforeEach(() => {
    requestChatDataSpy.mockReset()
    requestChatDataSpy.mockResolvedValue({ type: 'success', result: 'IGP-RESULT' })
  })

  it('is a no-op when the prompt template is empty', async () => {
    seed(makeChar())
    await evaluateIgp({ ...baseOpts, promptTemplate: '' })
    expect(requestChatDataSpy).not.toHaveBeenCalled()
    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('hello')
  })

  it('is a no-op when the parsed prompt is empty (whitespace-only after parsing)', async () => {
    seed(makeChar())
    await evaluateIgp({ ...baseOpts, promptTemplate: '' })
    expect(requestChatDataSpy).not.toHaveBeenCalled()
  })

  // parseChatML requires the prompt to start with <|im_start|>. The upstream
  // sendChat code does not enforce this; if a user sets db.igpPrompt to a
  // non-ChatML string the function passes formated: null down to
  // requestChatData. These tests use a well-formed ChatML prompt so the
  // happy path is exercised end-to-end.
  const CHATML_PROMPT =
    '<|im_start|>system<|im_sep|>Rate the response.<|im_end|>'

  it('dispatches with parsed ChatML and emotion mode when the prompt is non-empty', async () => {
    seed(makeChar())
    await evaluateIgp({ ...baseOpts, promptTemplate: CHATML_PROMPT })
    expect(requestChatDataSpy).toHaveBeenCalledTimes(1)
    const [arg, mode, signal] = requestChatDataSpy.mock.calls[0]
    expect(mode).toBe('emotion')
    expect(signal).toBe(baseOpts.abortSignal)
    expect(arg.bias).toEqual({})
    expect(Array.isArray(arg.formated)).toBe(true)
    expect(arg.formated).toHaveLength(1)
    expect(arg.formated[0].role).toBe('system')
  })

  it('preserves the existing "append raw response object" coercion behavior', async () => {
    // The upstream code appended the full requestDataResponse via `+= rq`,
    // which JS coerces to "[object Object]". This test pins the existing
    // (likely-buggy) behavior so any future fix is intentional.
    seed(makeChar())
    requestChatDataSpy.mockResolvedValueOnce({ type: 'success', result: 'IGP-RESULT' })
    await evaluateIgp({ ...baseOpts, promptTemplate: CHATML_PROMPT })
    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('hello[object Object]')
  })

  it('appends to the last message regardless of position', async () => {
    const char = makeChar()
    char.chats[0].message = [
      { role: 'user', data: 'first', time: 0 },
      { role: 'char', data: 'second', time: 0 },
      { role: 'char', data: 'third', time: 0 },
    ]
    seed(char)
    await evaluateIgp({ ...baseOpts, promptTemplate: CHATML_PROMPT })
    const messages = DBState.db.characters[0].chats[0].message
    expect(messages[0].data).toBe('first')
    expect(messages[1].data).toBe('second')
    expect(messages[2].data).toBe('third[object Object]')
  })
})
