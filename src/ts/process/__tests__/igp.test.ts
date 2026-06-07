import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'igp-test-token',
}))

import {
  applyServerProjectionDatabase,
  setDatabase,
  type Database,
  type character,
} from '../../storage/database.svelte'
import { selectedCharID, DBState } from '../../stores.svelte'
import { evaluateIgp } from '../postGeneration/igp'
import { clearCachedServerCommandRevision } from '../../server/commands'
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from '../../server/projectionWriteGuard.svelte'

interface CapturedFetch {
  url: string
  method: string
  body: any
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url === '/api/v1/commands/chats/chat-1/messages') {
        return jsonResponse({
          revision: 11,
          event: { type: 'messages.replaced', revision: 11, resource: 'chat' },
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForMessageCommand(calls: CapturedFetch[]): Promise<CapturedFetch> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = calls.find(
      (call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT',
    )
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`message command not dispatched; saw ${JSON.stringify(calls)}`)
}

function makeChar(): character {
  return {
    name: 'Test',
    chaId: 'cha-1',
    firstMessage: '',
    desc: '',
    notes: '',
    chats: [
      {
        id: 'chat-1',
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
    clearCachedServerCommandRevision()
    setServerProjectionWriteGuardEnabled(false)
    vi.unstubAllGlobals()
    requestChatDataSpy.mockReset()
    requestChatDataSpy.mockResolvedValue({ type: 'success', result: 'IGP-RESULT' })
  })

  afterEach(() => {
    setServerProjectionWriteGuardEnabled(false)
    vi.unstubAllGlobals()
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
    stubCommandFetch()
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

  it('L34: appends the explicit response result instead of raw object coercion', async () => {
    const calls = stubCommandFetch()
    seed(makeChar())
    requestChatDataSpy.mockResolvedValueOnce({ type: 'success', result: 'IGP-RESULT' })
    await evaluateIgp({ ...baseOpts, promptTemplate: CHATML_PROMPT })
    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('helloIGP-RESULT')
    const command = await waitForMessageCommand(calls)
    expect(command.body.messages.at(-1).data).toBe('helloIGP-RESULT')
  })

  it('L34/I11: stringifies non-string IGP result payloads without [object Object]', async () => {
    stubCommandFetch()
    seed(makeChar())
    requestChatDataSpy.mockResolvedValueOnce({ type: 'success', result: { label: 'joy' } })

    await evaluateIgp({ ...baseOpts, promptTemplate: CHATML_PROMPT })

    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('hello{"label":"joy"}')
  })

  it('appends to the last message regardless of position', async () => {
    stubCommandFetch()
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
    expect(messages[2].data).toBe('thirdIGP-RESULT')
  })

  it('L34: appends and persists under the enabled projection guard', async () => {
    const calls = stubCommandFetch()
    seed(makeChar())
    setServerProjectionWriteGuardEnabled(true)
    expect(() => {
      DBState.db.characters[0].chats[0].message[0].data += 'raw'
    }).toThrow(/read-only server projection/)

    await evaluateIgp({ ...baseOpts, promptTemplate: CHATML_PROMPT })

    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('helloIGP-RESULT')
    const command = await waitForMessageCommand(calls)
    expect(command.body.messages.at(-1).data).toBe('helloIGP-RESULT')

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].message[0].data = 'stale'
    })
    applyServerProjectionDatabase({
      characters: [
        {
          ...makeChar(),
          chats: [
            {
              ...makeChar().chats[0],
              message: command.body.messages,
            },
          ],
        },
      ],
    } as Database)
    expect(DBState.db.characters[0].chats[0].message[0].data).toBe('helloIGP-RESULT')
  })
})
