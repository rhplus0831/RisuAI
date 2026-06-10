import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'chat-command-token',
}))

import {
  clearCachedServerCommandRevision,
  type ChatFolderSnapshot,
  type ChatSnapshot,
  type ServerCommandResult,
} from './server/commands'
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
// Import the heavy database module AFTER stores.svelte: importing it first
// triggers a circular-import TDZ when the reactive moduleUpdate $effect runs
// mid-init (see the clone-narrowing Phase 8 gotcha).
import { setCurrentChat, type Chat, type Message } from './storage/database.svelte'
import { get } from 'svelte/store'
import {
  applyOptimisticCreatedChat,
  applyOptimisticDeletedChat,
  appendCurrentChatUserMessageForSend,
  changedChatMetadata,
  CHAT_PATCH_ALLOWED_KEYS,
  currentChatScopedSnapshot,
  currentChatScriptstateSnapshot,
  currentChatSelectionSnapshot,
  currentChatStateSnapshot,
  dispatchCreateChat,
  dispatchCreateChatFolder,
  dispatchDeleteChat,
  dispatchPatchChatScriptstate,
  dispatchPatchChatScriptstateScoped,
  dispatchReorderChatFoldersByIds,
  dispatchReorderChatsByIds,
  dispatchReplaceMessagesScoped,
  dispatchSelectChat,
  dispatchUpdateChat,
  dispatchUpdateChatNoteScoped,
  restoreChatFolderRowMetadata,
  restoreChatRowMetadata,
  restoreChatState,
  restoreChatScopedState,
  restoreChatScriptstate,
  restoreChatSelection,
  runOptimisticCommandSequence,
  sanitizeChatPatch,
} from './chatCommands'
import {
  assertRollbackRestoresOnly,
  assertSnapshotIsScalar,
  assertSnapshotOmitsCollections,
  seedCloneCostDb,
  withCloneInstrumentation,
} from './__tests__/cloneCostHarness'

interface CapturedFetch {
  url: string
  method: string
  authHeader: string | null
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
      const headers = init.headers as Record<string, string> | undefined
      const url = String(input)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url === '/api/v1/commands/characters/char-a/chats') {
        return jsonResponse({
          revision: 11,
          event: { type: 'chat.created', revision: 11, resource: 'chat' },
          selectedChatId: 'chat-b',
        })
      }
      if (url === '/api/v1/commands/characters/char-a/chat-folders') {
        return jsonResponse({
          revision: 12,
          event: { type: 'chatFolder.created', revision: 12, resource: 'chatFolder' },
          folderId: 'folder-a',
        })
      }
      if (url === '/api/v1/commands/chats/chat-a') {
        if (init.method === 'DELETE') {
          return jsonResponse({
            revision: 18,
            event: { type: 'chat.deleted', revision: 18, resource: 'chat', id: 'chat-a' },
            chatId: 'chat-a',
            selectedChatId: 'chat-b',
          })
        }
        return jsonResponse({
          revision: 13,
          event: { type: 'chat.updated', revision: 13, resource: 'chat' },
          selectedChatId: 'chat-a',
        })
      }
      if (url === '/api/v1/commands/chats/chat-b') {
        return jsonResponse({
          revision: 13,
          event: { type: 'chat.updated', revision: 13, resource: 'characterRow' },
          selectedChatId: 'chat-b',
        })
      }
      if (url === '/api/v1/commands/characters/char-a/chats/reorder') {
        return jsonResponse({
          revision: 14,
          event: { type: 'chat.reordered', revision: 14, resource: 'chat' },
          selectedChatId: 'chat-a',
        })
      }
      if (url === '/api/v1/commands/characters/char-a/chat-folders/reorder') {
        return jsonResponse({
          revision: 15,
          event: { type: 'chatFolder.reordered', revision: 15, resource: 'chatFolder' },
          selectedChatId: 'chat-a',
        })
      }
      if (url === '/api/v1/commands/chats/chat-a/scriptstate') {
        return jsonResponse({
          revision: 16,
          event: {
            type: 'chat.scriptstate.updated',
            revision: 16,
            resource: 'chat',
            id: 'chat-a',
          },
          chatId: 'chat-a',
        })
      }
      if (url === '/api/v1/commands/chats/chat-a/messages') {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
        return jsonResponse({
          revision: 17,
          event: {
            type: 'message.appended',
            revision: 17,
            resource: 'message',
            id: body.message?.chatId,
            parentId: 'chat-a',
          },
          chatId: 'chat-a',
          messageId: body.message?.chatId,
        })
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

async function waitForCallCount(calls: CapturedFetch[], expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(calls).toHaveLength(expected)
}

function jsonClone<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function jsonSnapshot(value: unknown): string {
  const snapshot = JSON.stringify(value)
  return snapshot === undefined ? '__undefined__' : snapshot
}

function legacyChangedChatMetadata(previous: Chat, current: Chat): ChatSnapshot {
  const patch: ChatSnapshot = {}
  const previousSnapshot = sanitizeChatPatch(jsonClone(previous) as unknown as ChatSnapshot)
  const currentSnapshot = sanitizeChatPatch(jsonClone(current) as unknown as ChatSnapshot)
  const keys = new Set([...Object.keys(previousSnapshot), ...Object.keys(currentSnapshot)])
  for (const key of keys) {
    if (jsonSnapshot(previousSnapshot[key]) !== jsonSnapshot(currentSnapshot[key])) {
      patch[key] = jsonClone(currentSnapshot[key])
    }
  }
  return patch
}

function orderedChatMetadata(values: Record<string, unknown>): Chat {
  const chat: Record<string, unknown> = {
    id: 'chat-m9',
    message: [{ role: 'user', data: 'ignored transcript', chatId: 'msg-m9' }],
    localLore: [{ id: 'ignored-lore', key: 'x', content: 'ignored' }],
    hypaV3Data: { ignored: true },
  }
  for (const key of CHAT_PATCH_ALLOWED_KEYS) {
    if (key in values) chat[key] = values[key]
  }
  return chat as unknown as Chat
}

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  DBState.db = {
    enabledModules: [],
    moduleIntergration: '',
    modules: [],
    characters: [
      {
        chaId: 'char-a',
        name: 'Character',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            folderId: null,
            message: [],
            scriptstate: { $score: '1', $old: 'gone' },
          },
          { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
        ],
        chatFolders: [{ id: 'folder-a', name: 'Folder', folded: false }],
      },
    ],
  } as any
})

afterEach(() => {
  setServerProjectionWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('chat command projection helpers', () => {
  it('optimistically inserts and selects a command-created chat under the projection guard', () => {
    setServerProjectionWriteGuardEnabled(true)
    const previous = currentChatStateSnapshot()
    const chat = {
      id: 'chat-c',
      name: 'Chat C',
      note: '',
      message: [],
      localLore: [],
      fmIndex: -1,
    } as Chat

    expect(applyOptimisticCreatedChat('char-a', chat, previous)).toBe(true)

    expect(DBState.db.characters[0].chats.map((candidate) => candidate.id)).toEqual([
      'chat-c',
      'chat-a',
      'chat-b',
    ])
    expect(DBState.db.characters[0].chatPage).toBe(0)

    restoreChatState(previous)
    expect(DBState.db.characters[0].chats.map((candidate) => candidate.id)).toEqual([
      'chat-a',
      'chat-b',
    ])
  })

  it('optimistically removes a command-deleted chat under the projection guard', () => {
    setServerProjectionWriteGuardEnabled(true)
    const previous = currentChatStateSnapshot()

    expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toEqual({
      applied: true,
      selectedChatId: 'chat-b',
    })

    expect(DBState.db.characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-b'])
    expect(DBState.db.characters[0].chatPage).toBe(0)

    restoreChatState(previous)
    expect(DBState.db.characters[0].chats.map((candidate) => candidate.id)).toEqual([
      'chat-a',
      'chat-b',
    ])
  })

  it('routes SideChatList chat and folder flows through commands under the projection guard', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.characters[0].chats.unshift({ id: 'direct', name: 'Direct', message: [] } as any)
    }).toThrow()

    const createChat: ChatSnapshot = {
      id: 'chat-c',
      name: 'Chat C',
      note: '',
      message: [],
      localLore: [],
      fmIndex: -1,
    }
    const createFolder: ChatFolderSnapshot = {
      id: 'folder-b',
      name: 'Folder B',
      folded: false,
    }
    const previous = currentChatStateSnapshot()

    dispatchCreateChat('char-a', createChat as any, previous)
    await waitForCallCount(calls, 2)
    dispatchCreateChatFolder('char-a', createFolder as any, previous)
    await waitForCallCount(calls, 3)
    dispatchUpdateChat('chat-a', {}, previous, true)
    await waitForCallCount(calls, 4)
    dispatchReorderChatsByIds(
      'char-a',
      ['chat-b', 'chat-a'],
      { 'chat-a': null, 'chat-b': 'folder-a' },
      previous,
      'chat-a',
    )
    await waitForCallCount(calls, 5)
    dispatchReorderChatFoldersByIds('char-a', ['folder-a'], previous, 'chat-a')

    await waitForCallCount(calls, 6)
    dispatchDeleteChat('chat-a', previous)

    await waitForCallCount(calls, 7)
    expect(() => {
      DBState.db.characters[0].chatFolders.push({ id: 'direct-folder', name: 'Direct' } as any)
    }).toThrow()
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'chat-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/characters/char-a/chats',
        method: 'POST',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: 10,
          chat: createChat,
          select: true,
        },
      },
      {
        url: '/api/v1/commands/characters/char-a/chat-folders',
        method: 'POST',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: expect.any(Number),
          folder: createFolder,
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a',
        method: 'PATCH',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: expect.any(Number),
          patch: {},
          select: true,
        },
      },
      {
        url: '/api/v1/commands/characters/char-a/chats/reorder',
        method: 'POST',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: expect.any(Number),
          chatIds: ['chat-b', 'chat-a'],
          folderByChatId: { 'chat-a': null, 'chat-b': 'folder-a' },
          selectedChatId: 'chat-a',
        },
      },
      {
        url: '/api/v1/commands/characters/char-a/chat-folders/reorder',
        method: 'POST',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: expect.any(Number),
          folderIds: ['folder-a'],
          selectedChatId: 'chat-a',
        },
      },
      {
        url: '/api/v1/commands/chats/chat-a',
        method: 'DELETE',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: expect.any(Number),
        },
      },
    ])
  })

  it('routes DevTool-style scriptstate edits through the chat scriptstate command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)
    const previous = currentChatStateSnapshot()

    expect(() => {
      DBState.db.characters[0].chats[0].scriptstate!.$score = 'direct'
    }).toThrow()

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].scriptstate!.$score = '9'
    })
    dispatchPatchChatScriptstate('chat-a', { $score: '9' }, [], previous)

    await waitForCallCount(calls, 2)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'chat-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/chats/chat-a/scriptstate',
        method: 'PATCH',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: 10,
          patch: { $score: '9' },
          deleteKeys: [],
        },
      },
    ])
    expect(DBState.db.characters[0].chats[0].scriptstate).toMatchObject({ $score: '9' })
  })

  it('appends DevTool Autopilot user messages through an awaited message command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.characters[0].chats[0].message.push({ role: 'user', data: 'direct' })
    }).toThrow()

    const result = await appendCurrentChatUserMessageForSend('autopilot row')

    expect(result.status).toBe('ok')
    await waitForCallCount(calls, 2)
    const message = DBState.db.characters[0].chats[0].message[0]
    expect(message).toMatchObject({
      role: 'user',
      data: 'autopilot row',
      chatId: expect.any(String),
      time: expect.any(Number),
    })
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'chat-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/chats/chat-a/messages',
        method: 'POST',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: 10,
          message: {
            role: 'user',
            data: 'autopilot row',
            chatId: message.chatId,
            time: message.time,
          },
        },
      },
    ])
  })

  it('appends prepared plain-send user messages through one-message POST bodies', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)
    const prepared: Message = {
      role: 'user',
      data: 'prepared plain send',
      time: 123456,
      name: null,
    }

    const result = await appendCurrentChatUserMessageForSend(prepared)

    expect(result.status).toBe('ok')
    await waitForCallCount(calls, 2)
    const message = DBState.db.characters[0].chats[0].message[0]
    expect(message).toMatchObject({
      role: 'user',
      data: 'prepared plain send',
      chatId: expect.any(String),
      time: 123456,
      name: null,
    })
    expect(calls[1]).toEqual({
      url: '/api/v1/commands/chats/chat-a/messages',
      method: 'POST',
      authHeader: 'chat-command-token',
      body: {
        baseRevision: 10,
        message: {
          role: 'user',
          data: 'prepared plain send',
          chatId: message.chatId,
          time: 123456,
          name: null,
        },
      },
    })
    expect(calls[1].body).not.toHaveProperty('messages')
  })

  it('rolls back optimistic scriptstate edits when the command fails', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = init.headers as Record<string, string> | undefined
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })

        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/scriptstate') {
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerProjectionWriteGuardEnabled(true)
    const previous = currentChatStateSnapshot()

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].scriptstate!.$score = 'failed'
    })
    dispatchPatchChatScriptstate('chat-a', { $score: 'failed' }, [], previous)

    await waitForCallCount(calls, 2)
    expect(DBState.db.characters[0].chats[0].scriptstate).toEqual({ $score: '1', $old: 'gone' })
  })

  it('rolls back failed send appends by appended message id only', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = init.headers as Record<string, string> | undefined
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })

        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/messages') {
          withTrustedServerProjectionWrite(() => {
            DBState.db.characters[0].chats[0].message.push({
              role: 'char',
              data: 'later projection message',
              chatId: 'm-later',
            })
          })
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerProjectionWriteGuardEnabled(true)
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].message.push({
        role: 'char',
        data: 'pre-existing',
        chatId: 'm-existing',
      })
    })

    const result = await appendCurrentChatUserMessageForSend({
      role: 'user',
      data: 'failed plain send row',
      time: 222,
      name: null,
    })

    expect(result).toEqual({ status: 'error', error: 'nope' })
    await waitForCallCount(calls, 2)
    expect(DBState.db.characters[0].chats[0].message).toEqual([
      { role: 'char', data: 'pre-existing', chatId: 'm-existing' },
      { role: 'char', data: 'later projection message', chatId: 'm-later' },
    ])
  })

  it('does not roll back into the active chat when the original chat id disappears', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = init.headers as Record<string, string> | undefined
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })

        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/messages') {
          withTrustedServerProjectionWrite(() => {
            const character = DBState.db.characters[0]
            const siblingChat = character.chats.find((chat: Chat) => chat.id === 'chat-b')
            if (!siblingChat) throw new Error('missing sibling chat')
            character.chats = [siblingChat]
            character.chatPage = 0
          })
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerProjectionWriteGuardEnabled(true)
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[1].message.push({
        role: 'char',
        data: 'same id on active sibling',
        chatId: 'm-shared',
      })
    })

    const result = await appendCurrentChatUserMessageForSend({
      role: 'user',
      data: 'failed vanished-chat send',
      chatId: 'm-shared',
      time: 333,
      name: null,
    })

    expect(result).toEqual({ status: 'error', error: 'nope' })
    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/messages',
      method: 'POST',
      body: {
        message: {
          chatId: 'm-shared',
        },
      },
    })
    expect(DBState.db.characters[0].chats).toHaveLength(1)
    expect(DBState.db.characters[0].chats[0]).toMatchObject({
      id: 'chat-b',
      message: [{ role: 'char', data: 'same id on active sibling', chatId: 'm-shared' }],
    })
  })
})

describe('Phase 0 chat-scoped snapshot kit', () => {
  it('captures only the active chat, never the whole characters array', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)

    const snapshot = currentChatScopedSnapshot()

    expect(snapshot.characterId).toBe('char-0')
    expect(snapshot.chatId).toBe('chat-0')
    expect(snapshot.selectedCharID).toBe(0)
    expect(snapshot.chat?.message).toHaveLength(40)
    expect(snapshot).not.toHaveProperty('characters')
    assertSnapshotOmitsCollections(snapshot)

    const charactersSize = JSON.stringify(DBState.db.characters).length
    const instrumented = withCloneInstrumentation(() => currentChatScopedSnapshot())
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
  })

  it('restores only the active chat, preserving concurrent edits to other chats', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => currentChatScopedSnapshot(),
      mutate: () => {
        DBState.db.characters[0].chats[0].message.push({
          role: 'char',
          data: 'optimistic',
          chatId: 'msg-extra',
        })
        // an unrelated, concurrent edit to a different character's chat
        DBState.db.characters[1].chats[0].note = 'sibling concurrent note'
      },
      expectMutated: () => {
        expect(DBState.db.characters[0].chats[0].message).toHaveLength(41)
      },
      restore: (snapshot) => restoreChatScopedState(snapshot),
      expectRestored: () => {
        expect(DBState.db.characters[0].chats[0].message).toHaveLength(40)
      },
      expectUntouched: () => {
        expect(DBState.db.characters[1].chats[0].note).toBe('sibling concurrent note')
      },
    })
  })

  it('restores the chat by stable id even when its character index has shifted', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)
    const snapshot = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message.push({
      role: 'char',
      data: 'optimistic',
      chatId: 'msg-extra',
    })
    DBState.db.characters.unshift({ chaId: 'char-new', name: 'Inserted', chats: [] } as any)

    restoreChatScopedState(snapshot)

    const restored = DBState.db.characters.find((c: any) => c.chaId === 'char-0')
    expect(restored.chats[0].message).toHaveLength(40)
  })
})

describe('Phase 0 chat-scriptstate snapshot kit', () => {
  it('captures only the scriptstate map and an optional note, never a chat or the collection', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)

    const snapshot = currentChatScriptstateSnapshot()
    expect(snapshot.chatId).toBe('chat-0')
    expect(snapshot.scriptstate).toEqual({ $score: '0', $old: 'gone' })
    expect(snapshot.note).toBeUndefined()
    assertSnapshotIsScalar(snapshot)

    const withNote = currentChatScriptstateSnapshot(true)
    expect(withNote.note).toBe('note-0')
    assertSnapshotIsScalar(withNote)

    // The scriptstate map is shallow-cloned: mutating the live map after the
    // snapshot must not bleed into the captured copy.
    DBState.db.characters[0].chats[0].scriptstate.$score = '99'
    expect(snapshot.scriptstate?.$score).toBe('0')
  })

  it('restores scriptstate and note only, preserving concurrent message edits on the same chat', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => currentChatScriptstateSnapshot(true),
      mutate: () => {
        DBState.db.characters[0].chats[0].scriptstate = { $score: 'optimistic' }
        DBState.db.characters[0].chats[0].note = 'optimistic note'
        // a concurrent, unrelated edit to the same chat's message history
        DBState.db.characters[0].chats[0].message.push({
          role: 'char',
          data: 'concurrent',
          chatId: 'msg-concurrent',
        })
      },
      expectMutated: () => {
        expect(DBState.db.characters[0].chats[0].scriptstate).toEqual({ $score: 'optimistic' })
      },
      restore: (snapshot) => restoreChatScriptstate(snapshot),
      expectRestored: () => {
        expect(DBState.db.characters[0].chats[0].scriptstate).toEqual({
          $score: '0',
          $old: 'gone',
        })
        expect(DBState.db.characters[0].chats[0].note).toBe('note-0')
      },
      expectUntouched: () => {
        // a whole-chat restore would have wiped this concurrent message
        expect(DBState.db.characters[0].chats[0].message).toHaveLength(41)
      },
    })
  })
})

// Stability/performance plan, Phase 1 H2: chat select only flips the owning
// character's `chatPage`, so its rollback is a scalar snapshot — never the
// whole-characters `ChatStateSnapshot` clone the old `changeChatTo` captured
// on every chat click.
describe('H2 chat-selection snapshot', () => {
  it('captures only selection scalars and performs zero clone work', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)

    const instrumented = withCloneInstrumentation(() => currentChatSelectionSnapshot())
    const snapshot = instrumented.result
    expect(snapshot).toEqual({ characterId: 'char-0', selectedCharID: 0, chatPage: 0 })
    assertSnapshotIsScalar(snapshot)
    // Purely scalar reads: not a single clone primitive call. The old path
    // JSON-cloned the whole characters array (hydrated transcripts included).
    expect(instrumented.totalCloneCount).toBe(0)
  })

  it('restores only the owning character chatPage, never the selection or sibling edits', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => currentChatSelectionSnapshot(),
      mutate: () => {
        // the optimistic select write
        DBState.db.characters[0].chatPage = 1
        // concurrent, unrelated edits a whole-array restore would wipe
        DBState.db.characters[0].chats[0].message.push({
          role: 'char',
          data: 'concurrent',
          chatId: 'msg-concurrent',
        })
        DBState.db.characters[1].chats[0].note = 'sibling concurrent note'
        // a concurrent character switch the rollback must not undo
        selectedCharID.set(1)
      },
      expectMutated: () => {
        expect(DBState.db.characters[0].chatPage).toBe(1)
      },
      restore: (snapshot) => restoreChatSelection(snapshot),
      expectRestored: () => {
        expect(DBState.db.characters[0].chatPage).toBe(0)
      },
      expectUntouched: () => {
        expect(DBState.db.characters[0].chats[0].message).toHaveLength(41)
        expect(DBState.db.characters[1].chats[0].note).toBe('sibling concurrent note')
        // chat select never mutates the character selection; restore must not
        // re-write it either (it only locates the row by it)
        expect(get(selectedCharID)).toBe(1)
      },
    })
  })

  it('restores chatPage by stable chaId even when the character index shifted', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)
    const snapshot = currentChatSelectionSnapshot()

    DBState.db.characters[0].chatPage = 1
    DBState.db.characters.unshift({
      chaId: 'char-new',
      name: 'Inserted',
      chatPage: 9,
      chats: [],
    } as any)

    restoreChatSelection(snapshot)

    expect(DBState.db.characters.find((c: any) => c.chaId === 'char-0').chatPage).toBe(0)
    // the character now sitting at the stale index is untouched
    expect(DBState.db.characters[0].chatPage).toBe(9)
  })

  it('dispatchSelectChat sends the empty-patch select command', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    dispatchSelectChat('chat-a', currentChatSelectionSnapshot())
    await waitForCallCount(calls, 2)

    expect(calls[1]).toEqual({
      url: '/api/v1/commands/chats/chat-a',
      method: 'PATCH',
      authHeader: 'chat-command-token',
      body: {
        baseRevision: 10,
        patch: {},
        select: true,
      },
    })
  })

  it('dispatchSelectChat optimistically updates chatPage before the PATCH resolves', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    dispatchSelectChat('chat-b', currentChatSelectionSnapshot())

    expect(DBState.db.characters[0].chatPage).toBe(1)
    await waitForCallCount(calls, 2)
    expect(calls[1]).toEqual({
      url: '/api/v1/commands/chats/chat-b',
      method: 'PATCH',
      authHeader: 'chat-command-token',
      body: {
        baseRevision: 10,
        patch: {},
        select: true,
      },
    })
  })

  it('dispatchSelectChat rolls back the optimistic chatPage on command failure', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = init.headers as Record<string, string> | undefined
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })

        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-b') return jsonResponse({ error: 'nope' }, 500)
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerProjectionWriteGuardEnabled(true)

    dispatchSelectChat('chat-b', currentChatSelectionSnapshot())

    expect(DBState.db.characters[0].chatPage).toBe(1)
    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chatPage).toBe(0)
    })
  })
})

describe('Phase 2 chat-metadata-row rollback', () => {
  function scalarMetadata(chatIndex: number): ChatSnapshot {
    const chat = DBState.db.characters[0].chats[chatIndex] as unknown as Record<string, unknown>
    const metadata: Record<string, unknown> = {}
    // mirror the watcher's allowed scalar metadata keys for the seeded fields
    for (const key of ['name', 'note', 'folderId', 'bindedPersona'] as const) {
      if (chat[key] !== undefined) metadata[key] = chat[key]
    }
    return metadata as ChatSnapshot
  }

  it('restores only the one chat row, preserving message history and unrelated chats', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => ({
        selectedCharID: 0,
        characterId: 'char-0',
        chatId: 'chat-0',
        metadata: scalarMetadata(0),
      }),
      mutate: () => {
        // optimistic metadata change the failing command must undo
        DBState.db.characters[0].chats[0].name = 'Optimistic Name'
        // unrelated concurrent edits a whole-array restore would have clobbered
        DBState.db.characters[0].chats[0].message.push({
          role: 'char',
          data: 'concurrent',
          chatId: 'msg-concurrent',
        })
        DBState.db.characters[1].chats[0].note = 'sibling concurrent note'
      },
      expectMutated: () => {
        expect(DBState.db.characters[0].chats[0].name).toBe('Optimistic Name')
      },
      restore: (snapshot) => restoreChatRowMetadata(snapshot),
      expectRestored: () => {
        expect(DBState.db.characters[0].chats[0].name).toBe('Chat 0')
      },
      expectUntouched: () => {
        expect(DBState.db.characters[0].chats[0].message).toHaveLength(41)
        expect(DBState.db.characters[1].chats[0].note).toBe('sibling concurrent note')
      },
    })
  })

  it('drops an allowed key the optimistic change added but the baseline lacked', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)
    // baseline has no bindedPersona
    const snapshot = {
      selectedCharID: 0,
      characterId: 'char-0',
      chatId: 'chat-0',
      metadata: scalarMetadata(0),
    }
    expect(snapshot.metadata).not.toHaveProperty('bindedPersona')

    DBState.db.characters[0].chats[0].bindedPersona = 'persona-x'
    restoreChatRowMetadata(snapshot)

    expect(DBState.db.characters[0].chats[0].bindedPersona).toBeUndefined()
  })

  it('restores only the one folder row by stable id', () => {
    DBState.db = seedCloneCostDb() as any
    DBState.db.characters[0].chatFolders = [
      { id: 'folder-0', name: 'Folder Zero', color: '#111', folded: false },
    ]
    DBState.db.characters[1].chatFolders = [
      { id: 'folder-1', name: 'Folder One', color: '#222', folded: false },
    ]
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => ({
        selectedCharID: 0,
        characterId: 'char-0',
        folderId: 'folder-0',
        metadata: { name: 'Folder Zero', color: '#111', folded: false } as ChatFolderSnapshot,
      }),
      mutate: () => {
        DBState.db.characters[0].chatFolders[0].folded = true
        DBState.db.characters[0].chatFolders[0].name = 'Optimistic Folder'
        DBState.db.characters[1].chatFolders[0].name = 'Sibling Folder Edit'
      },
      expectMutated: () => {
        expect(DBState.db.characters[0].chatFolders[0].folded).toBe(true)
      },
      restore: (snapshot) => restoreChatFolderRowMetadata(snapshot),
      expectRestored: () => {
        expect(DBState.db.characters[0].chatFolders[0]).toMatchObject({
          name: 'Folder Zero',
          color: '#111',
          folded: false,
        })
      },
      expectUntouched: () => {
        expect(DBState.db.characters[1].chatFolders[0].name).toBe('Sibling Folder Edit')
      },
    })
  })
})

describe('Phase 4 chat metadata allowed-key diff (M9)', () => {
  it('M9: allowed metadata diffs match the previous clone-sanitize patch bytes', () => {
    const previous = orderedChatMetadata({
      name: 'Old chat',
      note: 'same note',
      lastMemory: 'same memory',
      suggestMessages: ['old suggestion'],
      bindedPersona: 'persona-old',
      fmIndex: 1,
      folderId: 'folder-old',
      bookmarks: ['msg-old'],
      bookmarkNames: { 'msg-old': 'Old bookmark' },
      modules: ['module-a'],
    })
    const current = orderedChatMetadata({
      name: 'New chat',
      note: 'same note',
      sdData: 'new sd payload',
      lastMemory: 'same memory',
      suggestMessages: ['new suggestion'],
      fmIndex: 2,
      folderId: null,
      bookmarks: ['msg-new'],
      bookmarkNames: { 'msg-new': 'New bookmark' },
      modules: ['module-a', 'module-b'],
    })
    current.message = [{ role: 'char', data: 'ignored transcript change', chatId: 'msg-new' }]
    current.localLore = [
      { id: 'ignored-lore-new', key: 'y', content: 'ignored changed lore' },
    ] as any
    ;(current as any).hypaV3Data = { ignored: 'changed memory payload' }

    const patch = changedChatMetadata(previous, current)
    const legacyPatch = legacyChangedChatMetadata(previous, current)

    expect(Object.keys(patch)).toEqual(Object.keys(legacyPatch))
    expect(JSON.stringify(patch)).toBe(JSON.stringify(legacyPatch))
    expect(JSON.stringify(sanitizeChatPatch(patch))).toBe(
      JSON.stringify(sanitizeChatPatch(legacyPatch)),
    )
    expect(patch).toHaveProperty('bindedPersona', undefined)
    expect(sanitizeChatPatch(patch)).not.toHaveProperty('bindedPersona')
    expect(patch).not.toHaveProperty('message')
    expect(patch).not.toHaveProperty('localLore')
    expect(patch).not.toHaveProperty('hypaV3Data')
  })

  it('M9: message-only changes produce an empty patch without serializing message arrays', () => {
    const body = 'x'.repeat(1200)
    const previous = orderedChatMetadata({ name: 'Same chat', note: 'same note' })
    previous.message = Array.from({ length: 120 }, (_unused, index) => ({
      role: index % 2 === 0 ? 'user' : 'char',
      data: `${body}-${index}`,
      chatId: `msg-long-${index}`,
    }))
    previous.localLore = [{ id: 'lore-old', key: 'old', content: body.repeat(10) }] as any
    ;(previous as any).hypaV3Data = { ignored: body.repeat(10) }

    const current = {
      ...previous,
      message: previous.message.map((message, index) => ({
        ...message,
        data: `${message.data}-changed-${index}`,
      })),
      localLore: [{ id: 'lore-new', key: 'new', content: body.repeat(10) }],
      hypaV3Data: { ignored: `${body}-changed` },
    } as unknown as Chat
    const messageSize = JSON.stringify(current.message).length

    const instrumented = withCloneInstrumentation(() => changedChatMetadata(previous, current))

    expect(instrumented.result).toEqual({})
    expect(instrumented.maxClonedSize).toBeLessThan(messageSize)
  })

  it('M9: changed object metadata is detached from the current chat record', () => {
    const previous = orderedChatMetadata({
      name: 'Same chat',
      bookmarks: ['msg-old'],
      bookmarkNames: { 'msg-old': 'Old bookmark' },
      modules: ['module-a'],
      suggestMessages: ['old suggestion'],
    })
    const bookmarks = ['msg-new']
    const bookmarkNames = { 'msg-new': 'New bookmark' }
    const modules = ['module-a', 'module-b']
    const suggestMessages = ['new suggestion']
    const current = orderedChatMetadata({
      name: 'Same chat',
      bookmarks,
      bookmarkNames,
      modules,
      suggestMessages,
    })

    const patch = changedChatMetadata(previous, current)

    expect(patch.bookmarks).toEqual(['msg-new'])
    expect(patch.bookmarkNames).toEqual({ 'msg-new': 'New bookmark' })
    expect(patch.modules).toEqual(['module-a', 'module-b'])
    expect(patch.suggestMessages).toEqual(['new suggestion'])
    expect(patch.bookmarks).not.toBe(bookmarks)
    expect(patch.bookmarkNames).not.toBe(bookmarkNames)
    expect(patch.modules).not.toBe(modules)
    expect(patch.suggestMessages).not.toBe(suggestMessages)

    bookmarks.push('msg-late')
    bookmarkNames['msg-new'] = 'Mutated later'
    modules.push('module-late')
    suggestMessages.push('late suggestion')

    expect(patch.bookmarks).toEqual(['msg-new'])
    expect(patch.bookmarkNames).toEqual({ 'msg-new': 'New bookmark' })
    expect(patch.modules).toEqual(['module-a', 'module-b'])
    expect(patch.suggestMessages).toEqual(['new suggestion'])
  })
})

describe('Phase 2 chat-scoped message dispatch', () => {
  it('dispatchReplaceMessagesScoped rolls back only the active chat on failure', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = init.headers as Record<string, string> | undefined
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/messages') {
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    // a sibling character to prove the scoped rollback never touches it
    DBState.db.characters.push({
      chaId: 'char-b',
      name: 'Other',
      chatPage: 0,
      chats: [
        { id: 'chat-c', name: 'C', message: [{ role: 'user', data: 'sib', chatId: 'm-sib' }] },
      ],
      chatFolders: [],
    } as any)

    const scoped = currentChatScopedSnapshot()
    expect(scoped.chatId).toBe('chat-a')

    // optimistic local edits: the active chat plus an unrelated sibling edit
    DBState.db.characters[0].chats[0].message.push({
      role: 'char',
      data: 'optimistic',
      chatId: 'm-opt',
    })
    DBState.db.characters[1].chats[0].note = 'sibling concurrent'

    dispatchReplaceMessagesScoped('chat-a', [{ role: 'user', data: 'x', chatId: 'm-x' }], scoped)
    await waitForCallCount(calls, 2)

    // only the active chat row is restored
    expect(DBState.db.characters[0].chats[0].message).toEqual([])
    // sibling character/chat untouched; the active character's other chat too
    expect(DBState.db.characters[0].chats[1].id).toBe('chat-b')
    expect(DBState.db.characters[1].chats[0].note).toBe('sibling concurrent')
  })
})

describe('Phase 2 scriptstate-scoped var dispatch', () => {
  it('dispatchPatchChatScriptstateScoped restores only the chat scriptstate on failure', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/scriptstate') {
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    const previous = currentChatScriptstateSnapshot(true)
    // optimistic scriptstate edit plus an unrelated concurrent message edit on
    // the same chat (a whole-chat restore would have wiped it)
    DBState.db.characters[0].chats[0].scriptstate!.$score = 'optimistic'
    DBState.db.characters[0].chats[0].message.push({ role: 'user', data: 'keep', chatId: 'm-keep' })

    dispatchPatchChatScriptstateScoped('chat-a', { $score: 'optimistic' }, [], previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].scriptstate).toEqual({ $score: '1', $old: 'gone' })
    expect(DBState.db.characters[0].chats[0].message).toHaveLength(1)
  })

  it('dispatchUpdateChatNoteScoped restores only the chat note on failure', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a') return jsonResponse({ error: 'nope' }, 500)
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    DBState.db.characters[0].chats[0].note = 'original note'

    const previous = currentChatScriptstateSnapshot(true)
    expect(previous.note).toBe('original note')

    DBState.db.characters[0].chats[0].note = 'optimistic note'
    DBState.db.characters[0].chats[0].scriptstate!.$score = 'keep'

    dispatchUpdateChatNoteScoped('chat-a', 'optimistic note', previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].note).toBe('original note')
    // the snapshot also restored scriptstate to its captured value
    expect(DBState.db.characters[0].chats[0].scriptstate).toEqual({ $score: '1', $old: 'gone' })
  })
})

describe('Phase 3 runner rejection rollback (L36)', () => {
  it('L36: a rejecting factory in runOptimisticCommandSequence rolls back instead of silently diverging', async () => {
    stubCommandFetch()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rollback = vi.fn()

    runOptimisticCommandSequence(
      [
        async () => {
          throw new Error('sequence factory exploded')
        },
      ],
      rollback,
    )

    await vi.waitFor(() => {
      expect(rollback).toHaveBeenCalledTimes(1)
    })
    consoleError.mockRestore()
  })

  it('L36: a mid-sequence rejection rolls back once and skips the remaining commands', async () => {
    stubCommandFetch()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rollback = vi.fn()
    const laterCommand = vi.fn(async () => ({ status: 'ok' }) as const)

    runOptimisticCommandSequence(
      [
        async () => {
          throw new Error('first factory exploded')
        },
        laterCommand as unknown as (baseRevision: number) => Promise<ServerCommandResult>,
      ],
      rollback,
    )

    await vi.waitFor(() => {
      expect(rollback).toHaveBeenCalledTimes(1)
    })
    expect(laterCommand).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('Phase 3 setCurrentChat scoped snapshot (U4)', () => {
  it('U4: replacing the active chat captures a chat-scoped baseline, never the whole characters array', async () => {
    DBState.db = seedCloneCostDb() as any // char-0 large (40 messages), siblings small
    selectedCharID.set(1)
    const charactersSize = JSON.stringify(DBState.db.characters).length
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ revision: 10 })) as unknown as typeof fetch,
    )

    const nextChat = JSON.parse(JSON.stringify(DBState.db.characters[1].chats[0]))
    nextChat.name = 'Renamed chat'

    // The scoped capture + the compatible-update diff stay bounded to the one
    // active chat; the large sibling (char-0) transcript is never serialized.
    const instrumented = withCloneInstrumentation(() => {
      setCurrentChat(nextChat as any)
    })
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(DBState.db.characters[1].chats[0].name).toBe('Renamed chat')

    // drain the async dispatch so it does not leak into the next test
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('U4: a failed update rolls back only the active chat row, preserving sibling edits', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        return jsonResponse({ error: 'nope' }, 500)
      }) as unknown as typeof fetch,
    )

    const nextChat = JSON.parse(JSON.stringify(DBState.db.characters[0].chats[0]))
    nextChat.name = 'Optimistic rename'

    setCurrentChat(nextChat as any)
    // a concurrent, unrelated edit to ANOTHER chat row a whole-array restore would wipe
    DBState.db.characters[0].chats[1].name = 'Concurrent sibling edit'

    await waitForCallCount(calls, 2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(DBState.db.characters[0].chats[0].name).toBe('Chat A')
    expect(DBState.db.characters[0].chats[1].name).toBe('Concurrent sibling edit')
  })
})
