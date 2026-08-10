import { beforeEach, describe, expect, it, vi } from 'vitest'

const { processScriptFullSpy, runInlayScreenSpy, sayTTSSpy } = vi.hoisted(() => ({
  processScriptFullSpy: vi.fn(),
  runInlayScreenSpy: vi.fn(),
  sayTTSSpy: vi.fn(),
}))

vi.mock('../scripts', () => ({
  cacheBestMatchForTesting: vi.fn(),
  exportRegex: vi.fn(),
  getBestMatchCacheSizeForTesting: vi.fn(() => 0),
  getBestMatchForTesting: vi.fn(),
  getCompiledRegex: (source: string, flags: string) => new RegExp(source, flags),
  hasProcessScriptCacheEntryForTesting: vi.fn(() => false),
  importRegex: vi.fn(),
  importRegexRows: vi.fn(),
  processScript: vi.fn(async (_char: unknown, data: string) => data),
  processScriptFull: processScriptFullSpy,
  resetScriptCache: vi.fn(),
  risuChatParser: vi.fn((text: string) => text),
}))

vi.mock('../inlayScreen', () => ({
  runInlayScreen: runInlayScreenSpy,
}))

vi.mock('../tts', () => ({
  sayTTS: sayTTSSpy,
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import {
  setDatabase,
  type Database,
  type MessageGenerationInfo,
  type MessagePresetInfo,
  type character,
} from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { getResourceDatabase, replaceResourceDatabase } from '../../server/resourceState.svelte'
import type { requestDataResponse } from '../request/request'
import { applyNonStreamResponse } from '../postGeneration/nonStreamResponse'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: ReturnType<typeof getResourceDatabase>) {
    replaceResourceDatabase(value)
  },
}

const REFORMAT = (s: string) => s.trim()

function makeChar(): character {
  return {
    name: 'Test',
    chaId: 'cha-1',
    chats: [
      {
        id: 'chat-1',
        message: [{ role: 'user', data: 'hi', chatId: 'user-1' }],
        note: '',
        name: 'main',
        localLore: [],
      },
    ],
    chatPage: 0,
    reloadKeys: 0,
    image: '',
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    chaVer: 0,
    firstMessage: '',
    desc: '',
    notes: '',
  } as unknown as character
}

function seed(): character {
  const char = makeChar()
  setDatabase({ characters: [char] } as Database)
  selectedCharID.set(0)
  return testDatabaseState.db.characters[0]
}

function callArgs(
  req: requestDataResponse,
  currentChar: character,
  overrides: Partial<Parameters<typeof applyNonStreamResponse>[0]> = {},
): Parameters<typeof applyNonStreamResponse>[0] {
  const args: Parameters<typeof applyNonStreamResponse>[0] = {
    req,
    arg: {},
    nowChatroom: currentChar,
    currentChar,
    target: { characterId: 'cha-1', chatId: 'chat-1' },
    generationId: 'gen-1',
    generationInfo: {} as MessageGenerationInfo,
    promptInfo: {} as MessagePresetInfo,
    reformatContent: REFORMAT,
    ...overrides,
  }
  return args
}

describe('applyNonStreamResponse', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(1000))
    processScriptFullSpy.mockReset()
    processScriptFullSpy.mockImplementation(async (_c: unknown, data: string) => ({
      data,
      emoChanged: false,
    }))
    runInlayScreenSpy.mockReset()
    runInlayScreenSpy.mockImplementation((_c: unknown, data: string) => ({ text: data }))
    sayTTSSpy.mockReset()
    sayTTSSpy.mockResolvedValue(undefined)
  })

  it('success: pushes a single "char" message with the processed data', async () => {
    const currentChar = seed()
    const req: requestDataResponse = { type: 'success', result: 'hello there' }
    const out = await applyNonStreamResponse(callArgs(req, currentChar))
    const messages = testDatabaseState.db.characters[0].chats[0].message
    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe('char')
    expect(messages[1].data).toBe('hello there')
    expect(messages[1].chatId).toBe('gen-1')
    expect(out.result).toBe('hello there')
    expect(out.mrerolls).toEqual(['hello there'])
  })

  it('multiline: pushes N messages with roles taken from msg[0]', async () => {
    const currentChar = seed()
    const req: requestDataResponse = {
      type: 'multiline',
      result: [
        ['char', 'first'],
        ['user', 'second'],
        ['char', 'third'],
      ],
    }
    const out = await applyNonStreamResponse(callArgs(req, currentChar))
    const messages = testDatabaseState.db.characters[0].chats[0].message
    expect(messages).toHaveLength(2)
    expect(messages[1].role).toBe('char')
    expect(messages[1].data).toBe('first')
    expect(out.mrerolls).toEqual(['first', 'second', 'third'])
  })

  it('fail: no pushes, returns empty result/mrerolls', async () => {
    const currentChar = seed()
    const req: requestDataResponse = { type: 'fail', result: 'oops' }
    const out = await applyNonStreamResponse(callArgs(req, currentChar))
    expect(testDatabaseState.db.characters[0].chats[0].message).toHaveLength(1)
    expect(out.result).toBe('')
    expect(out.emoChanged).toBe(false)
    expect(out.mrerolls).toEqual([])
  })

  it('arg.continue: overwrites the previous slot instead of pushing', async () => {
    const currentChar = seed()
    testDatabaseState.db.characters[0].chats[0].message.push({
      role: 'char',
      data: 'partial',
      chatId: 'assistant-1',
    })
    const req: requestDataResponse = { type: 'success', result: 'continued' }
    const out = await applyNonStreamResponse(callArgs(req, currentChar, { arg: { continue: true } }))
    const messages = testDatabaseState.db.characters[0].chats[0].message
    expect(messages).toHaveLength(2)
    expect(messages[1].data).toBe('partialcontinued')
    expect(messages[1].chatId).toBe('assistant-1')
    expect(out.messageId).toBe('assistant-1')
    expect(out.mrerolls).toEqual([])
    expect(processScriptFullSpy).toHaveBeenCalledTimes(2)
    expect(processScriptFullSpy.mock.calls[1][1]).toBe('partialcontinued')
  })

  it('inlayResult.promise resolves and overwrites the pushed message data', async () => {
    const currentChar = seed()
    runInlayScreenSpy.mockReturnValueOnce({
      text: '[Generating...]',
      promise: Promise.resolve('final image markup'),
    })
    const req: requestDataResponse = { type: 'success', result: 'placeholder' }
    await applyNonStreamResponse(callArgs(req, currentChar))
    expect(testDatabaseState.db.characters[0].chats[0].message[1].data).toBe('final image markup')
  })

  it('removeIncompleteResponse → routes data through trimUntilPunctuation (real impl)', async () => {
    // Real trimUntilPunctuation strips trailing chars until last char is
    // punctuation; 'noPunct' has none so it strips to ''. Asserting the
    // observable effect avoids cross-file module-mock fragility.
    const currentChar = seed()
    testDatabaseState.db.removeIncompleteResponse = true
    const req: requestDataResponse = { type: 'success', result: 'noPunct' }
    await applyNonStreamResponse(callArgs(req, currentChar))
    expect(testDatabaseState.db.characters[0].chats[0].message[1].data).toBe('')
  })

  it('removeIncompleteResponse=false: leaves processed data unmodified', async () => {
    const currentChar = seed()
    testDatabaseState.db.removeIncompleteResponse = false
    const req: requestDataResponse = { type: 'success', result: 'noPunct' }
    await applyNonStreamResponse(callArgs(req, currentChar))
    expect(testDatabaseState.db.characters[0].chats[0].message[1].data).toBe('noPunct')
  })

  it('ttsAutoSpeech: calls sayTTS once per iter with the post-inlay result', async () => {
    const currentChar = seed()
    testDatabaseState.db.ttsAutoSpeech = true
    runInlayScreenSpy.mockImplementation((_c: unknown, data: string) => ({
      text: data + '!',
    }))
    const req: requestDataResponse = {
      type: 'multiline',
      result: [
        ['char', 'a'],
        ['char', 'b'],
      ],
    }
    await applyNonStreamResponse(callArgs(req, currentChar))
    expect(sayTTSSpy).toHaveBeenCalledTimes(2)
    expect(sayTTSSpy.mock.calls[0][1]).toBe('a!')
    expect(sayTTSSpy.mock.calls[1][1]).toBe('b!')
  })

  it('emoChanged reflects only the last iteration (verbatim from inline)', async () => {
    const currentChar = seed()
    processScriptFullSpy
      .mockResolvedValueOnce({ data: 'first', emoChanged: true })
      .mockResolvedValueOnce({ data: 'second', emoChanged: false })
    const req: requestDataResponse = {
      type: 'multiline',
      result: [
        ['char', 'a'],
        ['char', 'b'],
      ],
    }
    const out = await applyNonStreamResponse(callArgs(req, currentChar))
    expect(out.emoChanged).toBe(false)
  })

  it('mrerolls captures the post-inlay text, not the pre-inlay processed data', async () => {
    const currentChar = seed()
    runInlayScreenSpy.mockImplementation((_c: unknown, data: string) => ({
      text: data + '_inlay',
    }))
    const req: requestDataResponse = {
      type: 'multiline',
      result: [
        ['char', 'a'],
        ['char', 'b'],
      ],
    }
    const out = await applyNonStreamResponse(callArgs(req, currentChar))
    expect(out.mrerolls).toEqual(['a_inlay', 'b_inlay'])
  })

  it('bumps reloadKeys once per iter', async () => {
    const currentChar = seed()
    testDatabaseState.db.characters[0].reloadKeys = 0
    const req: requestDataResponse = {
      type: 'multiline',
      result: [
        ['char', 'a'],
        ['char', 'b'],
      ],
    }
    await applyNonStreamResponse(callArgs(req, currentChar))
    expect(testDatabaseState.db.characters[0].reloadKeys).toBe(2)
  })
})
