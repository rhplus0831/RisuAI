import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'compat-auth-token',
}))

vi.mock('./alert', () => ({
  alertConfirm: vi.fn(async () => true),
  alertError: vi.fn(),
}))

vi.mock('./process/coldstorage.svelte', () => ({
  getColdStorageItem: vi.fn(),
}))

import { clearCachedServerCommandRevision, type CommandEvent } from './server/commands'
import { setResourceWriteGuardEnabled } from './server/resourceWriteGuard.svelte'
import {
  currentCharacterSelectionSnapshot,
  currentCharacterStateSnapshot,
  dispatchCompatibleCharacterUpdate,
  prepareCompatibleCharacterUpdate,
} from './characterCommands'
import {
  currentChatStateSnapshot,
  dispatchCompatibleChatUpdate,
  prepareCompatibleChatUpdate,
  runOptimisticCommandSequence,
} from './chatCommands'
import { CharacterHandler } from './process/mcp/risuaccess/characters'
import { ModuleHandler } from './process/mcp/risuaccess/modules'
import { getResourceDatabase, replaceResourceDatabase } from './server/resourceState.svelte'
import { selectedCharID } from './stores.svelte'
import { isServerCharacterShell, type Chat, type character, type Database } from './storage/database.svelte'
import { changeChar, changeCharImage, createNewCharacter, rmCharEmotion } from './characters'
import { alertError } from './alert'
import { getColdStorageItem } from './process/coldstorage.svelte'
import { isCharacterLorebookMutationReady, resetLorebookHydration } from './server/lorebookBridge.svelte'

const testDatabaseState = {
  get db() {
    return getResourceDatabase()
  },
  set db(value: Database) {
    replaceResourceDatabase(value)
  },
}

interface CapturedFetch {
  url: string
  method: string
  body: unknown
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
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method: init.method ?? 'GET', body })
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: 10 })
      }
      const event: CommandEvent = {
        type: 'compat.updated',
        revision: 11,
        resource: 'compat',
      } as CommandEvent
      return jsonResponse({ revision: 11, event })
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubRevisionCheckedCommandFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  let currentRevision = 10
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({ url, method: init.method ?? 'GET', body })
      if (url === '/api/v1/bootstrap') {
        return jsonResponse({ revision: currentRevision })
      }
      const baseRevision = (body as { baseRevision?: unknown } | null)?.baseRevision
      if (baseRevision !== currentRevision) {
        return jsonResponse({ error: 'revision_conflict', currentRevision }, 409)
      }
      currentRevision += 1
      return jsonResponse({
        revision: currentRevision,
        event: { type: 'compat.updated', revision: currentRevision, resource: 'compat' },
      })
    }) as unknown as typeof fetch,
  )
  return calls
}

function seedCharacter(): character {
  return {
    chaId: 'char-a',
    name: 'Old name',
    desc: 'Old desc',
    firstMessage: 'Hello',
    chats: [
      {
        id: 'chat-a',
        name: 'Old chat',
        note: 'old note',
        message: [{ role: 'user', data: 'old', chatId: 'msg-a' }],
        localLore: [],
        scriptstate: { $old: '1', $gone: 'x' },
      },
    ],
    chatFolders: [],
    chatPage: 0,
    image: '',
    ccAssets: [
      {
        type: 'icon',
        name: 'iconx',
        uri: 'asset-old',
        ext: 'png',
      },
    ],
    emotionImages: [['happy', 'asset-happy']],
  } as unknown as character
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  resetLorebookHydration()
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
  selectedCharID.set(0)
  testDatabaseState.db = {
    currentChar: 0,
    characters: [seedCharacter()],
    characterOrder: ['char-a'],
  } as any
})

afterEach(() => {
  setResourceWriteGuardEnabled(false)
})

describe('Phase 9-3f compatibility adapters', () => {
  it('routes whole-character compatibility setters through character scalar commands', async () => {
    const calls = stubCommandFetch()
    const previousCharacter = snapshot(testDatabaseState.db.characters[0])
    const previous = currentCharacterStateSnapshot()
    testDatabaseState.db.characters[0] = {
      ...testDatabaseState.db.characters[0],
      name: 'New name',
      desc: 'New desc',
      chats: [
        {
          ...testDatabaseState.db.characters[0].chats[0],
          name: 'child change stays out of character scalar patch',
        },
      ],
    }

    dispatchCompatibleCharacterUpdate(previousCharacter, testDatabaseState.db.characters[0], previous)

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a')).toBe(true)
    })
    const update = calls.find((call) => call.url === '/api/v1/commands/characters/char-a')
    expect(update).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          name: 'New name',
          desc: 'New desc',
        },
      },
    })
  })

  it('routes whole-chat compatibility setters through chat, message, and scriptstate commands', async () => {
    const calls = stubCommandFetch()
    const previousChat = snapshot(testDatabaseState.db.characters[0].chats[0]) as Chat
    const previous = currentChatStateSnapshot()
    const nextChat: Chat = {
      ...previousChat,
      note: 'new note',
      message: [
        { role: 'user', data: 'replacement', chatId: 'msg-a' },
        { role: 'char', data: 'new', chatId: 'msg-b' },
      ],
      scriptstate: { $old: '2' },
    }
    testDatabaseState.db.characters[0].chats[0] = nextChat

    dispatchCompatibleChatUpdate(previousChat, nextChat, previous)

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/scriptstate')).toBe(true)
    })
    expect(calls.filter((call) => call.url === '/api/v1/bootstrap')).toHaveLength(1)
    expect(calls.find((call) => call.url === '/api/v1/commands/chats/chat-a')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: { note: 'new note' },
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/chats/chat-a/messages')).toMatchObject({
      method: 'PUT',
      body: {
        baseRevision: 11,
        messages: nextChat.message,
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/chats/chat-a/scriptstate')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 11,
        patch: { $old: '2' },
        deleteKeys: ['$gone'],
      },
    })
  })

  it('serializes whole-chat compatibility command fan-out against the latest revision', async () => {
    const calls = stubRevisionCheckedCommandFetch()
    const previousChat = snapshot(testDatabaseState.db.characters[0].chats[0]) as Chat
    const previous = currentChatStateSnapshot()
    const nextChat: Chat = {
      ...previousChat,
      note: 'serialized note',
      message: [
        { role: 'user', data: 'replacement', chatId: 'msg-a' },
        { role: 'char', data: 'new', chatId: 'msg-b' },
      ],
      scriptstate: { $old: '3' },
    }
    testDatabaseState.db.characters[0].chats[0] = nextChat

    dispatchCompatibleChatUpdate(previousChat, nextChat, previous)

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/scriptstate')).toBe(true)
    })

    const commandBodies = calls.filter((call) => call.url !== '/api/v1/bootstrap').map((call) => call.body)
    expect(commandBodies).toEqual([
      { baseRevision: 10, patch: { note: 'serialized note' }, select: false },
      { baseRevision: 11, messages: nextChat.message },
      { baseRevision: 12, patch: { $old: '3' }, deleteKeys: ['$gone'] },
    ])
    expect(testDatabaseState.db.characters[0].chats[0]).toEqual(nextChat)
  })

  it('prepareCompatibleCharacterUpdate returns one update factory routed through the sequencer', async () => {
    // The V3 plugin API uses prepareCompatibleCharacterUpdate +
    // runOptimisticCommandSequence so dispatch sits inside the allowed-sequencer
    // scope. Verify factories build the update and rollback restores the snapshot.
    const calls = stubCommandFetch()
    const previousCharacter = snapshot(testDatabaseState.db.characters[0])
    const previous = currentCharacterStateSnapshot()
    const next = { ...previousCharacter, name: 'Prepared name' } as character
    testDatabaseState.db.characters[0] = next

    const { factories, rollback } = prepareCompatibleCharacterUpdate(previousCharacter, next, previous)
    expect(factories).toHaveLength(1)
    runOptimisticCommandSequence(factories, rollback)

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/char-a')).toMatchObject({
      method: 'PATCH',
      body: { baseRevision: 10, patch: { name: 'Prepared name' } },
    })
  })

  it('prepareCompatibleChatUpdate returns the three child factories in their sequenced order', async () => {
    const calls = stubRevisionCheckedCommandFetch()
    const previousChat = snapshot(testDatabaseState.db.characters[0].chats[0]) as Chat
    const previous = currentChatStateSnapshot()
    const nextChat: Chat = {
      ...previousChat,
      note: 'prepared note',
      message: [
        { role: 'user', data: 'replacement', chatId: 'msg-a' },
        { role: 'char', data: 'new', chatId: 'msg-b' },
      ],
      scriptstate: { $old: '4' },
    }
    testDatabaseState.db.characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdate(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(3)
    prepared.dispatch()

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/scriptstate')).toBe(true)
    })
    const commandBodies = calls.filter((call) => call.url !== '/api/v1/bootstrap').map((call) => call.body)
    // Sequenced through runOptimisticCommandSequence — each command reads
    // the revision advanced by the previous result.
    expect(commandBodies).toEqual([
      { baseRevision: 10, patch: { note: 'prepared note' }, select: false },
      { baseRevision: 11, messages: nextChat.message },
      { baseRevision: 12, patch: { $old: '4' }, deleteKeys: ['$gone'] },
    ])
  })

  it('prepareCompatibleChatUpdate returns an empty factory list when nothing changed', () => {
    const previousChat = snapshot(testDatabaseState.db.characters[0].chats[0]) as Chat
    const previous = currentChatStateSnapshot()
    const nextChat = snapshot(previousChat)
    const prepared = prepareCompatibleChatUpdate(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(0)
    expect(typeof prepared.dispatch).toBe('function')
  })

  it('routes character asset helper writes through character commands', async () => {
    const calls = stubRevisionCheckedCommandFetch()

    changeCharImage(0, 0)
    rmCharEmotion(0, 0)

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/commands/characters/char-a')).toHaveLength(2)
    })
    expect(calls.filter((call) => call.url === '/api/v1/bootstrap')).toHaveLength(1)
    const characterUpdates = calls.filter((call) => call.url === '/api/v1/commands/characters/char-a')
    expect(characterUpdates[0]).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          image: 'asset-old',
          ccAssets: [],
        },
      },
    })
    expect(characterUpdates[1]).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 11,
        patch: {
          emotionImages: [],
        },
      },
    })
  })

  it('keeps character asset helper writes behind trusted projection updates', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      testDatabaseState.db.characters[0].image = 'direct'
    }).toThrow()

    changeCharImage(0, 0)
    rmCharEmotion(0, 0)

    expect(testDatabaseState.db.characters[0].image).toBe('asset-old')
    expect(testDatabaseState.db.characters[0].emotionImages).toEqual([])
    expect(() => {
      testDatabaseState.db.characters[0].image = 'direct'
    }).toThrow()

    await vi.waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/v1/commands/characters/char-a')).toHaveLength(2)
    })
  })

  it('creates characters through trusted optimistic projection writes under the guard', async () => {
    const calls = stubCommandFetch()
    ;(testDatabaseState.db as { enableLorebookStubs?: boolean }).enableLorebookStubs = true
    setResourceWriteGuardEnabled(true)

    expect(() => {
      testDatabaseState.db.characters.push({ chaId: 'direct', name: 'Direct', chats: [] } as any)
    }).toThrow()

    const index = createNewCharacter()

    expect(index).toBe(1)
    expect(testDatabaseState.db.characters[1].name).toBe('')
    expect(isCharacterLorebookMutationReady(testDatabaseState.db.characters[1].chaId)).toBe(true)
    expect(() => {
      testDatabaseState.db.characters.push({ chaId: 'direct-2', name: 'Direct', chats: [] } as any)
    }).toThrow()

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters')).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: 10,
        character: expect.objectContaining({
          name: '',
        }),
      },
    })
  })

  it('creates and selects scratch characters with one server command under the guard', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const index = createNewCharacter({ select: true })

    expect(index).toBe(1)
    expect(get(selectedCharID)).toBe(1)
    expect(testDatabaseState.db.characters[1].lastInteraction).toEqual(expect.any(Number))
    expect(() => {
      testDatabaseState.db.characters[1].lastInteraction = 1
    }).toThrow()

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/create-and-select')).toBe(true)
    })
    const command = calls.find((call) => call.url === '/api/v1/commands/characters/create-and-select')
    expect(command).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: 10,
        character: expect.objectContaining({
          chaId: testDatabaseState.db.characters[1].chaId,
          lastInteraction: testDatabaseState.db.characters[1].lastInteraction,
        }),
        initialChat: expect.objectContaining({
          id: testDatabaseState.db.characters[1].chats[0].id,
          name: 'Chat 1',
          message: [],
        }),
        lastInteraction: testDatabaseState.db.characters[1].lastInteraction,
      },
    })
  })

  it('selects characters without formatting the guarded server projection', async () => {
    const calls = stubCommandFetch()
    testDatabaseState.db.characters[0] = {
      ...testDatabaseState.db.characters[0],
      triggerscript: undefined,
    } as character
    setResourceWriteGuardEnabled(true)

    await changeChar(0)

    expect(get(selectedCharID)).toBe(0)
    expect(testDatabaseState.db.characters[0].triggerscript).toBeUndefined()
    expect(testDatabaseState.db.characters[0].lastInteraction).toEqual(expect.any(Number))
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/select')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/select')).toMatchObject({
      method: 'POST',
      body: {
        baseRevision: 10,
        characterId: 'char-a',
        lastInteraction: testDatabaseState.db.characters[0].lastInteraction,
      },
    })
  })

  it('hydrates a bootstrap character shell before selecting it', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: 10 })
        }
        if (url === '/api/v1/characters/char-b') {
          return jsonResponse({
            revision: 10,
            character: {
              ...seedCharacter(),
              chaId: 'char-b',
              name: 'Hydrated B',
              firstMessage: 'Ready',
              chats: seedCharacter().chats.map((chat) => ({ ...chat, message: [] })),
              customscript: [],
              triggerscript: [],
              globalLore: [],
            },
          })
        }
        if (url === '/api/v1/commands/characters/select') {
          return jsonResponse({
            revision: 11,
            event: { type: 'character.selected', revision: 11, resource: 'characterSelection', id: 'char-b' },
          })
        }
        return jsonResponse({ revision: 11 })
      }) as unknown as typeof fetch,
    )
    testDatabaseState.db = {
      currentChar: 0,
      characters: [
        seedCharacter(),
        {
          __serverCharacterShell: true,
          chaId: 'char-b',
          name: 'Shell B',
          chats: [{ id: 'chat-b', name: 'Chat B', message: [] }],
          chatPage: 0,
          chatFolders: [],
        },
      ],
      characterOrder: ['char-a', 'char-b'],
    } as any
    selectedCharID.set(0)
    setResourceWriteGuardEnabled(true)

    await changeChar(1)

    expect(get(selectedCharID)).toBe(1)
    expect(isServerCharacterShell(testDatabaseState.db.characters[1])).toBe(false)
    expect(testDatabaseState.db.characters[1].name).toBe('Hydrated B')
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/select')).toBe(true)
    })
    const hydrationCallIndex = calls.findIndex((call) => call.url === '/api/v1/characters/char-b')
    const selectionCallIndex = calls.findIndex((call) => call.url === '/api/v1/commands/characters/select')
    expect(hydrationCallIndex).toBeGreaterThanOrEqual(0)
    expect(selectionCallIndex).toBeGreaterThan(hydrationCallIndex)
  })

  it('captures only scalar selection state, never a deep clone of every character', () => {
    // A sidebar click must not pay for JSON-cloning every character's (possibly
    // hydrated) chat history just to hold a selection-rollback snapshot.
    const snapshotResult = currentCharacterSelectionSnapshot('char-a')

    expect(snapshotResult.characterId).toBe('char-a')
    expect(snapshotResult.currentChar).toBe(0)
    expect(snapshotResult.selectedCharID).toBe(0)
    expect(snapshotResult).not.toHaveProperty('characters')
    expect(snapshotResult).not.toHaveProperty('characterOrder')
  })

  it('rolls a failed character selection back to the previous selection only', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
        calls.push({ url, method: init.method ?? 'GET', body })
        if (url === '/api/v1/bootstrap') {
          return jsonResponse({ revision: 10 })
        }
        if (url === '/api/v1/commands/characters/select') {
          return jsonResponse({ error: 'boom' }, 500)
        }
        return jsonResponse({ revision: 11 })
      }) as unknown as typeof fetch,
    )
    const otherChar = {
      ...seedCharacter(),
      chaId: 'char-b',
      name: 'Char B',
      lastInteraction: 1234,
    } as character
    testDatabaseState.db = {
      currentChar: 0,
      characters: [seedCharacter(), otherChar],
      characterOrder: ['char-a', 'char-b'],
    } as any
    selectedCharID.set(0)
    setResourceWriteGuardEnabled(true)

    await changeChar(1)

    // Optimistic selection lands immediately, before the command resolves.
    expect(get(selectedCharID)).toBe(1)

    // The failed select command rolls the selection back to char-a, restoring
    // the unrelated character's lastInteraction without clobbering its state.
    await vi.waitFor(() => {
      expect(get(selectedCharID)).toBe(0)
    })
    expect((testDatabaseState.db as any).currentChar).toBe(0)
    expect(testDatabaseState.db.characters[1].lastInteraction).toBe(1234)
    expect(testDatabaseState.db.characters[1].name).toBe('Char B')
  })

  it('rejects cold-storage character hydration in server-backed web mode', async () => {
    const calls = stubCommandFetch()
    testDatabaseState.db.characters[0].coldstorage = 'cold-char-a'
    selectedCharID.set(-1)

    await changeChar(0)

    expect(getColdStorageItem).not.toHaveBeenCalled()
    expect(alertError).toHaveBeenCalledWith(
      'Cold-storage character hydration is not supported in server-backed web mode yet',
    )
    expect(get(selectedCharID)).toBe(-1)
    expect(calls).toEqual([])
  })

  it('routes MCP character lorebook writes through lorebook commands in server-backed web mode', async () => {
    const calls = stubCommandFetch()
    const handler = new CharacterHandler()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      testDatabaseState.db.characters[0].globalLore = []
    }).toThrow()

    const result = await handler.setCharacterLorebook('char-a', 'Lore', 'content', ['key'])

    expect(result[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully added lorebook entry'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a/lorebooks')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/char-a/lorebooks')).toMatchObject({
      method: 'PUT',
      body: {
        baseRevision: 10,
        entries: [
          expect.objectContaining({
            key: 'key',
            content: 'content',
            comment: 'Lore',
          }),
        ],
      },
    })
  })

  it('routes MCP character regex and Lua writes through script definition commands', async () => {
    const calls = stubCommandFetch()
    testDatabaseState.db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'start',
        conditions: [],
        effect: [{ type: 'triggerlua', code: '' }],
      },
    ]
    const handler = new CharacterHandler()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      testDatabaseState.db.characters[0].customscript = []
    }).toThrow()

    const regexResult = await handler.setCharacterRegexScripts('char-a', 'Regex', undefined, 'in', 'out', 'editdisplay')
    expect(regexResult[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully added regex script'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a/scripts')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/char-a/scripts')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        mutation: {
          op: 'create',
          index: 0,
          row: expect.objectContaining({
            comment: 'Regex',
            in: 'in',
            out: 'out',
            type: 'editdisplay',
          }),
        },
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/char-a/scripts')?.body).not.toHaveProperty(
      'scripts',
    )

    const luaResult = await handler.setCharacterLuaScript('char-a', 'print("hi")')
    expect(luaResult[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully updated Lua script'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a/triggers')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/characters/char-a/triggers')).toMatchObject({
      method: 'PUT',
      body: {
        baseRevision: 11,
        triggers: [
          expect.objectContaining({
            effect: [expect.objectContaining({ type: 'triggerlua', code: 'print("hi")' })],
          }),
        ],
      },
    })
  })

  it('routes MCP module regex and Lua writes through script definition commands', async () => {
    const calls = stubCommandFetch()
    testDatabaseState.db.modules = [
      {
        id: 'mod-a',
        name: 'Module',
        description: '',
        regex: [],
        trigger: [
          {
            comment: '',
            type: 'start',
            conditions: [],
            effect: [{ type: 'triggerlua', code: '' }],
          },
        ],
      },
    ]
    const handler = new ModuleHandler()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      testDatabaseState.db.modules[0].regex = []
    }).toThrow()

    const regexResult = await handler.setModuleRegexScript('mod-a', 'Regex', undefined, 'in', 'out', 'editdisplay')
    expect(regexResult[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully added regex script'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/modules/mod-a/scripts')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/modules/mod-a/scripts')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        mutation: {
          op: 'create',
          index: 0,
          row: expect.objectContaining({
            comment: 'Regex',
            in: 'in',
            out: 'out',
            type: 'editdisplay',
          }),
        },
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/modules/mod-a/scripts')?.body).not.toHaveProperty(
      'scripts',
    )

    const luaResult = await handler.setModuleLuaScript('mod-a', 'print("module")')
    expect(luaResult[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully updated Lua script'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/modules/mod-a/triggers')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/modules/mod-a/triggers')).toMatchObject({
      method: 'PUT',
      body: {
        baseRevision: 11,
        triggers: [
          expect.objectContaining({
            effect: [expect.objectContaining({ type: 'triggerlua', code: 'print("module")' })],
          }),
        ],
      },
    })
  })

  it('routes MCP module info and enablement writes through module commands', async () => {
    const calls = stubCommandFetch()
    testDatabaseState.db.modules = [{ id: 'mod-a', name: 'Module', description: '' }]
    testDatabaseState.db.enabledModules = []
    const handler = new ModuleHandler()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      testDatabaseState.db.enabledModules.push('mod-a')
    }).toThrow()

    const result = await handler.setModuleInfo('mod-a', {
      name: 'Renamed module',
      description: 'Updated',
      enabled: true,
    })
    expect(result[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully updated module'),
    })

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/modules/mod-a')).toBe(true)
      expect(calls.some((call) => call.url === '/api/v1/commands/modules/enable')).toBe(true)
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/modules/mod-a')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          name: 'Renamed module',
          description: 'Updated',
        },
      },
    })
    expect(calls.find((call) => call.url === '/api/v1/commands/modules/enable')).toMatchObject({
      method: 'POST',
      body: {
        moduleId: 'mod-a',
        enabled: true,
      },
    })
  })
})

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
