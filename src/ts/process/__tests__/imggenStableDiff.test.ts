import { beforeEach, describe, expect, it, vi } from 'vitest'

const { stableDiffSpy } = vi.hoisted(() => ({
  stableDiffSpy: vi.fn(),
}))
vi.mock('../stableDiff', () => ({
  stableDiff: stableDiffSpy,
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Database, type character } from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { runImggenStableDiff } from '../postGeneration/imggenStableDiff'

function makeChar(): character {
  return {
    name: 'Test',
    chaId: 'cha-1',
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
    viewScreen: 'imggen',
    globalLore: [],
    chaVer: 0,
    firstMessage: '',
    desc: '',
    notes: '',
  } as unknown as character
}

function seed(char: character) {
  setDatabase({ characters: [char] } as Database)
  selectedCharID.set(0)
}

const target = { characterId: 'cha-1', chatId: 'chat-1' }

describe('runImggenStableDiff', () => {
  beforeEach(() => {
    stableDiffSpy.mockReset()
  })

  it('builds a transcript ending at the last user message and trailing characters after it', async () => {
    const char = makeChar()
    char.chats[0].message = [
      { role: 'user', data: 'irrelevant earlier user line', time: 0 },
      { role: 'char', data: 'pre-pivot char line', time: 0 },
      { role: 'user', data: 'pivot user', time: 0 },
      { role: 'char', data: 'reply A', time: 0 },
      { role: 'char', data: 'reply B', time: 0 },
    ]
    seed(char)
    await runImggenStableDiff({ currentChar: char, target })
    expect(stableDiffSpy).toHaveBeenCalledTimes(1)
    const [arg1, arg2] = stableDiffSpy.mock.calls[0]
    expect(arg1).toBe(char)
    // The walk-back stops at the latest user message, so earlier user/char
    // entries are dropped. Trailing char lines after that user line are
    // included.
    expect(arg2).toBe('user: pivot user \ncharacter: reply A \ncharacter: reply B \n')
  })

  it('replaces newlines inside messages with spaces', async () => {
    const char = makeChar()
    char.chats[0].message = [
      { role: 'user', data: 'multi\nline\nuser', time: 0 },
      { role: 'char', data: 'multi\nline\nchar', time: 0 },
    ]
    seed(char)
    await runImggenStableDiff({ currentChar: char, target })
    const [, arg2] = stableDiffSpy.mock.calls[0]
    expect(arg2).toBe('user: multi line user \ncharacter: multi line char \n')
  })

  it('walks back through all char messages when there is no user message', async () => {
    const char = makeChar()
    char.chats[0].message = [
      { role: 'char', data: 'only-1', time: 0 },
      { role: 'char', data: 'only-2', time: 0 },
    ]
    seed(char)
    await runImggenStableDiff({ currentChar: char, target })
    const [, arg2] = stableDiffSpy.mock.calls[0]
    expect(arg2).toBe('character: only-1 \ncharacter: only-2 \n')
  })

  it('calls stableDiff with an empty transcript when the chat is empty', async () => {
    const char = makeChar()
    seed(char)
    await runImggenStableDiff({ currentChar: char, target })
    expect(stableDiffSpy).toHaveBeenCalledWith(char, '')
  })

  it('v4-L31: passes the stage abort signal into stableDiff', async () => {
    const char = makeChar()
    const abortSignal = new AbortController().signal
    seed(char)

    await runImggenStableDiff({ currentChar: char, target, abortSignal })

    expect(stableDiffSpy).toHaveBeenCalledWith(char, '', { signal: abortSignal })
  })

  it('v4-L31: skips stableDiff when the stage abort signal is already aborted', async () => {
    const char = makeChar()
    const controller = new AbortController()
    controller.abort()
    seed(char)

    await runImggenStableDiff({
      currentChar: char,
      target,
      abortSignal: controller.signal,
    })

    expect(stableDiffSpy).not.toHaveBeenCalled()
  })
})
