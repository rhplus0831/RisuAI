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
} from './server/commands'
import {
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from './server/projectionWriteGuard.svelte'
import { DBState, selectedCharID } from './stores.svelte'
import {
  appendCurrentChatUserMessageForSend,
  currentChatScopedSnapshot,
  currentChatScriptstateSnapshot,
  currentChatStateSnapshot,
  dispatchCreateChat,
  dispatchCreateChatFolder,
  dispatchPatchChatScriptstate,
  dispatchReorderChatFoldersByIds,
  dispatchReorderChatsByIds,
  dispatchReplaceMessagesScoped,
  dispatchUpdateChat,
  restoreChatFolderRowMetadata,
  restoreChatRowMetadata,
  restoreChatScopedState,
  restoreChatScriptstate,
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
        return jsonResponse({
          revision: 13,
          event: { type: 'chat.updated', revision: 13, resource: 'chat' },
          selectedChatId: 'chat-a',
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

beforeEach(() => {
  clearCachedServerCommandRevision()
  setServerProjectionWriteGuardEnabled(false)
  selectedCharID.set(0)
  DBState.db = {
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

  it('rolls back optimistic Autopilot appends when the message command fails', async () => {
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
    setServerProjectionWriteGuardEnabled(true)

    const result = await appendCurrentChatUserMessageForSend('failed autopilot row')

    expect(result).toEqual({ status: 'error', error: 'nope' })
    await waitForCallCount(calls, 2)
    expect(DBState.db.characters[0].chats[0].message).toEqual([])
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
      chats: [{ id: 'chat-c', name: 'C', message: [{ role: 'user', data: 'sib', chatId: 'm-sib' }] }],
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
