import { beforeEach, describe, expect, it, vi } from 'vitest'

const { alertErrorSpy } = vi.hoisted(() => ({ alertErrorSpy: vi.fn() }))
vi.mock('../../alert', async (importActual) => {
  const actual = await importActual<typeof import('../../alert')>()
  return { ...actual, alertError: alertErrorSpy }
})

// Break a circular-init chain that fires off setDatabase/selectedCharID writes:
// stores.svelte.ts:199 $effect -> moduleUpdate -> getModules -> getDatabase, which
// hits a vitest SSR TDZ before all DB imports are initialized in this test file's
// dependency graph. The tests do not exercise modules; a noop is safe.
vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { DBState } from '../../stores.svelte'
import { reportSendChatError, type SendChatErrorContext } from '../sendChatErrors'

function makeChar(): character {
  return {
    name: 'Test',
    chaId: 'test-cha-id',
    firstMessage: '',
    desc: '',
    notes: '',
    chats: [
      {
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
    alertErrorSpy.mockReset()
    // Each test calls seed() which wholesale reseeds DBState. Restoring to {}
    // between tests would fire a $effect chain that reads modules off a partial
    // DB and throws (same shape as the guard in parser.svelte.ts).
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
      { message: [], note: '', name: 'a', localLore: [] } as never,
      { message: [], note: '', name: 'b', localLore: [] } as never,
    ]
    char.chatPage = 1
    seed({ inlayErrorResponse: true, char })
    reportSendChatError('boom', { ...baseCtx, selectedChat: -1 })
    expect(DBState.db.characters[0].chats[0].message).toHaveLength(0)
    expect(DBState.db.characters[0].chats[1].message).toHaveLength(1)
  })
})
