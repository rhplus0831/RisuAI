import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('./storage/nodeStorage', () => ({
  getNodeServerProxyAuth: async () => 'compat-auth-token',
}))

vi.mock('./alert', () => ({
  alertConfirm: vi.fn(async () => true),
}))

import { clearCachedServerCommandRevision, type CommandEvent } from './server/commands'
import {
  currentCharacterStateSnapshot,
  dispatchCompatibleCharacterUpdate,
} from './characterCommands'
import { currentChatStateSnapshot, dispatchCompatibleChatUpdate } from './chatCommands'
import { CharacterHandler } from './process/mcp/risuaccess/characters'
import { ModuleHandler } from './process/mcp/risuaccess/modules'
import { DBState, selectedCharID } from './stores.svelte'
import type { Chat, character } from './storage/database.svelte'
import { changeCharImage, rmCharEmotion } from './characters'

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
  platformState.isFastifyServer = true
  clearCachedServerCommandRevision()
  vi.unstubAllGlobals()
  selectedCharID.set(0)
  DBState.db = {
    currentChar: 0,
    characters: [seedCharacter()],
    characterOrder: ['char-a'],
  } as any
})

describe('Phase 9-3f compatibility adapters', () => {
  it('routes whole-character compatibility setters through character scalar commands', async () => {
    const calls = stubCommandFetch()
    const previousCharacter = snapshot(DBState.db.characters[0])
    const previous = currentCharacterStateSnapshot()
    DBState.db.characters[0] = {
      ...DBState.db.characters[0],
      name: 'New name',
      desc: 'New desc',
      chats: [
        {
          ...DBState.db.characters[0].chats[0],
          name: 'child change stays out of character scalar patch',
        },
      ],
    }

    dispatchCompatibleCharacterUpdate(previousCharacter, DBState.db.characters[0], previous)

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
    const previousChat = snapshot(DBState.db.characters[0].chats[0]) as Chat
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
    DBState.db.characters[0].chats[0] = nextChat

    dispatchCompatibleChatUpdate(previousChat, nextChat, previous)

    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/scriptstate')).toBe(
        true,
      )
    })
    expect(calls.filter((call) => call.url === '/api/v1/bootstrap')).toHaveLength(3)
    expect(calls.find((call) => call.url === '/api/v1/commands/chats/chat-a')).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: { note: 'new note' },
      },
    })
    expect(
      calls.find((call) => call.url === '/api/v1/commands/chats/chat-a/messages'),
    ).toMatchObject({
      method: 'PUT',
      body: {
        baseRevision: 10,
        messages: nextChat.message,
      },
    })
    expect(
      calls.find((call) => call.url === '/api/v1/commands/chats/chat-a/scriptstate'),
    ).toMatchObject({
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: { $old: '2' },
        deleteKeys: ['$gone'],
      },
    })
  })

  it('does not dispatch compatibility commands outside Fastify mode', async () => {
    platformState.isFastifyServer = false
    const calls = stubCommandFetch()
    const previousCharacter = snapshot(DBState.db.characters[0])
    const previous = currentCharacterStateSnapshot()
    DBState.db.characters[0].name = 'Local mode'

    dispatchCompatibleCharacterUpdate(previousCharacter, DBState.db.characters[0], previous)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    expect(get(selectedCharID)).toBe(0)
  })

  it('routes character asset helper writes through character commands', async () => {
    const calls = stubCommandFetch()

    changeCharImage(0, 0)
    rmCharEmotion(0, 0)

    await vi.waitFor(() => {
      expect(
        calls.filter((call) => call.url === '/api/v1/commands/characters/char-a'),
      ).toHaveLength(2)
    })
    expect(calls.filter((call) => call.url === '/api/v1/bootstrap')).toHaveLength(2)
    const characterUpdates = calls.filter(
      (call) => call.url === '/api/v1/commands/characters/char-a',
    )
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
        baseRevision: 10,
        patch: {
          emotionImages: [],
        },
      },
    })
  })

  it('routes MCP character lorebook writes through lorebook commands in server-backed web mode', async () => {
    const calls = stubCommandFetch()
    const handler = new CharacterHandler()

    const result = await handler.setCharacterLorebook('char-a', 'Lore', 'content', ['key'])

    expect(result[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully added lorebook entry'),
    })
    await vi.waitFor(() => {
      expect(
        calls.some((call) => call.url === '/api/v1/commands/characters/char-a/lorebooks'),
      ).toBe(true)
    })
    expect(
      calls.find((call) => call.url === '/api/v1/commands/characters/char-a/lorebooks'),
    ).toMatchObject({
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
    const handler = new CharacterHandler()

    const regexResult = await handler.setCharacterRegexScripts(
      'char-a',
      'Regex',
      undefined,
      'in',
      'out',
      'editdisplay',
    )
    expect(regexResult[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully added regex script'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a/scripts')).toBe(
        true,
      )
    })
    expect(
      calls.find((call) => call.url === '/api/v1/commands/characters/char-a/scripts'),
    ).toMatchObject({
      method: 'PUT',
      body: {
        baseRevision: 10,
        scripts: [
          expect.objectContaining({
            comment: 'Regex',
            in: 'in',
            out: 'out',
            type: 'editdisplay',
          }),
        ],
      },
    })

    DBState.db.characters[0].triggerscript = [
      {
        comment: '',
        type: 'start',
        conditions: [],
        effect: [{ type: 'triggerlua', code: '' }],
      },
    ]
    const luaResult = await handler.setCharacterLuaScript('char-a', 'print("hi")')
    expect(luaResult[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully updated Lua script'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/characters/char-a/triggers')).toBe(
        true,
      )
    })
    expect(
      calls.find((call) => call.url === '/api/v1/commands/characters/char-a/triggers'),
    ).toMatchObject({
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
    DBState.db.modules = [
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

    const regexResult = await handler.setModuleRegexScript(
      'mod-a',
      'Regex',
      undefined,
      'in',
      'out',
      'editdisplay',
    )
    expect(regexResult[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully added regex script'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/modules/mod-a/scripts')).toBe(true)
    })
    expect(
      calls.find((call) => call.url === '/api/v1/commands/modules/mod-a/scripts'),
    ).toMatchObject({
      method: 'PUT',
      body: {
        baseRevision: 10,
        scripts: [
          expect.objectContaining({
            comment: 'Regex',
            in: 'in',
            out: 'out',
            type: 'editdisplay',
          }),
        ],
      },
    })

    const luaResult = await handler.setModuleLuaScript('mod-a', 'print("module")')
    expect(luaResult[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Successfully updated Lua script'),
    })
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url === '/api/v1/commands/modules/mod-a/triggers')).toBe(
        true,
      )
    })
    expect(
      calls.find((call) => call.url === '/api/v1/commands/modules/mod-a/triggers'),
    ).toMatchObject({
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
    DBState.db.modules = [{ id: 'mod-a', name: 'Module', description: '' }]
    DBState.db.enabledModules = []
    const handler = new ModuleHandler()

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
