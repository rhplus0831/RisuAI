import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { alertErrorSpy } = vi.hoisted(() => ({ alertErrorSpy: vi.fn() }))
vi.mock('../../alert', async (importActual) => {
  const actual = await importActual<typeof import('../../alert')>()
  return { ...actual, alertError: alertErrorSpy }
})

// Break a circular-init chain where stores.svelte imports trigger moduleUpdate,
// then getModules/getDatabase before all DB imports are initialized in this test
// file's dependency graph. The tests do not exercise modules; a noop is safe.
vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

vi.mock('../../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'send-error-test-token',
}))

import {
  applyServerProjectionDatabase,
  setDatabase,
  type Database,
  type character,
} from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { DBState } from '../../stores.svelte'
import { reportSendChatError, type SendChatErrorContext } from '../sendChatErrors'
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
      if (url.startsWith('/api/v1/commands/chats/') && url.endsWith('/messages')) {
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
    const match = calls.find((call) => call.url === '/api/v1/commands/chats/chat-1/messages' && call.method === 'PUT')
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`message command not dispatched; saw ${JSON.stringify(calls)}`)
}

function makeChar(): character {
  return {
    name: 'Test',
    chaId: 'test-cha-id',
    firstMessage: '',
    desc: '',
    notes: '',
    chats: [
      {
        id: 'chat-1',
        message: [],
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

function seed(opts: { inlayErrorResponse: boolean; char?: character | null }) {
  const db: Partial<Database> = {
    inlayErrorResponse: opts.inlayErrorResponse,
    characters: opts.char === null ? [] : [opts.char ?? makeChar()],
  }
  setDatabase(db as Database)
  selectedCharID.set(0)
}

const baseCtx: SendChatErrorContext = {
  selectedChar: 0,
  selectedChat: 0,
  currentChar: undefined,
  generationInfo: undefined,
}

describe('reportSendChatError', () => {
  beforeEach(() => {
    clearCachedServerCommandRevision()
    setServerProjectionWriteGuardEnabled(false)
    vi.unstubAllGlobals()
    stubCommandFetch()
    alertErrorSpy.mockReset()
    // Each test calls seed() which wholesale reseeds DBState. Restoring to {}
    // between tests would fire a $effect chain that reads modules off a partial
    // DB and throws (same shape as the guard in parser.svelte.ts).
  })

  afterEach(() => {
    setServerProjectionWriteGuardEnabled(false)
    vi.unstubAllGlobals()
  })

  it('falls back to alertError when inlayErrorResponse is off', () => {
    seed({ inlayErrorResponse: false })
    reportSendChatError('boom', baseCtx)
    expect(alertErrorSpy).toHaveBeenCalledTimes(1)
    expect(alertErrorSpy).toHaveBeenCalledWith('boom')
    expect(DBState.db.characters[0].chats[0].message).toHaveLength(0)
  })

  it('falls back to alertError when the character slot is missing', () => {
    seed({ inlayErrorResponse: true, char: null })
    reportSendChatError('boom', { ...baseCtx, selectedChar: 5 })
    expect(alertErrorSpy).toHaveBeenCalledWith('boom')
  })

  it('falls back to alertError when the chat slot is invalid', () => {
    const char = makeChar()
    char.chats = []
    seed({ inlayErrorResponse: true, char })
    reportSendChatError('boom', baseCtx)
    expect(alertErrorSpy).toHaveBeenCalledWith('boom')
  })

  it('appends the error suffix when the last message is from char', () => {
    const char = makeChar()
    char.chats[0].message = [
      { role: 'user', data: 'hi', time: 0 },
      { role: 'char', data: 'hello', time: 0 },
    ]
    seed({ inlayErrorResponse: true, char })
    reportSendChatError('boom', baseCtx)
    expect(alertErrorSpy).not.toHaveBeenCalled()
    const messages = DBState.db.characters[0].chats[0].message
    expect(messages).toHaveLength(2)
    expect(messages[1].data).toBe('hello\n```risuerror\nboom\n```')
  })

  it('pushes a new char message when the last message is from user', () => {
    const char = makeChar()
    char.chats[0].message = [{ role: 'user', data: 'hi', time: 0 }]
    seed({ inlayErrorResponse: true, char })
    reportSendChatError('boom', { ...baseCtx, currentChar: char })
    const messages = DBState.db.characters[0].chats[0].message
    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe('char')
    expect(messages[1].data).toBe('```risuerror\nboom\n```')
    expect(messages[1].saying).toBe('test-cha-id')
  })

  it('pushes a new char message when the chat is empty', () => {
    seed({ inlayErrorResponse: true })
    reportSendChatError('boom', baseCtx)
    const messages = DBState.db.characters[0].chats[0].message
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('char')
    expect(messages[0].data).toBe('```risuerror\nboom\n```')
  })

  it('attaches generationInfo to the pushed message when present', () => {
    seed({ inlayErrorResponse: true })
    reportSendChatError('boom', {
      ...baseCtx,
      generationInfo: { model: 'test-model', generationId: 'g-1' },
    })
    const messages = DBState.db.characters[0].chats[0].message
    expect(messages[0].generationInfo).toEqual({
      model: 'test-model',
      generationId: 'g-1',
    })
  })

  it('falls back to alertError when reading ctx.currentChar throws', () => {
    const char = makeChar()
    char.chats[0].message = [{ role: 'user', data: 'hi', time: 0 }]
    seed({ inlayErrorResponse: true, char })
    const evilChar = {
      get chaId(): string {
        throw new Error('forced')
      },
    } as unknown as character
    reportSendChatError('boom', { ...baseCtx, currentChar: evilChar })
    expect(alertErrorSpy).toHaveBeenCalledWith('boom')
  })

  it('falls back to selectedCharID store when ctx.selectedChar is negative', () => {
    seed({ inlayErrorResponse: true })
    selectedCharID.set(0)
    reportSendChatError('boom', { ...baseCtx, selectedChar: -1 })
    const messages = DBState.db.characters[0].chats[0].message
    expect(messages).toHaveLength(1)
    expect(messages[0].data).toBe('```risuerror\nboom\n```')
  })

  it('falls back to charRoom.chatPage when ctx.selectedChat is negative', () => {
    const char = makeChar()
    char.chats = [
      { id: 'chat-1', message: [], note: '', name: 'a', localLore: [] } as never,
      { id: 'chat-2', message: [], note: '', name: 'b', localLore: [] } as never,
    ]
    char.chatPage = 1
    seed({ inlayErrorResponse: true, char })
    reportSendChatError('boom', { ...baseCtx, selectedChat: -1 })
    expect(DBState.db.characters[0].chats[0].message).toHaveLength(0)
    expect(DBState.db.characters[0].chats[1].message).toHaveLength(1)
  })

  it('L35: writes and persists the inlay bubble under the enabled projection guard', async () => {
    const calls = stubCommandFetch()
    const char = makeChar()
    char.chats[0].message = [{ role: 'user', data: 'hi', time: 0, chatId: 'm-user' }]
    seed({ inlayErrorResponse: true, char })
    setServerProjectionWriteGuardEnabled(true)
    expect(() => {
      DBState.db.characters[0].chats[0].message.push({ role: 'char', data: 'raw' })
    }).toThrow(/read-only server projection/)

    reportSendChatError('boom', { ...baseCtx, currentChar: char })

    const messages = DBState.db.characters[0].chats[0].message
    expect(alertErrorSpy).not.toHaveBeenCalled()
    expect(messages.at(-1)).toMatchObject({
      role: 'char',
      data: '```risuerror\nboom\n```',
      saying: 'test-cha-id',
    })

    const command = await waitForMessageCommand(calls)
    expect(command.body.messages.at(-1)).toMatchObject({
      role: 'char',
      data: '```risuerror\nboom\n```',
      saying: 'test-cha-id',
    })

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].message = [{ role: 'user', data: 'stale' }]
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
      inlayErrorResponse: true,
    } as Database)
    expect(DBState.db.characters[0].chats[0].message.at(-1).data).toBe('```risuerror\nboom\n```')
  })

  it('L35: keeps modal fallback for invalid targets while the guard is enabled', () => {
    seed({ inlayErrorResponse: true, char: null })
    setServerProjectionWriteGuardEnabled(true)

    reportSendChatError('boom', { ...baseCtx, selectedChar: 99 })

    expect(alertErrorSpy).toHaveBeenCalledWith('boom')
  })
})
