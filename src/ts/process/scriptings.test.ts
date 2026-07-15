import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, character } from '../storage/database.svelte'

const luaMock = vi.hoisted(() => {
  let nextEngineId = 0
  const state = {
    engines: [] as any[],
    createEngine: vi.fn(),
    runTimeouts: [] as number[],
    loadedCodes: [] as string[],
    closedEngineIds: [] as number[],
    lastAccessKey: '',
    rejectDispatch: false,
    dispatchArgs: new Map<string, unknown[]>(),
  }

  function makeEngine(options: Record<string, unknown>) {
    const hostFns = new Map<string, Function>()
    const engine = {
      id: nextEngineId++,
      options,
      hostFns,
      closed: false,
      global: {
        set: vi.fn((name: string, func: Function) => {
          hostFns.set(name, func)
        }),
        get: vi.fn((name: string) => {
          if (name === 'callListenMain') {
            return async (_mode: string, accessKey: string, value: string) => {
              state.lastAccessKey = accessKey
              if (state.rejectDispatch) {
                throw new Error('lua dispatch failed')
              }
              return JSON.stringify(JSON.parse(value))
            }
          }
          const hostFunction = hostFns.get(name)
          const dispatchArgs = state.dispatchArgs.get(name)
          if (hostFunction && dispatchArgs) {
            return (accessKey: string) => hostFunction(accessKey, ...dispatchArgs)
          }
          return hostFunction
        }),
        newThread: vi.fn(() => {
          let loadedCode = ''
          return {
            loadString: vi.fn((code: string) => {
              loadedCode = code
              state.loadedCodes.push(code)
            }),
            run: vi.fn(async (_argCount: number, options?: { timeout?: number }) => {
              state.runTimeouts.push(options?.timeout ?? 0)
              if (loadedCode.includes('while true do end')) {
                throw new Error('thread timeout exceeded')
              }
              return []
            }),
          }
        }),
        getTop: vi.fn(() => 1),
        remove: vi.fn(),
        close: vi.fn(() => {
          if (!engine.closed) {
            engine.closed = true
            state.closedEngineIds.push(engine.id)
          }
        }),
      },
    }
    state.engines.push(engine)
    return engine
  }

  class LuaFactory {
    async mountFile() {}
    async createEngine(options: Record<string, unknown>) {
      return state.createEngine(options)
    }
  }

  class LuaEngine {}

  state.createEngine.mockImplementation(async (options: Record<string, unknown>) => makeEngine(options))

  return {
    ...state,
    LuaFactory,
    LuaEngine,
    reset() {
      nextEngineId = 0
      state.engines.length = 0
      state.runTimeouts.length = 0
      state.loadedCodes.length = 0
      state.closedEngineIds.length = 0
      state.lastAccessKey = ''
      state.rejectDispatch = false
      state.dispatchArgs.clear()
      state.createEngine.mockClear()
      state.createEngine.mockImplementation(async (options: Record<string, unknown>) => makeEngine(options))
    },
    setRejectDispatch(value: boolean) {
      state.rejectDispatch = value
    },
    setDispatchArgs(name: string, args: unknown[]) {
      state.dispatchArgs.set(name, args)
    },
  }
})

const mediaMock = vi.hoisted(() => ({
  fetchNative: vi.fn(),
  generateAIImage: vi.fn(),
  getInlayAsset: vi.fn(),
  getPersonaPrompt: vi.fn(() => ''),
  getUserIcon: vi.fn(() => 'persona.png'),
  getUserName: vi.fn(() => 'User'),
  readImage: vi.fn(async () => new Uint8Array([1, 2, 3])),
  writeInlayImage: vi.fn(async () => 'inlay-id'),
}))

vi.mock('wasmoon', () => ({
  LuaFactory: luaMock.LuaFactory,
  LuaEngine: luaMock.LuaEngine,
}))

vi.mock('../globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../globalApi.svelte')>()
  return {
    ...actual,
    fetchNative: mediaMock.fetchNative,
    readImage: mediaMock.readImage,
  }
})

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/globalApi.svelte')>()
  return {
    ...actual,
    fetchNative: mediaMock.fetchNative,
    readImage: mediaMock.readImage,
  }
})

vi.mock('./files/inlays', () => ({
  getInlayAsset: mediaMock.getInlayAsset,
  writeInlayImage: mediaMock.writeInlayImage,
}))

vi.mock('./stableDiff', () => ({
  generateAIImage: mediaMock.generateAIImage,
}))

vi.mock('../util', async (importActual) => {
  const actual = await importActual<typeof import('../util')>()
  return {
    ...actual,
    getPersonaPrompt: mediaMock.getPersonaPrompt,
    getUserIcon: mediaMock.getUserIcon,
    getUserName: mediaMock.getUserName,
  }
})

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
    asBuffer: (data: Uint8Array) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    getPersonaPrompt: mediaMock.getPersonaPrompt,
    getUserIcon: mediaMock.getUserIcon,
    getUserName: mediaMock.getUserName,
  }
})

vi.mock('./modules', async (importActual) => {
  const actual = await importActual<typeof import('./modules')>()
  return {
    ...actual,
    getModuleLorebooks: () => [],
    getModuleTriggers: () => [],
    moduleUpdate: () => {},
  }
})

import {
  CLIENT_LUA_ENGINE_CACHE_PER_MODE,
  getScriptingEngineCacheSnapshotForTests,
  resetScriptingEngineCacheForTests,
  runLuaEditTrigger,
  runScripted,
} from './scriptings'

function makeChat(): Chat {
  return {
    id: 'chat-1',
    message: [],
    note: '',
    name: 'main',
    localLore: [],
    scriptstate: {},
  } as unknown as Chat
}

function makeCharacter(chat: Chat): character {
  return {
    chaId: 'char-a',
    name: 'Character',
    desc: '',
    chatPage: 0,
    chats: [chat],
    triggerscript: [],
    defaultVariables: '',
    globalLore: [],
    type: 'character',
  } as unknown as character
}

beforeEach(() => {
  resetScriptingEngineCacheForTests()
  luaMock.reset()
  mediaMock.fetchNative.mockReset()
  mediaMock.generateAIImage.mockReset()
  mediaMock.generateAIImage.mockResolvedValue('data:image/png;base64,generated')
  mediaMock.getInlayAsset.mockReset()
  mediaMock.getPersonaPrompt.mockReturnValue('')
  mediaMock.getUserIcon.mockReturnValue('persona.png')
  mediaMock.getUserName.mockReturnValue('User')
  mediaMock.readImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
  mediaMock.writeInlayImage.mockResolvedValue('inlay-id')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  resetScriptingEngineCacheForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('client scripting media cleanup (L51)', () => {
  it('L51: getPersonaImageMain revokes its object URL when inlay writing fails', async () => {
    const chat = makeChat()
    const char = makeCharacter(chat)
    mediaMock.writeInlayImage.mockRejectedValueOnce(new Error('inlay failed'))
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:persona-image')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    try {
      await runScripted('return "api"', {
        char,
        chat,
        mode: 'editDisplay',
        data: 'body',
      })
      const getPersonaImageMain = luaMock.engines[0].hostFns.get('getPersonaImageMain')

      await expect(getPersonaImageMain?.('access-key')).resolves.toBe('')
      expect(mediaMock.readImage).toHaveBeenCalledWith('persona.png')
      expect(mediaMock.writeInlayImage).toHaveBeenCalledTimes(1)
      expect(createUrl).toHaveBeenCalledTimes(1)
      expect(revokeUrl).toHaveBeenCalledWith('blob:persona-image')
    } finally {
      createUrl.mockRestore()
      revokeUrl.mockRestore()
    }
  })
})

describe('client scripting Lua budgets and cache (L39-L41)', () => {
  it('keeps readonly character trigger rows immutable before Lua edit-display dispatch', async () => {
    const chat = makeChat()
    const char = makeCharacter(chat)
    const trigger = Object.freeze({
      comment: 'readonly lua trigger',
      type: 'display',
      conditions: [],
      effect: [{ type: 'triggerlua', code: 'return "display"' }],
    })
    char.triggerscript = [trigger as unknown as character['triggerscript'][number]]

    await expect(runLuaEditTrigger(char, 'editdisplay', 'body')).resolves.toBe('body')

    expect(luaMock.createEngine).toHaveBeenCalledTimes(1)
    expect('lowLevelAccess' in trigger).toBe(false)
  })

  it('runs simple character trigger rows for first-message edit-display parity', async () => {
    const trigger = Object.freeze({
      comment: 'simple lua trigger',
      type: 'display',
      conditions: [],
      effect: [{ type: 'triggerlua', code: '-- simple display hook' }],
    })
    const char = {
      type: 'simple',
      chaId: 'simple-char',
      customscript: [],
      triggerscript: [trigger],
    } as any

    await expect(runLuaEditTrigger(char, 'editdisplay', 'first message')).resolves.toBe('first message')

    expect(luaMock.createEngine).toHaveBeenCalledTimes(1)
    expect(luaMock.loadedCodes[0]).toContain('-- simple display hook')
    expect('lowLevelAccess' in trigger).toBe(false)
  })

  it('falls back to original edit-display content when Lua dispatch fails', async () => {
    const chat = makeChat()
    const char = makeCharacter(chat)
    char.triggerscript = [
      {
        comment: 'display-fallback',
        type: 'display',
        conditions: [],
        effect: [{ type: 'triggerlua', code: 'return "display"' }],
      },
    ] as character['triggerscript']
    luaMock.setRejectDispatch(true)

    await expect(runLuaEditTrigger(char, 'editdisplay', 'visible body')).resolves.toBe('visible body')

    expect(console.error).toHaveBeenCalledWith('Lua edit trigger failed in editDisplay:', expect.any(Error))
    expect(getScriptingEngineCacheSnapshotForTests().accessSetSizes.editDisplay).toBe(0)
  })

  it('L39: client Lua while true loads through the timeout-bound thread', async () => {
    const chat = makeChat()
    const char = makeCharacter(chat)

    await expect(
      runScripted('while true do end', {
        char,
        chat,
        mode: 'editDisplay',
        data: 'body',
        luaExecTimeoutMs: 25,
      }),
    ).rejects.toThrow(/timeout/)

    expect(luaMock.createEngine).toHaveBeenCalledWith(
      expect.objectContaining({ injectObjects: true, functionTimeout: 25 }),
    )
    expect(luaMock.runTimeouts).toContain(25)
  })

  it('L40: same-mode Lua code hash cache reuses alternating bodies and evicts by LRU', async () => {
    const chat = makeChat()
    const char = makeCharacter(chat)

    await runScripted('return "A"', { char, chat, mode: 'editDisplay', data: 'a' })
    await runScripted('return "B"', { char, chat, mode: 'editDisplay', data: 'b' })
    await runScripted('return "A"', { char, chat, mode: 'editDisplay', data: 'a2' })

    expect(luaMock.createEngine).toHaveBeenCalledTimes(2)
    expect(luaMock.closedEngineIds).toEqual([])

    for (let index = 0; index <= CLIENT_LUA_ENGINE_CACHE_PER_MODE; index++) {
      await runScripted(`return "cap-${index}"`, {
        char,
        chat,
        mode: 'boundedMode',
        data: `cap-${index}`,
      })
    }

    const boundedKeys = getScriptingEngineCacheSnapshotForTests().keys.filter((key) =>
      key.startsWith('lua:boundedMode:'),
    )
    expect(boundedKeys).toHaveLength(CLIENT_LUA_ENGINE_CACHE_PER_MODE)
    expect(luaMock.closedEngineIds.length).toBeGreaterThan(0)
  })

  it('memoizes Lua code hashes before looking up cached engines', async () => {
    const chat = makeChat()
    const char = makeCharacter(chat)
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest')
    const code = `return "${'same lua source '.repeat(1_000)}"`

    await runScripted(code, { char, chat, mode: 'editDisplay', data: 'first' })
    await runScripted(code, { char, chat, mode: 'editDisplay', data: 'second' })

    expect(luaMock.createEngine).toHaveBeenCalledTimes(1)
    expect(digestSpy).toHaveBeenCalledTimes(1)
  })

  it('uses the current run stop handler when a cached engine calls stopChat', async () => {
    const firstChat = makeChat()
    const secondChat = makeChat()
    const code = '-- cached stopChat handler'

    const first = await runScripted(code, {
      char: makeCharacter(firstChat),
      chat: firstChat,
      mode: 'stopChat',
    })
    const second = await runScripted(code, {
      char: makeCharacter(secondChat),
      chat: secondChat,
      mode: 'stopChat',
    })

    expect(luaMock.createEngine).toHaveBeenCalledTimes(1)
    expect(first.stopSending).toBe(true)
    expect(second.stopSending).toBe(true)
  })

  it('uses the current run character when a cached engine generates an image', async () => {
    const firstChat = makeChat()
    const secondChat = makeChat()
    const firstCharacter = makeCharacter(firstChat)
    const secondCharacter = makeCharacter(secondChat)
    firstCharacter.chaId = 'char-first'
    secondCharacter.chaId = 'char-second'
    luaMock.setDispatchArgs('generateImage', ['portrait', 'negative'])
    const code = '-- cached generateImage handler'

    await runScripted(code, {
      char: firstCharacter,
      chat: firstChat,
      mode: 'generateImage',
      lowLevelAccess: true,
    })
    await runScripted(code, {
      char: secondCharacter,
      chat: secondChat,
      mode: 'generateImage',
      lowLevelAccess: true,
    })

    expect(luaMock.createEngine).toHaveBeenCalledTimes(1)
    expect(mediaMock.generateAIImage).toHaveBeenNthCalledWith(1, 'portrait', firstCharacter, 'negative', 'inlay')
    expect(mediaMock.generateAIImage).toHaveBeenNthCalledWith(2, 'portrait', secondCharacter, 'negative', 'inlay')
  })

  it('uses the current run character when a cached engine upserts local lore', async () => {
    const firstChat = makeChat()
    const secondChat = makeChat()
    const firstCharacter = makeCharacter(firstChat)
    const secondCharacter = makeCharacter(secondChat)
    firstCharacter.chaId = 'char-first'
    secondCharacter.chaId = 'char-second'
    luaMock.setDispatchArgs('upsertLocalLoreBook', ['run lore', 'current character', {}])
    const code = '-- cached upsertLocalLoreBook handler'

    await runScripted(code, { char: firstCharacter, chat: firstChat, mode: 'upsertLocalLoreBook' })
    await runScripted(code, { char: secondCharacter, chat: secondChat, mode: 'upsertLocalLoreBook' })

    expect(luaMock.createEngine).toHaveBeenCalledTimes(1)
    expect(firstChat.localLore).toHaveLength(1)
    expect(secondChat.localLore).toHaveLength(1)
    expect(secondChat.localLore[0]).toEqual(
      expect.objectContaining({
        comment: 'run lore',
        content: 'current character',
      }),
    )
  })

  it('L41: editDisplay access key is removed after Lua success and rejection', async () => {
    const chat = makeChat()
    const char = makeCharacter(chat)
    const setVar = vi.fn()

    await runScripted('return "display"', {
      char,
      chat,
      mode: 'editDisplay',
      data: 'body',
      setVar,
    })

    const accessKey = luaMock.lastAccessKey
    const setChatVar = luaMock.engines[0].hostFns.get('setChatVar')
    setChatVar?.(accessKey, 'chat-1', 'leaked')

    expect(setVar).not.toHaveBeenCalled()
    expect(getScriptingEngineCacheSnapshotForTests().accessSetSizes.editDisplay).toBe(0)

    luaMock.setRejectDispatch(true)
    await expect(
      runScripted('return "reject"', {
        char,
        chat,
        mode: 'editDisplay',
        data: 'body',
        setVar,
      }),
    ).rejects.toThrow('lua dispatch failed')

    expect(getScriptingEngineCacheSnapshotForTests().accessSetSizes.editDisplay).toBe(0)
  })

  it('L41: Python editDisplay rejection cleans up access key', async () => {
    class RejectingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      postMessage(message: { id: string; type: string }) {
        queueMicrotask(() => {
          if (message.type === 'init') {
            this.onmessage?.({ data: { id: message.id, type: 'init' } } as MessageEvent)
            return
          }
          this.onmessage?.({
            data: { id: message.id, type: 'error', error: 'python failed' },
          } as MessageEvent)
        })
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', RejectingWorker)
    const chat = makeChat()
    const char = makeCharacter(chat)

    await expect(
      runScripted('def callListenMain(*args): return "{}"', {
        char,
        chat,
        mode: 'editDisplay',
        type: 'py',
        data: 'body',
      }),
    ).rejects.toThrow('python failed')

    expect(getScriptingEngineCacheSnapshotForTests().accessSetSizes.editDisplay).toBe(0)
  })
})
