import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runTriggerSpy } = vi.hoisted(() => ({
  runTriggerSpy: vi.fn(),
}))

vi.mock('../triggers', () => ({
  runTrigger: runTriggerSpy,
}))

vi.mock('../modules', async (importActual) => {
  const actual = await importActual<typeof import('../modules')>()
  return { ...actual, moduleUpdate: () => {} }
})

import { setDatabase, type Chat, type Database, type character } from '../../storage/database.svelte'
import { selectedCharID } from '../../stores.svelte'
import { getResourceDatabase, replaceResourceDatabase } from '../../server/resourceState.svelte'
import { applyOutputTrigger } from '../postGeneration/outputTrigger'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: ReturnType<typeof getResourceDatabase>) {
    replaceResourceDatabase(value)
  },
}

function makeChar(): character {
  return {
    name: 'Test',
    chaId: 'cha-1',
    chats: [
      {
        message: [{ role: 'user', data: 'hi' }],
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

function identityRccf(chat: Chat): Chat {
  return chat
}

// `applyOutputTrigger` is the local-path durable derivation (run-var pass +
// `'output'` trigger). On the server-owned path the server runs this derivation
// and the browser consumes it from the terminal patch instead of calling
// `applyOutputTrigger`, pinned by `orchestrateResponse.test.ts` and the
// route-backed sweep's output-trigger fixture
// (`sendChat.fixtures.serverBacked.test.ts`). These tests keep pinning the
// local-path contract, which is unchanged.
describe('applyOutputTrigger', () => {
  beforeEach(() => {
    runTriggerSpy.mockReset()
  })

  it('calls runCurrentChatFunction with the current chat slot and writes the result back to testDatabaseState', async () => {
    const currentChar = seed()
    runTriggerSpy.mockResolvedValue(null)
    const rccf = vi.fn((chat: Chat) => ({ ...chat, name: 'rccf-mutated' }))
    const out = await applyOutputTrigger({
      currentChar,
      selectedChar: 0,
      selectedChat: 0,
      runCurrentChatFunction: rccf,
    })
    expect(rccf).toHaveBeenCalledTimes(1)
    expect(testDatabaseState.db.characters[0].chats[0].name).toBe('rccf-mutated')
    expect(out.chat.name).toBe('rccf-mutated')
  })

  it('calls runTrigger with mode "output" and the post-rccf chat', async () => {
    const currentChar = seed()
    runTriggerSpy.mockResolvedValue(null)
    await applyOutputTrigger({
      currentChar,
      selectedChar: 0,
      selectedChat: 0,
      runCurrentChatFunction: identityRccf,
    })
    expect(runTriggerSpy).toHaveBeenCalledTimes(1)
    const [charArg, modeArg, { chat }] = runTriggerSpy.mock.calls[0]
    expect(charArg).toBe(currentChar)
    expect(modeArg).toBe('output')
    expect(chat).toBe(testDatabaseState.db.characters[0].chats[0])
  })

  it('surfaces triggerResult.chat as triggerChat when the trigger returns one', async () => {
    const currentChar = seed()
    const replacementChat: Chat = {
      message: [{ role: 'char', data: 'mutated by trigger' }],
      note: '',
      name: 'trigger-output',
      localLore: [],
    } as unknown as Chat
    runTriggerSpy.mockResolvedValue({ chat: replacementChat, sendAIprompt: false })
    const out = await applyOutputTrigger({
      currentChar,
      selectedChar: 0,
      selectedChat: 0,
      runCurrentChatFunction: identityRccf,
    })
    expect(out.triggerChat).toBe(replacementChat)
    expect(out.resendChat).toBe(false)
  })

  it('returns triggerChat null when trigger returns without a chat', async () => {
    const currentChar = seed()
    runTriggerSpy.mockResolvedValue({ sendAIprompt: false })
    const out = await applyOutputTrigger({
      currentChar,
      selectedChar: 0,
      selectedChat: 0,
      runCurrentChatFunction: identityRccf,
    })
    expect(out.triggerChat).toBeNull()
  })

  it('returns resendChat true when trigger returns sendAIprompt: true', async () => {
    const currentChar = seed()
    runTriggerSpy.mockResolvedValue({ sendAIprompt: true })
    const out = await applyOutputTrigger({
      currentChar,
      selectedChar: 0,
      selectedChat: 0,
      runCurrentChatFunction: identityRccf,
    })
    expect(out.resendChat).toBe(true)
    expect(out.triggerChat).toBeNull()
  })

  it('treats null/undefined triggerResult as a no-op (no triggerChat, no resend)', async () => {
    const currentChar = seed()
    runTriggerSpy.mockResolvedValue(null)
    const out = await applyOutputTrigger({
      currentChar,
      selectedChar: 0,
      selectedChat: 0,
      runCurrentChatFunction: identityRccf,
    })
    expect(out.triggerChat).toBeNull()
    expect(out.resendChat).toBe(false)
  })
})
