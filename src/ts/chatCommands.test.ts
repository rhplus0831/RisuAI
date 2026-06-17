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
// mid-init.
import { setCurrentChat, type Chat, type Message } from './storage/database.svelte'
import { get } from 'svelte/store'
import {
  applyOptimisticCreatedChat,
  applyOptimisticDeletedChat,
  appendCurrentChatEmptyCharMessage,
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
  dispatchDeleteChatFolder,
  dispatchDeleteMessageScoped,
  dispatchPatchChatScriptstateScoped,
  dispatchReorderChatFoldersAndChatsByIds,
  dispatchReorderChatFoldersByIds,
  dispatchReorderChatsByIds,
  dispatchReplaceTailMessagesScoped,
  dispatchReplaceMessagesScoped,
  dispatchSaveChatGenerationSettings,
  dispatchSelectChat,
  dispatchTruncateMessagesScoped,
  dispatchUpdateChat,
  dispatchUpdateChatFolder,
  dispatchUpdateChatNoteScoped,
  dispatchUpdateMessageScoped,
  restoreChatFolderRowMetadata,
  restoreChatRowMetadata,
  restoreChatState,
  restoreChatScopedState,
  restoreChatScriptstate,
  restoreChatSelection,
  runOptimisticCommandSequence,
  sanitizeChatPatch,
  setChatNoteValue,
  setChatScriptstateValue,
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
      if (url === '/api/v1/commands/chats/chat-b/scriptstate') {
        return jsonResponse({
          revision: 16,
          event: {
            type: 'chat.scriptstate.updated',
            revision: 16,
            resource: 'chat',
            id: 'chat-b',
          },
          chatId: 'chat-b',
        })
      }
      if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
        return jsonResponse({
          revision: 19,
          event: {
            type: 'chat.updated',
            revision: 19,
            resource: 'characterRow',
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

function stubFailingCommandFetch(input: {
  matches: (url: string, init: RequestInit) => boolean
  onCommand?: (url: string, init: RequestInit) => void
}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(requestInput)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (input.matches(url, init)) {
        input.onCommand?.(url, init)
        return jsonResponse({ error: 'nope' }, 500)
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return calls
}

function stubCombinedReorderCommandFetch(input: {
  fail: 'folders' | 'chats'
  onFolderCommand?: (url: string, init: RequestInit) => void
  onChatCommand?: (url: string, init: RequestInit) => void
}): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(requestInput)
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url === '/api/v1/commands/characters/char-a/chat-folders/reorder' && init.method === 'POST') {
        input.onFolderCommand?.(url, init)
        if (input.fail === 'folders') return jsonResponse({ error: 'folder reorder failed' }, 500)
        return jsonResponse({
          revision: 11,
          event: { type: 'chatFolder.reordered', revision: 11, resource: 'chatFolder' },
          selectedChatId: 'chat-a',
        })
      }
      if (url === '/api/v1/commands/characters/char-a/chats/reorder' && init.method === 'POST') {
        input.onChatCommand?.(url, init)
        if (input.fail === 'chats') return jsonResponse({ error: 'chat reorder failed' }, 500)
        return jsonResponse({
          revision: 12,
          event: { type: 'chat.reordered', revision: 12, resource: 'chat' },
          selectedChatId: 'chat-a',
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

function seedReadyActiveChatGenerationSettings(): void {
  withTrustedServerProjectionWrite(() => {
    DBState.db.personas = [
      {
        id: 'persona-a',
        name: 'Persona A',
        personaPrompt: '',
        icon: '',
        note: '',
        largePortrait: false,
      },
    ] as any
    DBState.db.modelPresets = [{ id: 'model-preset-a', name: 'Model Preset A' }] as any
    DBState.db.promptPresets = [{ id: 'preset-a', name: 'Preset A' }] as any
    DBState.db.characters[0].chats[0].generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
  })
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

    expect(DBState.db.characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-c', 'chat-a', 'chat-b'])
    expect(DBState.db.characters[0].chatPage).toBe(0)

    restoreChatState(previous)
    expect(DBState.db.characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-a', 'chat-b'])
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
    expect(DBState.db.characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-a', 'chat-b'])
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

  it('preserves newer same-folder edits when a chat folder update rollback fails', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chat-folders/folder-a' && init.method === 'PATCH',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          const folder = DBState.db.characters[0].chatFolders[0]
          folder.name = 'Newer folder name'
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    withTrustedServerProjectionWrite(() => {
      const folder = DBState.db.characters[0].chatFolders[0]
      folder.name = 'Attempted folder name'
      folder.folded = true
    })

    dispatchUpdateChatFolder('folder-a', { name: 'Attempted folder name', folded: true }, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chatFolders[0]).toMatchObject({
        id: 'folder-a',
        name: 'Newer folder name',
        folded: false,
      })
    })
  })

  it('removes only an unchanged attempted folder after a failed create and keeps newer siblings', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chat-folders' && init.method === 'POST',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[0].chatFolders.push({
            id: 'folder-c',
            name: 'Newer sibling folder',
            folded: false,
          })
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedFolder = {
      id: 'folder-b',
      name: 'Attempted Folder',
      folded: false,
    }
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chatFolders.unshift(attemptedFolder)
    })

    dispatchCreateChatFolder('char-a', attemptedFolder, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-a', 'folder-c'])
    })
    expect(DBState.db.characters[0].chatFolders[1]).toMatchObject({
      id: 'folder-c',
      name: 'Newer sibling folder',
    })
  })

  it('restores only a missing deleted folder and still-null chat folder ids after a failed delete', async () => {
    DBState.db.characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
    ]
    DBState.db.characters[0].chats = [
      { id: 'chat-a', name: 'Chat A', folderId: null, message: [] },
      { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
      { id: 'chat-c', name: 'Chat C', folderId: 'folder-a', message: [] },
    ] as any
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chat-folders/folder-a' && init.method === 'DELETE',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[0].chats[0].name = 'Newer unrelated chat name'
          DBState.db.characters[0].chats[1].name = 'Newer affected chat name'
          DBState.db.characters[0].chats[2].name = 'Moved affected chat'
          DBState.db.characters[0].chats[2].folderId = 'folder-b'
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chatFolders.splice(0, 1)
      for (const chat of DBState.db.characters[0].chats) {
        if (chat.folderId === 'folder-a') chat.folderId = null
      }
    })

    dispatchDeleteChatFolder('folder-a', previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-a', 'folder-b'])
      expect(DBState.db.characters[0].chats[1].folderId).toBe('folder-a')
    })
    expect(DBState.db.characters[0].chats[0].name).toBe('Newer unrelated chat name')
    expect(DBState.db.characters[0].chats[1]).toMatchObject({
      name: 'Newer affected chat name',
      folderId: 'folder-a',
    })
    expect(DBState.db.characters[0].chats[2]).toMatchObject({
      name: 'Moved affected chat',
      folderId: 'folder-b',
    })
  })

  it('restores a failed chat folder reorder only when live order still equals the attempted order', async () => {
    DBState.db.characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
      { id: 'folder-c', name: 'Folder C', folded: false },
    ]
    const calls = stubFailingCommandFetch({
      matches: (url, init) =>
        url === '/api/v1/commands/characters/char-a/chat-folders/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          const folder = DBState.db.characters[0].chatFolders.find((candidate) => candidate.id === 'folder-c')
          if (folder) folder.name = 'Newer Folder C'
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['folder-c', 'folder-a', 'folder-b']
    withTrustedServerProjectionWrite(() => {
      const foldersById = new Map(DBState.db.characters[0].chatFolders.map((folder) => [folder.id, folder]))
      DBState.db.characters[0].chatFolders = attemptedIds.map((id) => foldersById.get(id)!)
    })

    dispatchReorderChatFoldersByIds('char-a', attemptedIds, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chatFolders.map((folder) => folder.id)).toEqual([
        'folder-a',
        'folder-b',
        'folder-c',
      ])
    })
    expect(DBState.db.characters[0].chatFolders[2].name).toBe('Newer Folder C')
  })

  it('skips failed chat folder reorder rollback after a newer reorder', async () => {
    DBState.db.characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
      { id: 'folder-c', name: 'Folder C', folded: false },
    ]
    const newerIds = ['folder-b', 'folder-c', 'folder-a']
    const calls = stubFailingCommandFetch({
      matches: (url, init) =>
        url === '/api/v1/commands/characters/char-a/chat-folders/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          const foldersById = new Map(DBState.db.characters[0].chatFolders.map((folder) => [folder.id, folder]))
          DBState.db.characters[0].chatFolders = newerIds.map((id) => foldersById.get(id)!)
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['folder-c', 'folder-a', 'folder-b']
    withTrustedServerProjectionWrite(() => {
      const foldersById = new Map(DBState.db.characters[0].chatFolders.map((folder) => [folder.id, folder]))
      DBState.db.characters[0].chatFolders = attemptedIds.map((id) => foldersById.get(id)!)
    })

    dispatchReorderChatFoldersByIds('char-a', attemptedIds, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chatFolders.map((folder) => folder.id)).toEqual(newerIds)
    })
  })

  it('keeps an accepted folder reorder when the combined chat reorder fails', async () => {
    DBState.db.characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
      { id: 'folder-c', name: 'Folder C', folded: false },
    ]
    DBState.db.characters[0].chats = [
      { id: 'chat-a', name: 'Chat A', folderId: null, message: [] },
      { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
      { id: 'chat-c', name: 'Chat C', folderId: 'folder-b', message: [] },
    ] as any
    const calls = stubCombinedReorderCommandFetch({
      fail: 'chats',
      onChatCommand: () => {
        withTrustedServerProjectionWrite(() => {
          const folder = DBState.db.characters[0].chatFolders.find((candidate) => candidate.id === 'folder-c')
          const chat = DBState.db.characters[0].chats.find((candidate) => candidate.id === 'chat-c')
          if (folder) folder.name = 'Newer Folder C'
          if (chat) chat.name = 'Newer Chat C'
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedFolderIds = ['folder-c', 'folder-a', 'folder-b']
    const attemptedChatIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': 'folder-c',
      'chat-b': null,
      'chat-c': 'folder-a',
    }
    withTrustedServerProjectionWrite(() => {
      const foldersById = new Map(DBState.db.characters[0].chatFolders.map((folder) => [folder.id, folder]))
      const chatsById = new Map(DBState.db.characters[0].chats.map((chat) => [chat.id, chat]))
      DBState.db.characters[0].chatFolders = attemptedFolderIds.map((id) => foldersById.get(id)!)
      DBState.db.characters[0].chats = attemptedChatIds.map((id) => chatsById.get(id)!)
      for (const chat of DBState.db.characters[0].chats) {
        chat.folderId = attemptedFolderByChatId[chat.id]
      }
      DBState.db.characters[0].chatPage = 1
    })

    dispatchReorderChatFoldersAndChatsByIds(
      'char-a',
      attemptedFolderIds,
      attemptedChatIds,
      attemptedFolderByChatId,
      previous,
      'chat-a',
    )

    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chatFolders.map((folder) => folder.id)).toEqual(attemptedFolderIds)
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(DBState.db.characters[0].chatFolders[0]).toMatchObject({
      id: 'folder-c',
      name: 'Newer Folder C',
    })
    expect(DBState.db.characters[0].chats.map((chat) => chat.folderId)).toEqual([null, 'folder-a', 'folder-b'])
    expect(DBState.db.characters[0].chats[2].name).toBe('Newer Chat C')
    expect(DBState.db.characters[0].chats[DBState.db.characters[0].chatPage].id).toBe('chat-a')
  })

  it('rolls back both attempted orders narrowly when the combined folder reorder fails first', async () => {
    DBState.db.characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
      { id: 'folder-c', name: 'Folder C', folded: false },
    ]
    DBState.db.characters[0].chats = [
      { id: 'chat-a', name: 'Chat A', folderId: null, message: [] },
      { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
      { id: 'chat-c', name: 'Chat C', folderId: 'folder-b', message: [] },
    ] as any
    const calls = stubCombinedReorderCommandFetch({
      fail: 'folders',
      onFolderCommand: () => {
        withTrustedServerProjectionWrite(() => {
          const folder = DBState.db.characters[0].chatFolders.find((candidate) => candidate.id === 'folder-c')
          const chat = DBState.db.characters[0].chats.find((candidate) => candidate.id === 'chat-c')
          if (folder) folder.name = 'Newer Folder C'
          if (chat) chat.name = 'Newer Chat C'
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedFolderIds = ['folder-c', 'folder-a', 'folder-b']
    const attemptedChatIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': 'folder-c',
      'chat-b': null,
      'chat-c': 'folder-a',
    }
    withTrustedServerProjectionWrite(() => {
      const foldersById = new Map(DBState.db.characters[0].chatFolders.map((folder) => [folder.id, folder]))
      const chatsById = new Map(DBState.db.characters[0].chats.map((chat) => [chat.id, chat]))
      DBState.db.characters[0].chatFolders = attemptedFolderIds.map((id) => foldersById.get(id)!)
      DBState.db.characters[0].chats = attemptedChatIds.map((id) => chatsById.get(id)!)
      for (const chat of DBState.db.characters[0].chats) {
        chat.folderId = attemptedFolderByChatId[chat.id]
      }
      DBState.db.characters[0].chatPage = 1
    })

    dispatchReorderChatFoldersAndChatsByIds(
      'char-a',
      attemptedFolderIds,
      attemptedChatIds,
      attemptedFolderByChatId,
      previous,
      'chat-a',
    )

    await waitForCallCount(calls, 2)
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/bootstrap',
      '/api/v1/commands/characters/char-a/chat-folders/reorder',
    ])
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chatFolders.map((folder) => folder.id)).toEqual([
        'folder-a',
        'folder-b',
        'folder-c',
      ])
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(DBState.db.characters[0].chatFolders[2]).toMatchObject({
      id: 'folder-c',
      name: 'Newer Folder C',
    })
    expect(DBState.db.characters[0].chats.map((chat) => chat.folderId)).toEqual([null, 'folder-a', 'folder-b'])
    expect(DBState.db.characters[0].chats[2].name).toBe('Newer Chat C')
    expect(DBState.db.characters[0].chats[DBState.db.characters[0].chatPage].id).toBe('chat-a')
  })

  it('keeps a pre-existing same-id chat after a failed create rollback', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST',
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedChat = jsonClone(DBState.db.characters[0].chats[1])

    expect(applyOptimisticCreatedChat('char-a', attemptedChat, previous)).toBe(true)
    expect(DBState.db.characters[0].chatPage).toBe(1)

    dispatchCreateChat('char-a', attemptedChat, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
    })
    expect(DBState.db.characters[0].chats[1]).toMatchObject({
      id: 'chat-b',
      name: 'Chat B',
    })
  })

  it('removes only an unchanged attempted chat after a failed create and keeps newer siblings', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[0].chats[2].name = 'Newer sibling name'
          DBState.db.characters[0].chats.push({
            id: 'chat-d',
            name: 'Newer appended chat',
            folderId: null,
            message: [],
          })
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedChat = {
      id: 'chat-c',
      name: 'Attempted Chat',
      note: '',
      folderId: null,
      message: [],
      localLore: [],
      fmIndex: -1,
    } as Chat
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats.unshift(attemptedChat)
      DBState.db.characters[0].chatPage = 0
    })

    dispatchCreateChat('char-a', attemptedChat, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-d'])
    })
    expect(DBState.db.characters[0].chats[1].name).toBe('Newer sibling name')
    expect(DBState.db.characters[0].chats[2].name).toBe('Newer appended chat')
    expect(DBState.db.characters[0].chatPage).toBe(0)
  })

  it('skips failed create rollback when the attempted chat has a newer same-row edit', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[0].chats[0].name = 'Newer attempted chat name'
          DBState.db.characters[0].chats[2].name = 'Newer sibling name'
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedChat = {
      id: 'chat-c',
      name: 'Attempted Chat',
      note: '',
      folderId: null,
      message: [],
      localLore: [],
      fmIndex: -1,
    } as Chat
    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats.unshift(attemptedChat)
      DBState.db.characters[0].chatPage = 0
    })

    dispatchCreateChat('char-a', attemptedChat, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-c', 'chat-a', 'chat-b'])
    })
    expect(DBState.db.characters[0].chats[0].name).toBe('Newer attempted chat name')
    expect(DBState.db.characters[0].chats[2].name).toBe('Newer sibling name')
    expect(DBState.db.characters[0].chatPage).toBe(0)
  })

  it('reinserts only a still-missing deleted chat after a failed delete and preserves sibling edits', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'DELETE',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[0].chats[0].name = 'Newer sibling name'
          DBState.db.characters[0].chats.push({
            id: 'chat-c',
            name: 'Newer appended chat',
            folderId: null,
            message: [],
          })
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toEqual({
      applied: true,
      selectedChatId: 'chat-b',
    })

    dispatchDeleteChat('chat-a', previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(DBState.db.characters[0].chats[1].name).toBe('Newer sibling name')
    expect(DBState.db.characters[0].chats[2].name).toBe('Newer appended chat')
    expect(DBState.db.characters[0].chatPage).toBe(0)
  })

  it('preserves newer user selection instead of restoring old selection after a failed delete', async () => {
    DBState.db.characters[0].chats.push({
      id: 'chat-c',
      name: 'Chat C',
      folderId: null,
      message: [],
    } as Chat)
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'DELETE',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          DBState.db.characters[0].chatPage = 1
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toEqual({
      applied: true,
      selectedChatId: 'chat-b',
    })

    dispatchDeleteChat('chat-a', previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(DBState.db.characters[0].chats[DBState.db.characters[0].chatPage].id).toBe('chat-c')
  })

  it('restores failed chat reorder order and folder assignments only when live state still equals the attempt', async () => {
    DBState.db.characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
    ]
    DBState.db.characters[0].chats = [
      { id: 'chat-a', name: 'Chat A', folderId: null, message: [] },
      { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
      { id: 'chat-c', name: 'Chat C', folderId: 'folder-b', message: [] },
    ] as any
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          const chat = DBState.db.characters[0].chats.find((candidate) => candidate.id === 'chat-c')
          if (chat) chat.name = 'Newer Chat C'
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': null,
      'chat-b': null,
      'chat-c': 'folder-a',
    }
    withTrustedServerProjectionWrite(() => {
      const chatsById = new Map(DBState.db.characters[0].chats.map((chat) => [chat.id, chat]))
      DBState.db.characters[0].chats = attemptedIds.map((id) => chatsById.get(id)!)
      for (const chat of DBState.db.characters[0].chats) {
        chat.folderId = attemptedFolderByChatId[chat.id]
      }
      DBState.db.characters[0].chatPage = 1
    })

    dispatchReorderChatsByIds('char-a', attemptedIds, attemptedFolderByChatId, previous, 'chat-a')

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(DBState.db.characters[0].chats.map((chat) => chat.folderId)).toEqual([null, 'folder-a', 'folder-b'])
    expect(DBState.db.characters[0].chats[2].name).toBe('Newer Chat C')
    expect(DBState.db.characters[0].chats[DBState.db.characters[0].chatPage].id).toBe('chat-a')
  })

  it('skips failed chat reorder rollback after a newer reorder', async () => {
    DBState.db.characters[0].chats.push({
      id: 'chat-c',
      name: 'Chat C',
      folderId: null,
      message: [],
    } as Chat)
    const newerIds = ['chat-b', 'chat-c', 'chat-a']
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          const chatsById = new Map(DBState.db.characters[0].chats.map((chat) => [chat.id, chat]))
          DBState.db.characters[0].chats = newerIds.map((id) => chatsById.get(id)!)
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': null,
      'chat-b': 'folder-a',
      'chat-c': null,
    }
    withTrustedServerProjectionWrite(() => {
      const chatsById = new Map(DBState.db.characters[0].chats.map((chat) => [chat.id, chat]))
      DBState.db.characters[0].chats = attemptedIds.map((id) => chatsById.get(id)!)
    })

    dispatchReorderChatsByIds('char-a', attemptedIds, attemptedFolderByChatId, previous, 'chat-a')

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(newerIds)
    })
  })

  it('skips failed chat reorder rollback after a newer folder move', async () => {
    DBState.db.characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
    ]
    DBState.db.characters[0].chats.push({
      id: 'chat-c',
      name: 'Chat C',
      folderId: null,
      message: [],
    } as Chat)
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedServerProjectionWrite(() => {
          const chat = DBState.db.characters[0].chats.find((candidate) => candidate.id === 'chat-c')
          if (chat) chat.folderId = 'folder-b'
        })
      },
    })
    setServerProjectionWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': null,
      'chat-b': 'folder-a',
      'chat-c': null,
    }
    withTrustedServerProjectionWrite(() => {
      const chatsById = new Map(DBState.db.characters[0].chats.map((chat) => [chat.id, chat]))
      DBState.db.characters[0].chats = attemptedIds.map((id) => chatsById.get(id)!)
    })

    dispatchReorderChatsByIds('char-a', attemptedIds, attemptedFolderByChatId, previous, 'chat-a')

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats.map((chat) => chat.id)).toEqual(attemptedIds)
    })
    expect(DBState.db.characters[0].chats[0]).toMatchObject({
      id: 'chat-c',
      folderId: 'folder-b',
    })
  })

  it('saves chat generation settings through the dedicated command helper', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)
    const generationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: '0',
        notes: '',
      },
    }

    expect(dispatchSaveChatGenerationSettings('chat-a', generationSettings)).toBe(true)
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(generationSettings)

    await waitForCallCount(calls, 2)
    expect(calls).toEqual([
      {
        url: '/api/v1/bootstrap',
        method: 'GET',
        authHeader: 'chat-command-token',
        body: null,
      },
      {
        url: '/api/v1/commands/chats/chat-a/generation-settings',
        method: 'PUT',
        authHeader: 'chat-command-token',
        body: {
          baseRevision: 10,
          generationSettings,
        },
      },
    ])
  })

  it('rolls back a failed generation settings save without touching sibling rows', async () => {
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
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerProjectionWriteGuardEnabled(true)

    const nextGenerationSettings = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mode: '1',
      },
    }

    expect(DBState.db.characters[0].chats[0]).not.toHaveProperty('generationSettings')
    expect(dispatchSaveChatGenerationSettings('chat-a', nextGenerationSettings)).toBe(true)
    expect(DBState.db.characters[0].chats[0].generationSettings).toEqual(nextGenerationSettings)

    withTrustedServerProjectionWrite(() => {
      DBState.db.characters[0].chats[0].message.push({
        role: 'char',
        data: 'concurrent same-chat message',
        chatId: 'msg-concurrent',
      })
      DBState.db.characters[0].chats[1].name = 'Concurrent sibling edit'
    })

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats[0]).not.toHaveProperty('generationSettings')
    })
    expect(DBState.db.characters[0].chats[0].message).toEqual([
      {
        role: 'char',
        data: 'concurrent same-chat message',
        chatId: 'msg-concurrent',
      },
    ])
    expect(DBState.db.characters[0].chats[1].name).toBe('Concurrent sibling edit')
  })

  it('sets DevTool-style scriptstate values through the chat scriptstate command helper', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.characters[0].chats[0].scriptstate!.$score = 'direct'
    }).toThrow()

    expect(setChatScriptstateValue('chat-a', '$score', '9')).toBe(true)
    expect(DBState.db.characters[0].chats[0].scriptstate).toMatchObject({ $score: '9' })

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

  it('creates scriptstate when setting a value on a chat without one', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    expect(DBState.db.characters[0].chats[1]).not.toHaveProperty('scriptstate')

    expect(setChatScriptstateValue('chat-b', '$enabled', true)).toBe(true)

    expect(DBState.db.characters[0].chats[1].scriptstate).toEqual({ $enabled: true })
    await waitForCallCount(calls, 2)
    expect(calls[1]).toEqual({
      url: '/api/v1/commands/chats/chat-b/scriptstate',
      method: 'PATCH',
      authHeader: 'chat-command-token',
      body: {
        baseRevision: 10,
        patch: { $enabled: true },
        deleteKeys: [],
      },
    })
  })

  it('rejects missing or invalid DevTool-style scriptstate targets without mutating or dispatching', () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)
    const before = jsonClone(DBState.db.characters[0].chats[0].scriptstate)

    expect(setChatScriptstateValue(undefined, '$score', '2')).toBe(false)
    expect(setChatScriptstateValue('', '$score', '2')).toBe(false)
    expect(setChatScriptstateValue('missing-chat', '$score', '2')).toBe(false)
    expect(setChatScriptstateValue('chat-a', '', '2')).toBe(false)
    expect(setChatScriptstateValue('chat-a', '$object', { nested: true })).toBe(false)
    expect(setChatScriptstateValue('chat-a', '$nan', Number.NaN)).toBe(false)

    expect(DBState.db.characters[0].chats[0].scriptstate).toEqual(before)
    expect(calls).toEqual([])
  })

  it('appends DevTool Autopilot user messages through an awaited message command', async () => {
    const calls = stubCommandFetch()
    seedReadyActiveChatGenerationSettings()
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

  it('blocks direct send appends when active-chat generation settings are incomplete', async () => {
    const calls = stubCommandFetch()
    setServerProjectionWriteGuardEnabled(true)

    const result = await appendCurrentChatUserMessageForSend('autopilot row')

    expect(result).toEqual({
      status: 'error',
      error:
        'Chat generation settings are incomplete. Missing: Generation settings, Configuration confirmation, Persona, Model preset, Prompt preset, Jailbreak toggle.',
    })
    expect(calls).toEqual([])
    expect(DBState.db.characters[0].chats[0].message).toEqual([])
  })

  it('appends prepared plain-send user messages through one-message POST bodies', async () => {
    const calls = stubCommandFetch()
    seedReadyActiveChatGenerationSettings()
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

  it('rolls back helper scriptstate edits without touching concurrent message edits', async () => {
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
          withTrustedServerProjectionWrite(() => {
            DBState.db.characters[0].chats[0].message.push({
              role: 'char',
              data: 'concurrent same-chat message',
              chatId: 'msg-concurrent',
            })
            DBState.db.characters[0].chats[1].name = 'Concurrent sibling edit'
          })
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerProjectionWriteGuardEnabled(true)

    expect(setChatScriptstateValue('chat-a', '$score', 'failed')).toBe(true)
    expect(DBState.db.characters[0].chats[0].scriptstate).toEqual({ $score: 'failed', $old: 'gone' })

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(DBState.db.characters[0].chats[0].scriptstate).toEqual({ $score: '1', $old: 'gone' })
    })
    expect(DBState.db.characters[0].chats[0].message).toEqual([
      {
        role: 'char',
        data: 'concurrent same-chat message',
        chatId: 'msg-concurrent',
      },
    ])
    expect(DBState.db.characters[0].chats[1].name).toBe('Concurrent sibling edit')
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
    seedReadyActiveChatGenerationSettings()
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
    seedReadyActiveChatGenerationSettings()
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

// Chat selection rollback restores only `chatPage`, not the full character collection.
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

  it('dispatchUpdateChat sends chat rename patches through the chat update command', async () => {
    const calls = stubCommandFetch()
    const previous = currentChatStateSnapshot()

    dispatchUpdateChat('chat-a', { name: 'Renamed Chat A' }, previous)
    await waitForCallCount(calls, 2)

    expect(calls[1]).toEqual({
      url: '/api/v1/commands/chats/chat-a',
      method: 'PATCH',
      authHeader: 'chat-command-token',
      body: {
        baseRevision: 10,
        patch: { name: 'Renamed Chat A' },
        select: false,
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

  it('does not restore attempted chat metadata after a newer same-row edit', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)
    const snapshot = {
      selectedCharID: 0,
      characterId: 'char-0',
      chatId: 'chat-0',
      metadata: scalarMetadata(0),
      attempted: { name: 'Optimistic Name' },
    }

    DBState.db.characters[0].chats[0].name = 'Newer local name'
    restoreChatRowMetadata(snapshot)

    expect(DBState.db.characters[0].chats[0].name).toBe('Newer local name')
  })

  it('drops attempted metadata missing from the baseline without clobbering newer fields', () => {
    DBState.db = seedCloneCostDb() as any
    selectedCharID.set(0)
    const snapshot = {
      selectedCharID: 0,
      characterId: 'char-0',
      chatId: 'chat-0',
      metadata: scalarMetadata(0),
      attempted: { name: 'Optimistic Name', bindedPersona: 'persona-x' },
    }
    expect(snapshot.metadata).not.toHaveProperty('bindedPersona')

    DBState.db.characters[0].chats[0].name = 'Newer local name'
    DBState.db.characters[0].chats[0].bindedPersona = 'persona-x'
    restoreChatRowMetadata(snapshot)

    expect(DBState.db.characters[0].chats[0].name).toBe('Newer local name')
    expect(DBState.db.characters[0].chats[0].bindedPersona).toBeUndefined()
  })

  it('restores only the one folder row by stable id', () => {
    DBState.db = seedCloneCostDb() as any
    DBState.db.characters[0].chatFolders = [{ id: 'folder-0', name: 'Folder Zero', color: '#111', folded: false }]
    DBState.db.characters[1].chatFolders = [{ id: 'folder-1', name: 'Folder One', color: '#222', folded: false }]
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
  it('keeps generationSettings out of generic chat metadata patching', () => {
    const previous = orderedChatMetadata({
      name: 'Same chat',
    })
    const current = orderedChatMetadata({
      name: 'Same chat',
    })
    previous.generationSettings = {
      configured: true,
      personaId: 'persona-old',
      modelPresetId: 'model-preset-old',
      promptPresetId: 'preset-old',
      jailbreakToggle: false,
    }
    current.generationSettings = {
      configured: true,
      personaId: 'persona-new',
      modelPresetId: 'model-preset-new',
      promptPresetId: 'preset-new',
      jailbreakToggle: true,
      sidebarToggles: { mode: '1' },
    }

    expect(CHAT_PATCH_ALLOWED_KEYS.has('generationSettings')).toBe(false)
    expect(sanitizeChatPatch(current as unknown as ChatSnapshot)).not.toHaveProperty('generationSettings')
    expect(changedChatMetadata(previous, current)).toEqual({})
  })

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
    current.localLore = [{ id: 'ignored-lore-new', key: 'y', content: 'ignored changed lore' }] as any
    ;(current as any).hypaV3Data = { ignored: 'changed memory payload' }

    const patch = changedChatMetadata(previous, current)
    const legacyPatch = legacyChangedChatMetadata(previous, current)

    expect(Object.keys(patch)).toEqual(Object.keys(legacyPatch))
    expect(JSON.stringify(patch)).toBe(JSON.stringify(legacyPatch))
    expect(JSON.stringify(sanitizeChatPatch(patch))).toBe(JSON.stringify(sanitizeChatPatch(legacyPatch)))
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
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages' && init.method === 'PUT',
    })
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

    const attemptedMessages: Message[] = [
      {
        role: 'user',
        data: 'x',
        chatId: 'm-x',
      },
    ]
    // optimistic local edits: the active message array plus unrelated same-row
    // and sibling edits a whole-chat restore would wipe.
    DBState.db.characters[0].chats[0].message = jsonClone(attemptedMessages)
    DBState.db.characters[0].chats[0].note = 'same chat concurrent note'
    DBState.db.characters[0].chats[0].localLore = [
      {
        id: 'lore-live',
        key: 'live',
        content: 'keep me',
      },
    ] as any
    DBState.db.characters[0].chats[0].scriptstate = {
      $score: 'newer',
    }
    DBState.db.characters[0].chats[1].message.push({
      role: 'char',
      data: 'same character sibling',
      chatId: 'm-sibling',
    })
    DBState.db.characters[1].chats[0].note = 'sibling concurrent'

    dispatchReplaceMessagesScoped('chat-a', attemptedMessages, scoped)
    await waitForCallCount(calls, 2)

    // only the active chat's message array is restored
    expect(DBState.db.characters[0].chats[0].message).toEqual([])
    expect(DBState.db.characters[0].chats[0].note).toBe('same chat concurrent note')
    expect(DBState.db.characters[0].chats[0].localLore).toEqual([
      {
        id: 'lore-live',
        key: 'live',
        content: 'keep me',
      },
    ])
    expect(DBState.db.characters[0].chats[0].scriptstate).toEqual({ $score: 'newer' })
    expect(DBState.db.characters[0].chats[1].message).toEqual([
      {
        role: 'char',
        data: 'same character sibling',
        chatId: 'm-sibling',
      },
    ])
    expect(DBState.db.characters[1].chats[0].note).toBe('sibling concurrent')
  })
})

describe('Phase 4 chat-scoped message attempt rollback', () => {
  function seedActiveMessages(messages: Message[]): void {
    DBState.db.characters[0].chats[0].message = jsonClone(messages)
  }

  it('failed empty char append replace-all rolls back a newly appended no-id message', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages' && init.method === 'PUT',
    })
    const previousMessages: Message[] = [{ role: 'user', data: 'before', chatId: 'm-1' }]
    seedActiveMessages(previousMessages)

    appendCurrentChatEmptyCharMessage()
    await waitForCallCount(calls, 2)

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/messages',
      method: 'PUT',
      body: {
        baseRevision: 10,
        messages: [
          { role: 'user', data: 'before', chatId: 'm-1' },
          { role: 'char', data: '', chatId: expect.any(String) },
        ],
      },
    })
    expect(DBState.db.characters[0].chats[0].message).toEqual(previousMessages)
  })

  it('failed scoped message update restores attempted fields and preserves newer same-chat metadata', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/messages/m-1' && init.method === 'PATCH',
    })
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message[0].data = 'attempted'
    DBState.db.characters[0].chats[0].name = 'newer metadata'

    dispatchUpdateMessageScoped('m-1', { data: 'attempted' }, previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual([{ role: 'char', data: 'before', chatId: 'm-1' }])
    expect(DBState.db.characters[0].chats[0].name).toBe('newer metadata')
  })

  it('failed scoped message update skips rollback when the message changed again after the attempt', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/messages/m-1' && init.method === 'PATCH',
      onCommand: () => {
        DBState.db.characters[0].chats[0].message[0].data = 'newer edit'
      },
    })
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message[0].data = 'attempted'

    dispatchUpdateMessageScoped('m-1', { data: 'attempted' }, previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual([{ role: 'char', data: 'newer edit', chatId: 'm-1' }])
  })

  it('failed scoped delete restores the prior message list only when live messages equal the attempted deletion', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/messages/m-1' && init.method === 'DELETE',
    })
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
    ]
    seedActiveMessages(previousMessages)
    const previous = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message = [jsonClone(previousMessages[1])]

    dispatchDeleteMessageScoped('m-1', previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual(previousMessages)
  })

  it('failed scoped delete preserves a newer live message list when it changes again before rollback', async () => {
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
    ]
    const newerMessages: Message[] = [
      { role: 'char', data: 'two', chatId: 'm-2' },
      { role: 'user', data: 'newer after delete', chatId: 'm-newer' },
    ]
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/messages/m-1' && init.method === 'DELETE',
      onCommand: () => {
        DBState.db.characters[0].chats[0].message = jsonClone(newerMessages)
      },
    })
    seedActiveMessages(previousMessages)
    const previous = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message = [jsonClone(previousMessages[1])]

    dispatchDeleteMessageScoped('m-1', previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual(newerMessages)
  })

  it('failed scoped truncate restores the prior message list when live messages equal the attempted truncation', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages/truncate' && init.method === 'POST',
    })
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
      { role: 'user', data: 'three', chatId: 'm-3' },
    ]
    seedActiveMessages(previousMessages)
    const previous = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message = [jsonClone(previousMessages[0])]

    await dispatchTruncateMessagesScoped('chat-a', 'm-1', previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual(previousMessages)
  })

  it('failed scoped truncate skips rollback when live messages diverge from the attempted truncation', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages/truncate' && init.method === 'POST',
    })
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
      { role: 'user', data: 'three', chatId: 'm-3' },
    ]
    seedActiveMessages(previousMessages)
    const previous = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message = [
      jsonClone(previousMessages[0]),
      { role: 'char', data: 'newer after truncate', chatId: 'm-newer' },
    ]

    await dispatchTruncateMessagesScoped('chat-a', 'm-1', previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'newer after truncate', chatId: 'm-newer' },
    ])
  })

  it('failed scoped replace-tail restores messages while preserving newer same-chat metadata', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages/tail' && init.method === 'POST',
    })
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
      { role: 'user', data: 'three', chatId: 'm-3' },
    ]
    const replacementTail: Message[] = [{ role: 'char', data: 'replacement', chatId: 'm-r' }]
    seedActiveMessages(previousMessages)
    const previous = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message = [jsonClone(previousMessages[0]), jsonClone(replacementTail[0])]
    DBState.db.characters[0].chats[0].name = 'newer metadata'

    dispatchReplaceTailMessagesScoped('chat-a', 'm-1', replacementTail, previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual(previousMessages)
    expect(DBState.db.characters[0].chats[0].name).toBe('newer metadata')
  })

  it('failed scoped replace-tail preserves newer live messages and same-chat metadata after divergence', async () => {
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
      { role: 'user', data: 'three', chatId: 'm-3' },
    ]
    const replacementTail: Message[] = [{ role: 'char', data: 'replacement', chatId: 'm-r' }]
    const newerMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'replacement', chatId: 'm-r' },
      { role: 'user', data: 'newer after replace-tail', chatId: 'm-newer' },
    ]
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages/tail' && init.method === 'POST',
      onCommand: () => {
        DBState.db.characters[0].chats[0].message = jsonClone(newerMessages)
        DBState.db.characters[0].chats[0].name = 'newer metadata'
      },
    })
    seedActiveMessages(previousMessages)
    const previous = currentChatScopedSnapshot()

    DBState.db.characters[0].chats[0].message = [jsonClone(previousMessages[0]), jsonClone(replacementTail[0])]

    dispatchReplaceTailMessagesScoped('chat-a', 'm-1', replacementTail, previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual(newerMessages)
    expect(DBState.db.characters[0].chats[0].name).toBe('newer metadata')
  })

  it('failed scoped replace-all skips rollback when live messages diverge from the attempted replacement', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages' && init.method === 'PUT',
    })
    seedActiveMessages([{ role: 'user', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()
    const replacementMessages: Message[] = [{ role: 'char', data: 'replacement', chatId: 'm-r' }]

    DBState.db.characters[0].chats[0].message = [
      jsonClone(replacementMessages[0]),
      { role: 'user', data: 'newer follow-up', chatId: 'm-newer' },
    ]
    DBState.db.characters[0].chats[0].name = 'newer metadata'

    dispatchReplaceMessagesScoped('chat-a', replacementMessages, previous)
    await waitForCallCount(calls, 2)

    expect(DBState.db.characters[0].chats[0].message).toEqual([
      { role: 'char', data: 'replacement', chatId: 'm-r' },
      { role: 'user', data: 'newer follow-up', chatId: 'm-newer' },
    ])
    expect(DBState.db.characters[0].chats[0].name).toBe('newer metadata')
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

  it('setChatNoteValue applies the author note under the projection guard and rolls back on failure', async () => {
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
    delete (DBState.db.characters[0].chats[0] as { note?: string }).note
    setServerProjectionWriteGuardEnabled(true)

    expect(() => {
      DBState.db.characters[0].chats[0].note = 'direct note'
    }).toThrow()

    expect(setChatNoteValue('chat-a', 'draft note')).toBe(true)
    expect(DBState.db.characters[0].chats[0].note).toBe('draft note')

    await waitForCallCount(calls, 2)

    expect(calls[1]).toEqual({
      url: '/api/v1/commands/chats/chat-a',
      method: 'PATCH',
      authHeader: null,
      body: {
        baseRevision: 10,
        patch: { note: 'draft note' },
        select: false,
      },
    })
    expect(DBState.db.characters[0].chats[0].note).toBe('')
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
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ revision: 10 })) as unknown as typeof fetch)

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
