import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

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
  clearAppliedServerResourceRevision,
  clearCachedServerCommandRevision,
  setAppliedServerResourceRevision,
  setCachedServerCommandRevision,
  setServerCommandSuccessReconciler,
  type ChatFolderSnapshot,
  type ChatSnapshot,
  type ServerCommandResult,
} from './server/commands'
import { SERVER_UNLOADED_CHAT_MESSAGE_MARKER } from './server/chatMessagePlaceholders'
import { createDestructiveRefreshToken } from './server/staleStateGuards'
import { setResourceWriteGuardEnabled, withTrustedResourceWrite } from './server/resourceWriteGuard.svelte'
import { setChatVar } from './parser/chatVar.svelte'
import { selectedCharID } from './stores.svelte'
import {
  applyCharacterResource,
  applyCharactersResource,
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
} from './server/resourceState.svelte'
// Import the heavy database module AFTER stores.svelte: importing it first
// triggers a circular-import TDZ when the reactive moduleUpdate $effect runs
// mid-init.
import {
  mergeServerResourceCharacterRow,
  setCurrentChat,
  type Chat,
  type ChatFolder,
  type Message,
} from './storage/database.svelte'
import { get } from 'svelte/store'
import { flushSync } from 'svelte'
import {
  applyOptimisticCreatedChat,
  applyOptimisticCreatedChatFolder,
  applyOptimisticDeletedChat,
  applyChatNoteValueLocally,
  appendCurrentChatEmptyCharMessage,
  appendCurrentChatUserMessageForSend,
  changedChatMetadata,
  captureActiveChatTarget,
  CHAT_PATCH_ALLOWED_KEYS,
  currentChatScopedSnapshot,
  currentChatScriptstateSnapshot,
  currentChatSelectionSnapshot,
  currentChatStateSnapshot,
  dispatchAppendMessage,
  dispatchCharacterOwnedDurableBatch,
  dispatchCreateChat,
  dispatchCreateChatWithOutcome,
  dispatchCreateChatForImport,
  dispatchCreateImportedChats,
  dispatchCreateChatFolder,
  dispatchCompatibleChatUpdateScoped,
  dispatchDeleteChat,
  dispatchDeleteChatFolder,
  dispatchDeleteMessageScoped,
  dispatchForkChat,
  dispatchPatchChatScriptstateScoped,
  dispatchReorderChatFoldersAndChatsByIds,
  dispatchReorderChatFoldersAndChatsByIdsWithOutcome,
  dispatchReorderChatFoldersByIds,
  dispatchReorderChatsByIds,
  dispatchReplaceTailMessagesScoped,
  dispatchReplaceMessagesScoped,
  dispatchSaveChatGenerationSettings,
  dispatchSaveChatGenerationSettingsWithOutcome,
  dispatchSelectChat,
  dispatchStagedChatNoteMutation,
  dispatchTruncateMessagesScoped,
  dispatchUpdateChat,
  dispatchUpdateChatAsync,
  dispatchUpdateChatWithOutcome,
  dispatchUpdateChatFolder,
  dispatchUpdateChatFolderWithOutcome,
  dispatchUpdateChatFolderRow,
  dispatchUpdateChatNoteScoped,
  dispatchUpdateChatRow,
  dispatchUpdateChatScoped,
  dispatchUpdateChatScopedWithOutcome,
  dispatchUpdateMessageScoped,
  isActiveChatTargetFresh,
  prepareCompatibleChatUpdateScoped,
  restoreChatFolderRowMetadata,
  restoreChatRowMetadata,
  restoreChatState,
  restoreChatScopedState,
  restoreChatScriptstate,
  restoreChatSelection,
  runOptimisticCommandSequence,
  runOptimisticCommandSequenceAsync,
  sanitizeChatPatch,
  setChatNoteValue,
  setChatScriptstateValue,
  setCurrentChatSelectedDraftHookId,
  stageChatNoteMutation,
  waitForPendingChatGenerationSettingsSave,
} from './chatCommands'
import {
  assertRollbackRestoresOnly,
  assertSnapshotIsScalar,
  assertSnapshotOmitsCollections,
  seedCloneCostDb,
  withCloneInstrumentation,
} from './__tests__/cloneCostHarness'
import {
  beginPendingMutationDispatch,
  clearPendingMutationOutbox,
  listPendingMutations,
  MAX_DURABLE_MUTATION_PAYLOAD_BYTES,
  pendingMutationIntentPayloadByteLength,
  pendingMutationModuleEnabledProjectionTarget,
  preparePendingMutationOutbox,
  resetPendingMutationOutboxForTests,
  stagePendingMutation,
} from './server/pendingMutationOutbox'
import { replayPendingMutations } from './server/pendingMutationReplay'
import { dispatchDurableMutation } from './server/durableMutationDispatch'
import { registerPendingBridgePatchFlusher } from './server/pendingBridgeFlushRegistry'
import { syncServerBackedChatMetadataBaselines, watchServerBackedChatMetadata } from './server/chatBridge.svelte'
import { PERSONA_SELECTION_MUTATION_KEY } from './server/personaMutationKeys'
import { reapplyRetainedChatBodyProjections } from './server/chatRetainedProjection'

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

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
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
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
        return jsonResponse({
          revision: 19,
          event: {
            type: 'chat.updated',
            revision: 19,
            resource: 'characterRow',
            id: 'chat-a',
            parentId: 'char-a',
          },
          chatId: 'chat-a',
          characterId: 'char-a',
          certificate: 'chat-generation-settings-sparse-v1',
          patchedKeys: Object.keys(body.patch ?? {}).sort(),
          deletedKeys: [...(body.deleteKeys ?? [])].sort(),
          sidebarTogglePatchedKeys: Object.keys(body.patch?.sidebarToggles ?? {}).sort(),
          sidebarToggleDeletedKeys: [...(body.sidebarToggleDeleteKeys ?? [])].sort(),
          prunedSidebarToggleKeys: [],
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

function stubControlledChatGenerationSettingsFetch(): {
  calls: CapturedFetch[]
  firstResponse: Deferred<Response>
  secondResponse: Deferred<Response>
} {
  const calls: CapturedFetch[] = []
  const firstResponse = createDeferred<Response>()
  const secondResponse = createDeferred<Response>()
  let generationSettingsCallCount = 0
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
      if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
        generationSettingsCallCount += 1
        if (generationSettingsCallCount === 1) return firstResponse.promise
        if (generationSettingsCallCount === 2) return secondResponse.promise
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return { calls, firstResponse, secondResponse }
}

function stubControlledMessagePatchFetch(): {
  calls: CapturedFetch[]
  firstResponse: Deferred<Response>
  secondResponse: Deferred<Response>
} {
  const calls: CapturedFetch[] = []
  const firstResponse = createDeferred<Response>()
  const secondResponse = createDeferred<Response>()
  let messagePatchCallCount = 0
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
      if (url === '/api/v1/commands/messages/m-1' && init.method === 'PATCH') {
        messagePatchCallCount += 1
        if (messagePatchCallCount === 1) return firstResponse.promise
        if (messagePatchCallCount === 2) return secondResponse.promise
      }
      return jsonResponse({ error: `unexpected ${url}` }, 404)
    }) as unknown as typeof fetch,
  )
  return { calls, firstResponse, secondResponse }
}

function successfulMessagePatchResponse(revision: number): Response {
  return jsonResponse({
    revision,
    event: {
      type: 'message.updated',
      revision,
      resource: 'message',
      id: 'm-1',
      parentId: 'chat-a',
    },
    chatId: 'chat-a',
    messageId: 'm-1',
  })
}

function successfulChatGenerationSettingsResponse(
  revision: number,
  generationSettings: Record<string, unknown>,
): Response {
  return jsonResponse({
    revision,
    event: {
      type: 'chat.updated',
      revision,
      resource: 'characterRow',
      id: 'chat-a',
      parentId: 'char-a',
    },
    chatId: 'chat-a',
    characterId: 'char-a',
    generationSettings,
  })
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

function stubMessagePersistenceFetch(): CapturedFetch[] {
  const calls: CapturedFetch[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = init.headers as Record<string, string> | undefined
      const url = String(requestInput)
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      calls.push({
        url,
        method: init.method ?? 'GET',
        authHeader: headers?.['risu-auth'] ?? null,
        body,
      })

      if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
      if (url === '/api/v1/commands/chats/chat-a/messages' && init.method === 'POST') {
        return jsonResponse({
          revision: 11,
          event: {
            type: 'message.appended',
            revision: 11,
            resource: 'message',
            id: body?.message?.chatId,
            parentId: 'chat-a',
          },
          chatId: 'chat-a',
          messageId: body?.message?.chatId,
        })
      }
      if (url === '/api/v1/commands/chats/chat-a/messages/tail' && init.method === 'POST') {
        return jsonResponse({
          revision: 11,
          event: {
            type: 'messages.tailReplaced',
            revision: 11,
            resource: 'message',
            parentId: 'chat-a',
          },
          chatId: 'chat-a',
          afterMessageId: body?.afterMessageId ?? null,
          messageIds: Array.isArray(body?.messages) ? body.messages.map((message: Message) => message.chatId) : [],
          replacedCount: Array.isArray(body?.messages) ? body.messages.length : 0,
        })
      }
      if (url === '/api/v1/commands/chats/chat-a/messages/truncate' && init.method === 'POST') {
        return jsonResponse({
          revision: 11,
          event: {
            type: 'message.truncated',
            revision: 11,
            resource: 'message',
            parentId: 'chat-a',
          },
          chatId: 'chat-a',
          afterMessageId: body?.afterMessageId ?? null,
          removedCount: 1,
        })
      }
      if (url.startsWith('/api/v1/commands/messages/') && init.method === 'PATCH') {
        const messageId = decodeURIComponent(url.split('/').at(-1) ?? '')
        return jsonResponse({
          revision: 11,
          event: {
            type: 'message.updated',
            revision: 11,
            resource: 'message',
            id: messageId,
            parentId: 'chat-a',
          },
          chatId: 'chat-a',
          messageId,
        })
      }
      if (url.startsWith('/api/v1/commands/messages/') && init.method === 'DELETE') {
        const messageId = decodeURIComponent(url.split('/').at(-1) ?? '')
        return jsonResponse({
          revision: 11,
          event: {
            type: 'message.deleted',
            revision: 11,
            resource: 'message',
            id: messageId,
            parentId: 'chat-a',
          },
          chatId: 'chat-a',
          messageId,
        })
      }
      if (url === '/api/v1/commands/chats/chat-a/messages' && init.method === 'PUT') {
        return jsonResponse({
          revision: 11,
          event: { type: 'messages.replaced', revision: 11, resource: 'message', parentId: 'chat-a' },
          chatId: 'chat-a',
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

function serverMessagePlaceholder(): Message {
  return {
    role: 'char',
    data: '',
    isComment: true,
    disabled: true,
    [SERVER_UNLOADED_CHAT_MESSAGE_MARKER]: true,
  } as Message
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
  withTrustedResourceWrite(() => {
    getDatabase().personas = [
      {
        id: 'persona-a',
        name: 'Persona A',
        personaPrompt: '',
        icon: '',
        note: '',
        largePortrait: false,
      },
    ] as any
    getDatabase().modelPresets = [{ id: 'model-preset-a', name: 'Model Preset A' }] as any
    getDatabase().promptPresets = [{ id: 'preset-a', name: 'Preset A' }] as any
    getDatabase().characters[0].chats[0].generationSettings = {
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
  clearAppliedServerResourceRevision()
  clearCachedServerCommandRevision()
  setResourceWriteGuardEnabled(false)
  selectedCharID.set(0)
  setDatabaseLite({
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
  } as any)
})

afterEach(() => {
  clearAppliedServerResourceRevision()
  setServerCommandSuccessReconciler(null)
  setResourceWriteGuardEnabled(false)
  vi.unstubAllGlobals()
})

describe('chat command projection helpers', () => {
  it('patches the selected draft hook through the chat-scoped command path', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(setCurrentChatSelectedDraftHookId('draft-hook-a')).toBe(true)
    expect(getDatabase().characters[0].chats[0].selectedDraftHookId).toBe('draft-hook-a')

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: { selectedDraftHookId: 'draft-hook-a' },
        select: false,
      },
    })
  })

  it('clears the selected draft hook with a nullable chat patch', async () => {
    setCurrentChatSelectedDraftHookId('draft-hook-a', { dispatch: false })
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(setCurrentChatSelectedDraftHookId(null)).toBe(true)
    expect(getDatabase().characters[0].chats[0]).not.toHaveProperty('selectedDraftHookId')

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: { selectedDraftHookId: null },
        select: false,
      },
    })
  })

  it('optimistically inserts and selects a command-created chat under the resource guard', () => {
    setResourceWriteGuardEnabled(true)
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

    expect(getDatabase().characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-c', 'chat-a', 'chat-b'])
    expect(getDatabase().characters[0].chatPage).toBe(0)

    restoreChatState(previous)
    expect(getDatabase().characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-a', 'chat-b'])
  })

  it('optimistically inserts a command-created chat folder under the resource guard', () => {
    setResourceWriteGuardEnabled(true)
    const previous = currentChatStateSnapshot()
    const folder = {
      id: 'folder-b',
      name: 'Folder B',
      folded: false,
    }

    expect(applyOptimisticCreatedChatFolder('char-a', folder, previous)).toBe(true)

    expect(getDatabase().characters[0].chatFolders.map((candidate) => candidate.id)).toEqual(['folder-b', 'folder-a'])

    restoreChatState(previous)
    expect(getDatabase().characters[0].chatFolders.map((candidate) => candidate.id)).toEqual(['folder-a'])
  })

  it('optimistically removes a command-deleted chat under the resource guard', () => {
    setResourceWriteGuardEnabled(true)
    const previous = currentChatStateSnapshot()

    expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toEqual({
      applied: true,
      selectedChatId: 'chat-b',
    })

    expect(getDatabase().characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-b'])
    expect(getDatabase().characters[0].chatPage).toBe(0)

    restoreChatState(previous)
    expect(getDatabase().characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-a', 'chat-b'])
  })

  it('keeps the active chat selected when an earlier inactive chat is deleted', () => {
    getDatabase().characters[0].chats.push({ id: 'chat-c', name: 'Chat C', message: [] } as Chat)
    getDatabase().characters[0].chatPage = 1
    const previous = currentChatStateSnapshot()
    setResourceWriteGuardEnabled(true)

    expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toEqual({
      applied: true,
      selectedChatId: 'chat-b',
    })

    expect(getDatabase().characters[0].chats.map((candidate) => candidate.id)).toEqual(['chat-b', 'chat-c'])
    expect(getDatabase().characters[0].chatPage).toBe(0)
  })

  it('routes SideChatList chat and folder flows through commands under the resource guard', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().characters[0].chats.unshift({ id: 'direct', name: 'Direct', message: [] } as any)
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
      getDatabase().characters[0].chatFolders.push({ id: 'direct-folder', name: 'Direct' } as any)
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

  it('serializes the attempted create-folder snapshot even if the caller mutates the live folder', async () => {
    const calls = stubCommandFetch()
    const previous = currentChatStateSnapshot()
    const createFolder: ChatFolder = {
      id: 'folder-b',
      name: 'Folder B',
      color: 'blue',
      folded: false,
    }

    dispatchCreateChatFolder('char-a', createFolder, previous)
    createFolder.name = 'Mutated Folder'
    createFolder.color = 'red'
    createFolder.folded = true

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/characters/char-a/chat-folders',
      method: 'POST',
      body: {
        baseRevision: expect.any(Number),
        folder: {
          id: 'folder-b',
          name: 'Folder B',
          color: 'blue',
          folded: false,
        },
      },
    })
  })

  it('preserves newer same-folder edits when a chat folder update rollback fails', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chat-folders/folder-a' && init.method === 'PATCH',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const folder = getDatabase().characters[0].chatFolders[0]
          folder.name = 'Newer folder name'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    withTrustedResourceWrite(() => {
      const folder = getDatabase().characters[0].chatFolders[0]
      folder.name = 'Attempted folder name'
      folder.folded = true
    })

    dispatchUpdateChatFolder('folder-a', { name: 'Attempted folder name', folded: true }, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatFolders[0]).toMatchObject({
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
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chatFolders.push({
            id: 'folder-c',
            name: 'Newer sibling folder',
            folded: false,
          })
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedFolder = {
      id: 'folder-b',
      name: 'Attempted Folder',
      folded: false,
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders.unshift(attemptedFolder)
    })

    dispatchCreateChatFolder('char-a', attemptedFolder, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-a', 'folder-c'])
    })
    expect(getDatabase().characters[0].chatFolders[1]).toMatchObject({
      id: 'folder-c',
      name: 'Newer sibling folder',
    })
  })

  it('keeps a failed attempted folder when newer chats were moved into it', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chat-folders' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[0].folderId = 'folder-b'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedFolder = {
      id: 'folder-b',
      name: 'Attempted Folder',
      folded: false,
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders.unshift(attemptedFolder)
    })

    dispatchCreateChatFolder('char-a', attemptedFolder, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-b', 'folder-a'])
      expect(getDatabase().characters[0].chats[0].folderId).toBe('folder-b')
    })
  })

  it('rolls back an optimistic folder delete while preserving newer chat changes', async () => {
    getDatabase().characters[0].chatFolders = [
      { id: 'folder-a', name: 'Latest optimistic folder child edit', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
    ]
    getDatabase().characters[0].chats = [
      { id: 'chat-a', name: 'Chat A', folderId: null, message: [] },
      { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
      { id: 'chat-c', name: 'Chat C', folderId: 'folder-a', message: [] },
    ] as any
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chat-folders/folder-a' && init.method === 'DELETE',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[0].name = 'Newer unrelated chat name'
          getDatabase().characters[0].chats[1].name = 'Newer affected chat name'
          getDatabase().characters[0].chats[2].name = 'Moved affected chat'
          getDatabase().characters[0].chats[2].folderId = 'folder-b'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    dispatchDeleteChatFolder('folder-a', previous)

    expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-b'])
    expect(getDatabase().characters[0].chats.map((chat) => chat.folderId)).toEqual([null, null, null])

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-a', 'folder-b'])
      expect(getDatabase().characters[0].chats[1].folderId).toBe('folder-a')
    })
    expect(getDatabase().characters[0].chats[0].name).toBe('Newer unrelated chat name')
    expect(getDatabase().characters[0].chats[1]).toMatchObject({
      name: 'Newer affected chat name',
      folderId: 'folder-a',
    })
    expect(getDatabase().characters[0].chatFolders[0].name).toBe('Latest optimistic folder child edit')
    expect(getDatabase().characters[0].chats[2]).toMatchObject({
      name: 'Moved affected chat',
      folderId: 'folder-b',
    })
  })

  it('does not corrupt chat or folder rows for duplicate reorder ids', async () => {
    getDatabase().characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
    ]
    const calls = stubFailingCommandFetch({
      matches: (url, init) =>
        (url === '/api/v1/commands/characters/char-a/chats/reorder' ||
          url === '/api/v1/commands/characters/char-a/chat-folders/reorder') &&
        init.method === 'POST',
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    dispatchReorderChatsByIds('char-a', ['chat-a', 'chat-a'], {}, previous)
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])

    dispatchReorderChatFoldersByIds('char-a', ['folder-a', 'folder-a'], previous)
    await waitForCallCount(calls, 3)

    expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-a', 'folder-b'])
  })

  it('keeps an unchanged omitted folder assignment omitted during optimistic reorder', async () => {
    withTrustedResourceWrite(() => {
      const omittedFolderChat = { ...getDatabase().characters[0].chats[0] }
      delete omittedFolderChat.folderId
      getDatabase().characters[0].chats[0] = omittedFolderChat
    })
    expect(Object.prototype.hasOwnProperty.call(getDatabase().characters[0].chats[0], 'folderId')).toBe(false)
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats/reorder' && init.method === 'POST',
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    dispatchReorderChatsByIds(
      'char-a',
      ['chat-b', 'chat-a'],
      { 'chat-a': null, 'chat-b': 'folder-a' },
      previous,
      'chat-a',
    )

    const attemptedChat = getDatabase().characters[0].chats.find((chat) => chat.id === 'chat-a')
    expect(Object.prototype.hasOwnProperty.call(attemptedChat, 'folderId')).toBe(false)

    await waitForCallCount(calls, 2)
    const restoredChat = getDatabase().characters[0].chats.find((chat) => chat.id === 'chat-a')
    expect(Object.prototype.hasOwnProperty.call(restoredChat, 'folderId')).toBe(false)
  })

  it('restores a failed chat folder reorder only when live order still equals the attempted order', async () => {
    getDatabase().characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
      { id: 'folder-c', name: 'Folder C', folded: false },
    ]
    const calls = stubFailingCommandFetch({
      matches: (url, init) =>
        url === '/api/v1/commands/characters/char-a/chat-folders/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const folder = getDatabase().characters[0].chatFolders.find((candidate) => candidate.id === 'folder-c')
          if (folder) folder.name = 'Newer Folder C'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['folder-c', 'folder-a', 'folder-b']
    withTrustedResourceWrite(() => {
      const foldersById = new Map(getDatabase().characters[0].chatFolders.map((folder) => [folder.id, folder]))
      getDatabase().characters[0].chatFolders = attemptedIds.map((id) => foldersById.get(id)!)
    })

    dispatchReorderChatFoldersByIds('char-a', attemptedIds, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual([
        'folder-a',
        'folder-b',
        'folder-c',
      ])
    })
    expect(getDatabase().characters[0].chatFolders[2].name).toBe('Newer Folder C')
  })

  it('skips failed chat folder reorder rollback after a newer reorder', async () => {
    getDatabase().characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
      { id: 'folder-c', name: 'Folder C', folded: false },
    ]
    const newerIds = ['folder-b', 'folder-c', 'folder-a']
    const calls = stubFailingCommandFetch({
      matches: (url, init) =>
        url === '/api/v1/commands/characters/char-a/chat-folders/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const foldersById = new Map(getDatabase().characters[0].chatFolders.map((folder) => [folder.id, folder]))
          getDatabase().characters[0].chatFolders = newerIds.map((id) => foldersById.get(id)!)
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['folder-c', 'folder-a', 'folder-b']
    withTrustedResourceWrite(() => {
      const foldersById = new Map(getDatabase().characters[0].chatFolders.map((folder) => [folder.id, folder]))
      getDatabase().characters[0].chatFolders = attemptedIds.map((id) => foldersById.get(id)!)
    })

    dispatchReorderChatFoldersByIds('char-a', attemptedIds, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(newerIds)
    })
  })

  it('keeps an accepted folder reorder when the combined chat reorder fails', async () => {
    getDatabase().characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
      { id: 'folder-c', name: 'Folder C', folded: false },
    ]
    getDatabase().characters[0].chats = [
      { id: 'chat-a', name: 'Chat A', folderId: null, message: [] },
      { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
      { id: 'chat-c', name: 'Chat C', folderId: 'folder-b', message: [] },
    ] as any
    const calls = stubCombinedReorderCommandFetch({
      fail: 'chats',
      onChatCommand: () => {
        withTrustedResourceWrite(() => {
          const folder = getDatabase().characters[0].chatFolders.find((candidate) => candidate.id === 'folder-c')
          const chat = getDatabase().characters[0].chats.find((candidate) => candidate.id === 'chat-c')
          if (folder) folder.name = 'Newer Folder C'
          if (chat) chat.name = 'Newer Chat C'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedFolderIds = ['folder-c', 'folder-a', 'folder-b']
    const attemptedChatIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': 'folder-c',
      'chat-b': null,
      'chat-c': 'folder-a',
    }
    withTrustedResourceWrite(() => {
      const foldersById = new Map(getDatabase().characters[0].chatFolders.map((folder) => [folder.id, folder]))
      const chatsById = new Map(getDatabase().characters[0].chats.map((chat) => [chat.id, chat]))
      getDatabase().characters[0].chatFolders = attemptedFolderIds.map((id) => foldersById.get(id)!)
      getDatabase().characters[0].chats = attemptedChatIds.map((id) => chatsById.get(id)!)
      for (const chat of getDatabase().characters[0].chats) {
        chat.folderId = attemptedFolderByChatId[chat.id]
      }
      getDatabase().characters[0].chatPage = 1
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
      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(attemptedFolderIds)
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(getDatabase().characters[0].chatFolders[0]).toMatchObject({
      id: 'folder-c',
      name: 'Newer Folder C',
    })
    expect(getDatabase().characters[0].chats.map((chat) => chat.folderId)).toEqual([null, 'folder-a', 'folder-b'])
    expect(getDatabase().characters[0].chats[2].name).toBe('Newer Chat C')
    expect(getDatabase().characters[0].chats[getDatabase().characters[0].chatPage].id).toBe('chat-a')
  })

  it('sends only changed folder assignments in a combined folder and chat reorder', async () => {
    const calls = stubCombinedReorderCommandFetch({ fail: 'chats' })
    const previous = currentChatStateSnapshot()

    dispatchReorderChatFoldersAndChatsByIds(
      'char-a',
      ['folder-a'],
      ['chat-b', 'chat-a'],
      {
        'chat-a': 'folder-a',
        'chat-b': 'folder-a',
      },
      previous,
      'chat-a',
    )

    await waitForCallCount(calls, 3)
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/characters/char-a/chats/reorder',
      method: 'POST',
      body: {
        baseRevision: 11,
        chatIds: ['chat-b', 'chat-a'],
        folderByChatId: { 'chat-a': 'folder-a' },
        selectedChatId: 'chat-a',
      },
    })
  })

  it('rolls back both attempted orders narrowly when the combined folder reorder fails first', async () => {
    getDatabase().characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
      { id: 'folder-c', name: 'Folder C', folded: false },
    ]
    getDatabase().characters[0].chats = [
      { id: 'chat-a', name: 'Chat A', folderId: null, message: [] },
      { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
      { id: 'chat-c', name: 'Chat C', folderId: 'folder-b', message: [] },
    ] as any
    const calls = stubCombinedReorderCommandFetch({
      fail: 'folders',
      onFolderCommand: () => {
        withTrustedResourceWrite(() => {
          const folder = getDatabase().characters[0].chatFolders.find((candidate) => candidate.id === 'folder-c')
          const chat = getDatabase().characters[0].chats.find((candidate) => candidate.id === 'chat-c')
          if (folder) folder.name = 'Newer Folder C'
          if (chat) chat.name = 'Newer Chat C'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedFolderIds = ['folder-c', 'folder-a', 'folder-b']
    const attemptedChatIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': 'folder-c',
      'chat-b': null,
      'chat-c': 'folder-a',
    }
    withTrustedResourceWrite(() => {
      const foldersById = new Map(getDatabase().characters[0].chatFolders.map((folder) => [folder.id, folder]))
      const chatsById = new Map(getDatabase().characters[0].chats.map((chat) => [chat.id, chat]))
      getDatabase().characters[0].chatFolders = attemptedFolderIds.map((id) => foldersById.get(id)!)
      getDatabase().characters[0].chats = attemptedChatIds.map((id) => chatsById.get(id)!)
      for (const chat of getDatabase().characters[0].chats) {
        chat.folderId = attemptedFolderByChatId[chat.id]
      }
      getDatabase().characters[0].chatPage = 1
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
      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual([
        'folder-a',
        'folder-b',
        'folder-c',
      ])
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(getDatabase().characters[0].chatFolders[2]).toMatchObject({
      id: 'folder-c',
      name: 'Newer Folder C',
    })
    expect(getDatabase().characters[0].chats.map((chat) => chat.folderId)).toEqual([null, 'folder-a', 'folder-b'])
    expect(getDatabase().characters[0].chats[2].name).toBe('Newer Chat C')
    expect(getDatabase().characters[0].chats[getDatabase().characters[0].chatPage].id).toBe('chat-a')
  })

  it('keeps a pre-existing same-id chat after a failed create rollback', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST',
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedChat = jsonClone(getDatabase().characters[0].chats[1])

    expect(applyOptimisticCreatedChat('char-a', attemptedChat, previous)).toBe(true)
    expect(getDatabase().characters[0].chatPage).toBe(1)

    dispatchCreateChat('char-a', attemptedChat, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
    })
    expect(getDatabase().characters[0].chats[1]).toMatchObject({
      id: 'chat-b',
      name: 'Chat B',
    })
  })

  it('removes only an unchanged attempted chat after a failed create and keeps newer siblings', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[2].name = 'Newer sibling name'
          getDatabase().characters[0].chats.push({
            id: 'chat-d',
            name: 'Newer appended chat',
            folderId: null,
            message: [],
            note: '',
            localLore: [],
          })
        })
      },
    })
    setResourceWriteGuardEnabled(true)

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
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(attemptedChat)
      getDatabase().characters[0].chatPage = 0
    })

    dispatchCreateChat('char-a', attemptedChat, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-d'])
    })
    expect(getDatabase().characters[0].chats[1].name).toBe('Newer sibling name')
    expect(getDatabase().characters[0].chats[2].name).toBe('Newer appended chat')
    expect(getDatabase().characters[0].chatPage).toBe(0)
  })

  it('removes a failed created-chat ghost even after a dependent row edit', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[0].name = 'Newer attempted chat name'
          getDatabase().characters[0].chats[2].name = 'Newer sibling name'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

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
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(attemptedChat)
      getDatabase().characters[0].chatPage = 0
    })

    dispatchCreateChat('char-a', attemptedChat, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
    })
    expect(getDatabase().characters[0].chats[1].name).toBe('Newer sibling name')
    expect(getDatabase().characters[0].chatPage).toBe(0)
  })

  it('keeps an authoritative targeted row when a create response fails after the row arrives', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const authoritativeCharacter = jsonClone(getDatabase().characters[0])
          const createdChat = authoritativeCharacter.chats.find((chat) => chat.id === 'chat-c')
          if (createdChat) createdChat.name = 'Canonical created chat'
          applyCharacterResource({ revision: 11, character: authoritativeCharacter })
        })
      },
    })
    setResourceWriteGuardEnabled(true)

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
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(attemptedChat)
      getDatabase().characters[0].chatPage = 0
    })

    dispatchCreateChat('char-a', attemptedChat, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-c', 'chat-a', 'chat-b'])
    })
    expect(getDatabase().characters[0].chats[0].name).toBe('Canonical created chat')
    expect(getDatabase().characters[0].chatPage).toBe(0)
  })

  it('rolls back an optimistic fork while preserving a newer sibling chat edit', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/fork' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const attemptedFork = getDatabase().characters[0].chats.find((chat) => chat.id === 'chat-c')
          const sibling = getDatabase().characters[0].chats.find((chat) => chat.id === 'chat-b')
          if (attemptedFork) attemptedFork.name = 'Newer dependent fork edit'
          if (sibling) sibling.name = 'Newer sibling name'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const forkedChat = {
      id: 'chat-c',
      name: 'Chat A Copy',
      folderId: null,
      message: [],
    } as Chat

    dispatchForkChat('chat-a', previous, { chat: forkedChat })

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
    })
    expect(getDatabase().characters[0].chats[1]).toMatchObject({
      id: 'chat-b',
      name: 'Newer sibling name',
    })
  })

  it('failed branch fork removes unchanged forked chat, restores source folder, and removes created folder', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/fork' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[2].name = 'Newer sibling name'
          getDatabase().characters[0].chatFolders[1].name = 'Newer folder name'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const branchFolder = {
      id: 'folder-branch',
      name: 'Branches of Chat A',
      folded: false,
    }
    const forkedChat = {
      id: 'chat-branch',
      name: 'Chat A Branch',
      folderId: branchFolder.id,
      message: [],
    } as Chat
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders.unshift(branchFolder)
      getDatabase().characters[0].chats[0].folderId = branchFolder.id
      getDatabase().characters[0].chats.unshift(forkedChat)
      getDatabase().characters[0].chatPage = 0
    })

    dispatchForkChat('chat-a', previous, {
      chat: forkedChat,
      sourcePatch: { folderId: branchFolder.id },
      folder: branchFolder,
    })

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-a'])
    })
    expect(getDatabase().characters[0].chats[0]).toMatchObject({
      id: 'chat-a',
      folderId: null,
    })
    expect(getDatabase().characters[0].chats[1]).toMatchObject({
      id: 'chat-b',
      name: 'Newer sibling name',
    })
    expect(getDatabase().characters[0].chatFolders[0]).toMatchObject({
      id: 'folder-a',
      name: 'Newer folder name',
    })
    expect(getDatabase().characters[0].chats[getDatabase().characters[0].chatPage].id).toBe('chat-a')
  })

  it('removes a failed fork ghost even after a dependent row edit', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/fork' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[0].name = 'Newer forked chat name'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const forkedChat = {
      id: 'chat-branch',
      name: 'Chat A Branch',
      folderId: null,
      message: [],
    } as Chat
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(forkedChat)
      getDatabase().characters[0].chatPage = 0
    })

    dispatchForkChat('chat-a', previous, { chat: forkedChat })

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
    })
    expect(getDatabase().characters[0].chats[getDatabase().characters[0].chatPage].id).toBe('chat-a')
  })

  it('reinserts only a still-missing deleted chat after a failed delete and preserves sibling edits', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'DELETE',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[0].name = 'Newer sibling name'
          getDatabase().characters[0].chats.push({
            id: 'chat-c',
            name: 'Newer appended chat',
            folderId: null,
            message: [],
            note: '',
            localLore: [],
          })
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    expect(applyChatNoteValueLocally('chat-a', 'latest optimistic note')).toMatchObject({ note: '' })
    const previous = currentChatStateSnapshot()
    expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toEqual({
      applied: true,
      selectedChatId: 'chat-b',
    })

    dispatchDeleteChat('chat-a', previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(getDatabase().characters[0].chats[0].note).toBe('latest optimistic note')
    expect(getDatabase().characters[0].chats[1].name).toBe('Newer sibling name')
    expect(getDatabase().characters[0].chats[2].name).toBe('Newer appended chat')
    expect(getDatabase().characters[0].chatPage).toBe(0)
  })

  it('preserves newer user selection instead of restoring old selection after a failed delete', async () => {
    getDatabase().characters[0].chats.push({
      id: 'chat-c',
      name: 'Chat C',
      folderId: null,
      message: [],
    } as Chat)
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'DELETE',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chatPage = 1
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toEqual({
      applied: true,
      selectedChatId: 'chat-b',
    })

    dispatchDeleteChat('chat-a', previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(getDatabase().characters[0].chats[getDatabase().characters[0].chatPage].id).toBe('chat-c')
  })

  it('restores failed chat reorder order and folder assignments only when live state still equals the attempt', async () => {
    getDatabase().characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
    ]
    getDatabase().characters[0].chats = [
      { id: 'chat-a', name: 'Chat A', folderId: null, message: [] },
      { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
      { id: 'chat-c', name: 'Chat C', folderId: 'folder-b', message: [] },
    ] as any
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const chat = getDatabase().characters[0].chats.find((candidate) => candidate.id === 'chat-c')
          if (chat) chat.name = 'Newer Chat C'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': null,
      'chat-b': null,
      'chat-c': 'folder-a',
    }
    withTrustedResourceWrite(() => {
      const chatsById = new Map(getDatabase().characters[0].chats.map((chat) => [chat.id, chat]))
      getDatabase().characters[0].chats = attemptedIds.map((id) => chatsById.get(id)!)
      for (const chat of getDatabase().characters[0].chats) {
        chat.folderId = attemptedFolderByChatId[chat.id]
      }
      getDatabase().characters[0].chatPage = 1
    })

    dispatchReorderChatsByIds('char-a', attemptedIds, attemptedFolderByChatId, previous, 'chat-a')

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/characters/char-a/chats/reorder',
      method: 'POST',
      body: {
        chatIds: attemptedIds,
        folderByChatId: {
          'chat-b': null,
          'chat-c': 'folder-a',
        },
        selectedChatId: 'chat-a',
      },
    })
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b', 'chat-c'])
    })
    expect(getDatabase().characters[0].chats.map((chat) => chat.folderId)).toEqual([null, 'folder-a', 'folder-b'])
    expect(getDatabase().characters[0].chats[2].name).toBe('Newer Chat C')
    expect(getDatabase().characters[0].chats[getDatabase().characters[0].chatPage].id).toBe('chat-a')
  })

  it('skips failed chat reorder rollback after a newer reorder', async () => {
    getDatabase().characters[0].chats.push({
      id: 'chat-c',
      name: 'Chat C',
      folderId: null,
      message: [],
    } as Chat)
    const newerIds = ['chat-b', 'chat-c', 'chat-a']
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const chatsById = new Map(getDatabase().characters[0].chats.map((chat) => [chat.id, chat]))
          getDatabase().characters[0].chats = newerIds.map((id) => chatsById.get(id)!)
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': null,
      'chat-b': 'folder-a',
      'chat-c': null,
    }
    withTrustedResourceWrite(() => {
      const chatsById = new Map(getDatabase().characters[0].chats.map((chat) => [chat.id, chat]))
      getDatabase().characters[0].chats = attemptedIds.map((id) => chatsById.get(id)!)
    })

    dispatchReorderChatsByIds('char-a', attemptedIds, attemptedFolderByChatId, previous, 'chat-a')

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(newerIds)
    })
  })

  it('skips failed chat reorder rollback after a newer folder move', async () => {
    getDatabase().characters[0].chatFolders = [
      { id: 'folder-a', name: 'Folder A', folded: false },
      { id: 'folder-b', name: 'Folder B', folded: false },
    ]
    getDatabase().characters[0].chats.push({
      id: 'chat-c',
      name: 'Chat C',
      folderId: null,
      message: [],
    } as Chat)
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats/reorder' && init.method === 'POST',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const chat = getDatabase().characters[0].chats.find((candidate) => candidate.id === 'chat-c')
          if (chat) chat.folderId = 'folder-b'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedIds = ['chat-c', 'chat-a', 'chat-b']
    const attemptedFolderByChatId = {
      'chat-a': null,
      'chat-b': 'folder-a',
      'chat-c': null,
    }
    withTrustedResourceWrite(() => {
      const chatsById = new Map(getDatabase().characters[0].chats.map((chat) => [chat.id, chat]))
      getDatabase().characters[0].chats = attemptedIds.map((id) => chatsById.get(id)!)
    })

    dispatchReorderChatsByIds('char-a', attemptedIds, attemptedFolderByChatId, previous, 'chat-a')

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(attemptedIds)
    })
    expect(getDatabase().characters[0].chats[0]).toMatchObject({
      id: 'chat-c',
      folderId: 'folder-b',
    })
  })

  it('saves chat generation settings through the dedicated command helper', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)
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

    const operation = dispatchSaveChatGenerationSettingsWithOutcome('chat-a', generationSettings)
    expect(operation).not.toBeNull()
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettings)

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
          baseGenerationSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          patch: generationSettings,
        },
      },
    ])
    await expect(operation!.settlement).resolves.toEqual({ status: 'accepted' })
  })

  it('reserves a generation-settings save before a synchronously dispatched structural command', async () => {
    setResourceWriteGuardEnabled(true)
    const settingsResponse = createDeferred<Response>()
    const commandUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        commandUrls.push(url)
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') return settingsResponse.promise
        if (url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH') {
          return jsonResponse({
            revision: 12,
            event: {
              type: 'chat.updated',
              revision: 12,
              resource: 'characterRow',
              id: 'chat-a',
              parentId: 'char-a',
            },
            chatId: 'chat-a',
            characterId: 'char-a',
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    const generationSettings = {
      configured: true,
      personaId: 'persona-a',
      jailbreakToggle: false,
      sidebarToggles: { notes: 'queued first' },
    }

    expect(dispatchSaveChatGenerationSettings('chat-a', generationSettings)).toBe(true)
    dispatchUpdateChat('chat-a', { name: 'Later rename' }, currentChatStateSnapshot())

    await vi.waitFor(() => expect(commandUrls).toEqual(['/api/v1/commands/chats/chat-a/generation-settings']))
    settingsResponse.resolve(successfulChatGenerationSettingsResponse(11, generationSettings))
    await vi.waitFor(() =>
      expect(commandUrls).toEqual([
        '/api/v1/commands/chats/chat-a/generation-settings',
        '/api/v1/commands/chats/chat-a',
      ]),
    )
    await waitForPendingChatGenerationSettingsSave('chat-a')
  })

  it('persists the exact live chat generation-settings request before sending it', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-generation',
      writerEpoch: 7,
      databaseLineage: 'lineage-chat-generation',
      requestedWriterWasActive: true,
    })
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-a',
      jailbreakToggle: false,
      sidebarToggles: { notes: 'before' },
    }
    const attempted = {
      ...initial,
      sidebarToggles: { notes: 'durable' },
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })
    const response = createDeferred<Response>()
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
        calls.push({ url, body, headers: init.headers as Record<string, string> })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') return response.promise
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      expect(dispatchSaveChatGenerationSettings('chat-a', attempted)).toBe(true)
      await vi.waitFor(() =>
        expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/generation-settings')).toBe(true),
      )
      const command = calls.find((call) => call.url === '/api/v1/commands/chats/chat-a/generation-settings')!
      const { baseRevision: _baseRevision, ...durableBody } = command.body
      expect((await listPendingMutations()).map((entry) => entry.intent)).toEqual([
        {
          version: 1,
          dependencyKeys: ['persona:selection', 'settings:bridge', 'persona-profile:persona-a'],
          requests: [
            {
              method: 'PUT',
              path: '/chats/chat-a/generation-settings',
              body: durableBody,
            },
          ],
        },
      ])
      expect(command.headers['risu-mutation-id']).toMatch(/^[a-zA-Z0-9._:-]+$/)
      expect(command.headers['risu-database-lineage']).toBe('lineage-chat-generation')

      const patch = command.body.patch as Record<string, unknown>
      response.resolve(
        jsonResponse({
          revision: 11,
          event: {
            type: 'chat.updated',
            revision: 11,
            resource: 'characterRow',
            id: 'chat-a',
            parentId: 'char-a',
          },
          chatId: 'chat-a',
          characterId: 'char-a',
          certificate: 'chat-generation-settings-sparse-v1',
          patchedKeys: Object.keys(patch).sort(),
          deletedKeys: [],
          sidebarTogglePatchedKeys: Object.keys((patch.sidebarToggles as Record<string, unknown>) ?? {}).sort(),
          sidebarToggleDeletedKeys: [],
          prunedSidebarToggleKeys: [],
        }),
      )
      await waitForPendingChatGenerationSettingsSave('chat-a')
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('persists a queued generation-settings edit while the earlier save is still in flight', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-generation-queue',
      writerEpoch: 8,
      databaseLineage: 'lineage-chat-generation-queue',
      requestedWriterWasActive: true,
    })
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-initial',
      jailbreakToggle: false,
      sidebarToggles: { notes: 'before' },
    }
    const firstTarget = { ...initial, personaId: 'persona-first' }
    const secondTarget = {
      ...firstTarget,
      sidebarToggles: { notes: 'queued' },
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })
    const firstResponse = createDeferred<Response>()
    const secondResponse = createDeferred<Response>()
    const commandCalls: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
          commandCalls.push(typeof init.body === 'string' ? JSON.parse(init.body) : {})
          return commandCalls.length === 1 ? firstResponse.promise : secondResponse.promise
        }
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      expect(dispatchSaveChatGenerationSettings('chat-a', firstTarget)).toBe(true)
      await vi.waitFor(() => expect(commandCalls).toHaveLength(1))
      expect(dispatchSaveChatGenerationSettings('chat-a', secondTarget)).toBe(true)

      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(2))
      const pending = await listPendingMutations()
      expect(pending.map((entry) => entry.handle.key)).toEqual(['character-owner:char-a', 'character-owner:char-a'])
      expect(pending[0].handle.mutationId).not.toBe(pending[1].handle.mutationId)
      expect(pending[1].intent).toEqual({
        version: 1,
        dependencyKeys: ['persona:selection', 'settings:bridge', 'persona-profile:persona-first'],
        requests: [
          {
            method: 'PUT',
            path: '/chats/chat-a/generation-settings',
            body: { generationSettings: secondTarget },
          },
        ],
      })
      expect(commandCalls).toHaveLength(1)

      firstResponse.resolve(successfulChatGenerationSettingsResponse(11, firstTarget))
      await vi.waitFor(() => expect(commandCalls).toHaveLength(2))
      secondResponse.resolve(successfulChatGenerationSettingsResponse(12, secondTarget))
      await waitForPendingChatGenerationSettingsSave('chat-a')
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('settles a retained persona delete before saving a chat reference to that persona', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-generation-persona-delete',
      writerEpoch: 12,
      databaseLineage: 'lineage-chat-generation-persona-delete',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    setResourceWriteGuardEnabled(true)

    const initial = {
      configured: true,
      personaId: 'persona-survivor',
      modelPresetId: 'model-survivor',
      promptPresetId: 'prompt-survivor',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    const doomedSelection = {
      ...initial,
      personaId: 'persona-doomed',
      modelPresetId: 'model-doomed',
      promptPresetId: 'prompt-doomed',
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })

    const deleteRecovery = createDeferred<Response>()
    const commands: Array<{ method: string; url: string }> = []
    let deleteCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        const method = init.method ?? 'GET'
        commands.push({ method, url })
        if (url === '/api/v1/commands/personas/persona-doomed' && method === 'DELETE') {
          deleteCalls += 1
          if (deleteCalls === 1) return jsonResponse({ error: 'persona delete temporarily unavailable' }, 500)
          return deleteRecovery.promise
        }
        if (url === '/api/v1/commands/chats/chat-a/generation-settings' && method === 'PUT') {
          return successfulChatGenerationSettingsResponse(12, doomedSelection)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const deleteIntent = {
        version: 1 as const,
        dependencyKeys: ['persona-profile:persona-doomed'],
        requests: [
          {
            method: 'DELETE' as const,
            path: '/personas/persona-doomed',
            body: {
              selectPersonaId: 'persona-survivor',
              mirrorLegacyProfile: true,
              saveCurrent: true,
            },
          },
        ],
      }
      const retainedDelete = stagePendingMutation(PERSONA_SELECTION_MUTATION_KEY, deleteIntent)
      await expect(retainedDelete.ready).resolves.toBe('persisted')
      await expect(replayPendingMutations()).resolves.toMatchObject({ retained: 1, succeeded: 0 })

      expect(dispatchSaveChatGenerationSettings('chat-a', doomedSelection)).toBe(true)
      await vi.waitFor(() => expect(deleteCalls).toBe(2))
      expect(commands.filter((command) => command.url.includes('/generation-settings'))).toEqual([])

      const pending = await listPendingMutations()
      const chatSave = pending.find((entry) => entry.handle.key === 'character-owner:char-a')
      expect(chatSave?.intent.dependencyKeys).toEqual([
        'persona:selection',
        'settings:bridge',
        'persona-profile:persona-doomed',
        'split-preset:model:model-doomed',
        'prompt-template-owner:prompt-doomed',
      ])

      deleteRecovery.resolve(
        jsonResponse({
          revision: 11,
          event: { type: 'persona.deleted', revision: 11, resource: 'persona', id: 'persona-doomed' },
          personaId: 'persona-doomed',
          selectedPersonaId: 'persona-survivor',
          cascadedChatCount: 1,
          cascadedLoadoutCount: 0,
        }),
      )
      await waitForPendingChatGenerationSettingsSave('chat-a')

      expect(commands.filter((command) => command.url !== '/api/v1/commands/mutation-receipts/ack')).toEqual([
        { method: 'DELETE', url: '/api/v1/commands/personas/persona-doomed' },
        { method: 'DELETE', url: '/api/v1/commands/personas/persona-doomed' },
        { method: 'PUT', url: '/api/v1/commands/chats/chat-a/generation-settings' },
      ])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('replays a retained generation-settings predecessor before a full corrective successor', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-generation-predecessor',
      writerEpoch: 9,
      databaseLineage: 'lineage-chat-generation-predecessor',
      requestedWriterWasActive: true,
    })
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-initial',
      jailbreakToggle: false,
      sidebarToggles: { notes: 'before' },
    }
    const firstTarget = { ...initial, personaId: 'persona-first' }
    const correctiveTarget = { ...initial, sidebarToggles: { notes: 'corrective' } }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })
    const olderCharacter = jsonClone(getDatabase().characters[0])
    const generationCalls: Array<{
      body: Record<string, unknown>
      mutationId: string | null
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
          const headers = init.headers as Record<string, string>
          generationCalls.push({
            body: typeof init.body === 'string' ? JSON.parse(init.body) : {},
            mutationId: headers['risu-mutation-id'] ?? null,
          })
          if (generationCalls.length === 1) return jsonResponse({ error: 'offline' }, 500)
          if (generationCalls.length === 2) {
            return jsonResponse({
              revision: 11,
              event: {
                type: 'chat.updated',
                revision: 11,
                resource: 'characterRow',
                id: 'chat-a',
                parentId: 'char-a',
              },
              chatId: 'chat-a',
              characterId: 'char-a',
            })
          }
          return successfulChatGenerationSettingsResponse(12, correctiveTarget)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const retainedOperation = dispatchSaveChatGenerationSettingsWithOutcome('chat-a', firstTarget)
      expect(retainedOperation).not.toBeNull()
      await waitForPendingChatGenerationSettingsSave('chat-a')
      await expect(retainedOperation!.settlement).resolves.toEqual({ status: 'queued' })
      expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(firstTarget)
      expect(applyCharacterResource({ revision: 11, character: jsonClone(olderCharacter) })).toBe(true)
      expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(firstTarget)
      const retained = await listPendingMutations()
      expect(retained).toHaveLength(1)
      expect(retained[0].handle.key).toBe('character-owner:char-a')

      expect(dispatchSaveChatGenerationSettings('chat-a', correctiveTarget)).toBe(true)
      await waitForPendingChatGenerationSettingsSave('chat-a')

      expect(generationCalls).toHaveLength(3)
      expect(generationCalls[1].mutationId).toBe(retained[0].handle.mutationId)
      expect(generationCalls[2].mutationId).not.toBe(retained[0].handle.mutationId)
      expect(generationCalls[2].body).toEqual({
        baseRevision: 11,
        generationSettings: correctiveTarget,
      })
      expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(correctiveTarget)
      expect(await listPendingMutations()).toEqual([])

      expect(applyCharacterResource({ revision: 13, character: jsonClone(olderCharacter) })).toBe(true)
      expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(initial)
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('uses a later chat slot to service an unsent retained head before its own edit', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-generation-retained-head',
      writerEpoch: 11,
      databaseLineage: 'lineage-chat-generation-retained-head',
      requestedWriterWasActive: true,
    })
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-initial',
      jailbreakToggle: false,
      sidebarToggles: { notes: 'before' },
    }
    const firstTarget = { ...initial, personaId: 'persona-first' }
    const secondTarget = { ...firstTarget, sidebarToggles: { notes: 'second' } }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })
    const predecessor = stagePendingMutation('character-owner:char-a', {
      version: 1,
      requests: [
        {
          method: 'PUT',
          path: '/chats/chat-a/generation-settings',
          body: { generationSettings: initial },
        },
      ],
    })
    await predecessor.ready
    const generationCalls: Array<{ body: Record<string, unknown>; mutationId: string | null }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
          const headers = init.headers as Record<string, string>
          generationCalls.push({
            body: typeof init.body === 'string' ? JSON.parse(init.body) : {},
            mutationId: headers['risu-mutation-id'] ?? null,
          })
          if (generationCalls.length === 1) return jsonResponse({ error: 'still offline' }, 500)
          if (generationCalls.length === 2) {
            return jsonResponse({
              revision: 11,
              event: {
                type: 'chat.updated',
                revision: 11,
                resource: 'characterRow',
                id: 'chat-a',
                parentId: 'char-a',
              },
              chatId: 'chat-a',
              characterId: 'char-a',
            })
          }
          if (generationCalls.length === 3) {
            return successfulChatGenerationSettingsResponse(12, firstTarget)
          }
          return successfulChatGenerationSettingsResponse(13, secondTarget)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      expect(dispatchSaveChatGenerationSettings('chat-a', firstTarget)).toBe(true)
      await waitForPendingChatGenerationSettingsSave('chat-a')
      expect(generationCalls).toHaveLength(1)
      expect(generationCalls[0].mutationId).toBe(predecessor.mutationId)
      // Both the retained predecessor and this unsent durable head remain
      // queued, so their visible optimistic projection must remain as well.
      expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(firstTarget)
      expect(await listPendingMutations()).toHaveLength(2)

      expect(dispatchSaveChatGenerationSettings('chat-a', secondTarget)).toBe(true)
      await waitForPendingChatGenerationSettingsSave('chat-a')

      expect(generationCalls).toHaveLength(4)
      expect(generationCalls[1].mutationId).toBe(predecessor.mutationId)
      expect(generationCalls[2].body).toEqual({
        baseRevision: 11,
        generationSettings: firstTarget,
      })
      expect(generationCalls[3].body).toMatchObject({ baseRevision: 12 })
      expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(secondTarget)
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('sends a full idempotent correction when a queued edit rebases to a no-op', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledChatGenerationSettingsFetch()
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-initial',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    const attempted = { ...initial, personaId: 'persona-attempted' }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })

    expect(dispatchSaveChatGenerationSettings('chat-a', attempted)).toBe(true)
    await waitForCallCount(calls, 2)
    expect(dispatchSaveChatGenerationSettings('chat-a', initial)).toBe(true)
    firstResponse.resolve(jsonResponse({ error: 'offline' }, 500))
    await waitForCallCount(calls, 3)

    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      body: { baseRevision: 10, generationSettings: initial },
    })
    secondResponse.resolve(successfulChatGenerationSettingsResponse(11, initial))
    await waitForPendingChatGenerationSettingsSave('chat-a')
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(initial)
  })

  it('keeps a marked placeholder immutable and sends a full correction under a fresh receipt id', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-generation-marker',
      writerEpoch: 10,
      databaseLineage: 'lineage-chat-generation-marker',
      requestedWriterWasActive: true,
    })
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-initial',
      jailbreakToggle: false,
      sidebarToggles: { notes: 'before' },
    }
    const firstTarget = {
      ...initial,
      personaId: 'persona-first',
      sidebarToggles: { notes: 'before', temporary: '' },
    }
    const canonicalFirst = {
      ...firstTarget,
      sidebarToggles: { notes: 'before' },
    }
    const queuedTarget = {
      ...firstTarget,
      sidebarToggles: { notes: 'queued', temporary: '' },
    }
    const correctedTarget = {
      ...canonicalFirst,
      sidebarToggles: { notes: 'queued' },
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })
    const firstResponse = createDeferred<Response>()
    const generationCalls: Array<{
      body: Record<string, unknown>
      mutationId: string | null
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') {
          const headers = init.headers as Record<string, string>
          generationCalls.push({
            body: typeof init.body === 'string' ? JSON.parse(init.body) : {},
            mutationId: headers['risu-mutation-id'] ?? null,
          })
          if (generationCalls.length === 1) return firstResponse.promise
          if (generationCalls.length === 2) {
            return jsonResponse({
              revision: 12,
              event: {
                type: 'chat.updated',
                revision: 12,
                resource: 'characterRow',
                id: 'chat-a',
                parentId: 'char-a',
              },
              chatId: 'chat-a',
              characterId: 'char-a',
            })
          }
          return successfulChatGenerationSettingsResponse(13, correctedTarget)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      expect(dispatchSaveChatGenerationSettings('chat-a', firstTarget)).toBe(true)
      await vi.waitFor(() => expect(generationCalls).toHaveLength(1))
      expect(dispatchSaveChatGenerationSettings('chat-a', queuedTarget)).toBe(true)
      await vi.waitFor(async () => expect(await listPendingMutations()).toHaveLength(2))
      const before = await listPendingMutations()
      const markedPlaceholder = before[1]
      expect(markedPlaceholder.intent.requests[0].body).toEqual({ generationSettings: queuedTarget })
      await expect(beginPendingMutationDispatch(markedPlaceholder.handle)).resolves.toBe('persisted')

      firstResponse.resolve(successfulChatGenerationSettingsResponse(11, canonicalFirst))
      await waitForPendingChatGenerationSettingsSave('chat-a')

      expect(generationCalls).toHaveLength(3)
      expect(generationCalls[1]).toMatchObject({
        mutationId: markedPlaceholder.handle.mutationId,
        body: { generationSettings: queuedTarget },
      })
      expect(generationCalls[2].mutationId).not.toBe(markedPlaceholder.handle.mutationId)
      expect(generationCalls[2].body).toEqual({
        baseRevision: 12,
        generationSettings: correctedTarget,
      })
      expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(correctedTarget)
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
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
    setResourceWriteGuardEnabled(true)

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

    expect(getDatabase().characters[0].chats[0]).not.toHaveProperty('generationSettings')
    const operation = dispatchSaveChatGenerationSettingsWithOutcome('chat-a', nextGenerationSettings)
    expect(operation).not.toBeNull()
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(nextGenerationSettings)

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].message.push({
        role: 'char',
        data: 'concurrent same-chat message',
        chatId: 'msg-concurrent',
      })
      getDatabase().characters[0].chats[1].name = 'Concurrent sibling edit'
    })

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0]).not.toHaveProperty('generationSettings')
    })
    expect(getDatabase().characters[0].chats[0].message).toEqual([
      {
        role: 'char',
        data: 'concurrent same-chat message',
        chatId: 'msg-concurrent',
      },
    ])
    expect(getDatabase().characters[0].chats[1].name).toBe('Concurrent sibling edit')
    await expect(operation!.settlement).resolves.toEqual({ status: 'failed', error: 'nope' })
  })

  it('does not overwrite a destructive refresh after a pending save fails', async () => {
    const calls: CapturedFetch[] = []
    const commandResponse = createDeferred<Response>()
    const refreshedSettings = {
      configured: true,
      personaId: 'persona-from-refresh',
      jailbreakToggle: false,
      sidebarToggles: { refreshed: '1' },
    }
    const refreshedCharacter = {
      chaId: 'char-a',
      name: 'Refreshed Character',
      chatPage: 0,
      chats: [
        {
          id: 'chat-a',
          name: 'Chat A',
          folderId: null,
          message: [],
          generationSettings: refreshedSettings,
        },
      ],
      chatFolders: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        const headers = init.headers as Record<string, string> | undefined
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') return commandResponse.promise
        if (url === '/api/v1/characters/char-a') {
          return jsonResponse({ revision: 10, character: refreshedCharacter })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setResourceWriteGuardEnabled(true)

    expect(
      dispatchSaveChatGenerationSettings('chat-a', {
        configured: true,
        personaId: 'persona-attempted',
        jailbreakToggle: true,
        sidebarToggles: {},
      }),
    ).toBe(true)
    await waitForCallCount(calls, 2)
    setDatabaseLite({ characters: [refreshedCharacter] } as any)
    commandResponse.resolve(jsonResponse({ error: 'nope' }, 500))
    await waitForPendingChatGenerationSettingsSave('chat-a')

    expect(calls.some((call) => call.url === '/api/v1/characters/char-a')).toBe(true)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(refreshedSettings)
  })

  it('keeps newer generation settings through an older successful character-row projection', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledChatGenerationSettingsFetch()
    setResourceWriteGuardEnabled(true)
    const generationSettingsA = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        notes: 'a',
      },
    }
    const generationSettingsB = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        notes: 'ab',
      },
    }
    setServerCommandSuccessReconciler((event) => {
      const projectedGenerationSettings = event.revision === 11 ? generationSettingsA : generationSettingsB
      mergeServerResourceCharacterRow({
        chaId: 'char-a',
        name: 'Character',
        chatPage: 0,
        chats: [
          {
            id: 'chat-a',
            name: 'Chat A',
            folderId: null,
            message: [],
            generationSettings: projectedGenerationSettings,
          },
          { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
        ],
        chatFolders: [{ id: 'folder-a', name: 'Folder', folded: false }],
      })
    })

    expect(dispatchSaveChatGenerationSettings('chat-a', generationSettingsA)).toBe(true)
    await waitForCallCount(calls, 2)
    expect(dispatchSaveChatGenerationSettings('chat-a', generationSettingsB)).toBe(true)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsB)

    firstResponse.resolve(successfulChatGenerationSettingsResponse(11, generationSettingsA))
    await waitForCallCount(calls, 3)

    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsB)
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 11,
        patch: {
          sidebarToggles: { notes: 'ab' },
        },
      },
    })

    secondResponse.resolve(successfulChatGenerationSettingsResponse(12, generationSettingsB))
    await waitForPendingChatGenerationSettingsSave('chat-a')
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsB)
  })

  it('does not project a sparse acknowledgement overtaken by a newer full write', async () => {
    const calls: CapturedFetch[] = []
    const sparseResponse = createDeferred<Response>()
    const sparseTarget = {
      configured: true,
      personaId: 'persona-a',
      jailbreakToggle: false,
      sidebarToggles: { notes: 'sparse' },
    }
    const newerFullTarget = {
      ...sparseTarget,
      agentPresetId: 'agent-from-newer-full-write',
      sidebarToggles: { notes: 'sparse', moduleDefault: '1' },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        const headers = init.headers as Record<string, string> | undefined
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') return sparseResponse.promise
        if (url === '/api/v1/characters/char-a') {
          return jsonResponse({
            revision: 12,
            character: {
              chaId: 'char-a',
              name: 'Character',
              chatPage: 0,
              chats: [
                {
                  id: 'chat-a',
                  name: 'Chat A',
                  folderId: null,
                  message: [],
                  generationSettings: newerFullTarget,
                },
                { id: 'chat-b', name: 'Chat B', folderId: 'folder-a', message: [] },
              ],
              chatFolders: [{ id: 'folder-a', name: 'Folder', folded: false }],
            },
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setServerCommandSuccessReconciler(() => {
      // Simulate a later full generation-settings command that joined the
      // active global batch before the sparse command promise resumed.
      setAppliedServerResourceRevision(12)
    })
    setResourceWriteGuardEnabled(true)

    expect(dispatchSaveChatGenerationSettings('chat-a', sparseTarget)).toBe(true)
    await waitForCallCount(calls, 2)
    sparseResponse.resolve(successfulChatGenerationSettingsResponse(11, sparseTarget))
    await waitForPendingChatGenerationSettingsSave('chat-a')

    expect(calls.some((call) => call.url === '/api/v1/characters/char-a')).toBe(true)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(newerFullTarget)
  })

  it('does not project a stale rollback when a failed sparse save is overtaken by a full write', async () => {
    const calls: CapturedFetch[] = []
    const sparseResponse = createDeferred<Response>()
    const newerFullTarget = {
      configured: true,
      personaId: 'persona-from-newer-full-write',
      jailbreakToggle: false,
      sidebarToggles: { moduleDefault: '1' },
    }
    const newerCharacter = {
      chaId: 'char-a',
      name: 'Character',
      chatPage: 0,
      chats: [
        {
          id: 'chat-a',
          name: 'Chat A',
          folderId: null,
          message: [],
          generationSettings: newerFullTarget,
        },
      ],
      chatFolders: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        const headers = init.headers as Record<string, string> | undefined
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: headers?.['risu-auth'] ?? null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/chats/chat-a/generation-settings') return sparseResponse.promise
        if (url === '/api/v1/characters/char-a') {
          return jsonResponse({ revision: 12, character: newerCharacter })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setResourceWriteGuardEnabled(true)

    expect(
      dispatchSaveChatGenerationSettings('chat-a', {
        configured: true,
        personaId: 'persona-attempted',
        jailbreakToggle: true,
        sidebarToggles: {},
      }),
    ).toBe(true)
    await waitForCallCount(calls, 2)
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(newerFullTarget)
    })
    setAppliedServerResourceRevision(12)
    sparseResponse.resolve(jsonResponse({ error: 'nope' }, 500))
    await waitForPendingChatGenerationSettingsSave('chat-a')

    expect(calls.some((call) => call.url === '/api/v1/characters/char-a')).toBe(true)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(newerFullTarget)
  })

  it('preserves a newer generation settings save when an older save fails from no initial settings', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledChatGenerationSettingsFetch()
    setResourceWriteGuardEnabled(true)
    const generationSettingsA = {
      configured: false,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'a',
      },
    }
    const generationSettingsB = {
      configured: true,
      personaId: 'persona-b',
      modelPresetId: 'model-preset-b',
      promptPresetId: 'preset-b',
      jailbreakToggle: true,
      sidebarToggles: {
        mode: 'b',
      },
    }

    expect(getDatabase().characters[0].chats[0]).not.toHaveProperty('generationSettings')
    expect(dispatchSaveChatGenerationSettings('chat-a', generationSettingsA)).toBe(true)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsA)
    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 10,
        patch: generationSettingsA,
      },
    })

    expect(dispatchSaveChatGenerationSettings('chat-a', generationSettingsB)).toBe(true)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsB)
    expect(calls).toHaveLength(2)

    firstResponse.resolve(jsonResponse({ error: 'nope' }, 500))
    await waitForCallCount(calls, 3)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsB)
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 10,
        patch: generationSettingsB,
      },
    })

    secondResponse.resolve(successfulChatGenerationSettingsResponse(11, generationSettingsB))
    await waitForPendingChatGenerationSettingsSave('chat-a')
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsB)
  })

  it('preserves a newer generation settings save when an older save fails from configured settings', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledChatGenerationSettingsFetch()
    setResourceWriteGuardEnabled(true)
    const initialGenerationSettings = {
      configured: true,
      personaId: 'persona-initial',
      modelPresetId: 'model-preset-initial',
      promptPresetId: 'preset-initial',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'initial',
      },
    }
    const generationSettingsA = {
      configured: true,
      personaId: 'persona-a',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: true,
      sidebarToggles: {
        mode: 'a',
      },
    }
    const generationSettingsB = {
      configured: true,
      personaId: 'persona-b',
      modelPresetId: 'model-preset-b',
      promptPresetId: 'preset-b',
      jailbreakToggle: false,
      sidebarToggles: {
        mode: 'b',
      },
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initialGenerationSettings)
    })

    expect(dispatchSaveChatGenerationSettings('chat-a', generationSettingsA)).toBe(true)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsA)
    await waitForCallCount(calls, 2)
    expect(dispatchSaveChatGenerationSettings('chat-a', generationSettingsB)).toBe(true)
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsB)
    expect(calls).toHaveLength(2)

    firstResponse.resolve(jsonResponse({ error: 'nope' }, 500))
    await waitForCallCount(calls, 3)
    expect(calls[2]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/generation-settings',
      method: 'PUT',
      body: {
        baseRevision: 10,
        patch: {
          personaId: 'persona-b',
          modelPresetId: 'model-preset-b',
          promptPresetId: 'preset-b',
          sidebarToggles: { mode: 'b' },
        },
      },
    })
    secondResponse.resolve(successfulChatGenerationSettingsResponse(11, generationSettingsB))
    await waitForPendingChatGenerationSettingsSave('chat-a')

    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(generationSettingsB)
    expect(getDatabase().characters[0].chats[0].generationSettings).not.toEqual(initialGenerationSettings)
  })

  it('drops only a failed older field intent before sending a disjoint queued edit', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledChatGenerationSettingsFetch()
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-initial',
      modelPresetId: 'model-preset-a',
      promptPresetId: 'preset-a',
      jailbreakToggle: false,
      sidebarToggles: { notes: 'initial' },
    }
    const firstTarget = { ...initial, personaId: 'persona-a' }
    const secondTarget = {
      ...firstTarget,
      sidebarToggles: { notes: 'queued' },
    }
    const canonicalSecond = {
      ...initial,
      sidebarToggles: { notes: 'queued' },
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })

    expect(dispatchSaveChatGenerationSettings('chat-a', firstTarget)).toBe(true)
    await waitForCallCount(calls, 2)
    expect(dispatchSaveChatGenerationSettings('chat-a', secondTarget)).toBe(true)

    firstResponse.resolve(jsonResponse({ error: 'nope' }, 500))
    await waitForCallCount(calls, 3)
    expect(calls[2]).toMatchObject({
      body: {
        baseRevision: 10,
        patch: { sidebarToggles: { notes: 'queued' } },
      },
    })
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(canonicalSecond)

    secondResponse.resolve(successfulChatGenerationSettingsResponse(11, canonicalSecond))
    await waitForPendingChatGenerationSettingsSave('chat-a')
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(canonicalSecond)
  })

  it('keeps an accepted value when a newer queued edit to the same field fails', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledChatGenerationSettingsFetch()
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-initial',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    const firstTarget = { ...initial, personaId: 'persona-a' }
    const secondTarget = { ...initial, personaId: 'persona-b' }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })

    expect(dispatchSaveChatGenerationSettings('chat-a', firstTarget)).toBe(true)
    await waitForCallCount(calls, 2)
    expect(dispatchSaveChatGenerationSettings('chat-a', secondTarget)).toBe(true)
    firstResponse.resolve(successfulChatGenerationSettingsResponse(11, firstTarget))
    await waitForCallCount(calls, 3)

    secondResponse.resolve(jsonResponse({ error: 'nope' }, 500))
    await waitForPendingChatGenerationSettingsSave('chat-a')
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(firstTarget)
  })

  it('restores the original value when overlapping queued edits both fail', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledChatGenerationSettingsFetch()
    setResourceWriteGuardEnabled(true)
    const initial = {
      configured: true,
      personaId: 'persona-initial',
      jailbreakToggle: false,
      sidebarToggles: {},
    }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].generationSettings = jsonClone(initial)
    })

    expect(dispatchSaveChatGenerationSettings('chat-a', { ...initial, personaId: 'persona-a' })).toBe(true)
    await waitForCallCount(calls, 2)
    expect(dispatchSaveChatGenerationSettings('chat-a', { ...initial, personaId: 'persona-b' })).toBe(true)
    firstResponse.resolve(jsonResponse({ error: 'nope' }, 500))
    await waitForCallCount(calls, 3)
    secondResponse.resolve(jsonResponse({ error: 'still nope' }, 500))

    await waitForPendingChatGenerationSettingsSave('chat-a')
    expect(getDatabase().characters[0].chats[0].generationSettings).toEqual(initial)
  })

  it('sets DevTool-style scriptstate values through the chat scriptstate command helper', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().characters[0].chats[0].scriptstate!.$score = 'direct'
    }).toThrow()

    expect(setChatScriptstateValue('chat-a', '$score', '9')).toBe(true)
    expect(getDatabase().characters[0].chats[0].scriptstate).toMatchObject({ $score: '9' })

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
    expect(getDatabase().characters[0].chats[0].scriptstate).toMatchObject({ $score: '9' })
  })

  it('sets parser chat variables through the resource guard for Lua edit-display hooks', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().characters[0].chats[0].scriptstate!.$outfit = 'direct'
    }).toThrow()

    setChatVar('outfit', 'date_a')
    expect(getDatabase().characters[0].chats[0].scriptstate).toMatchObject({ $outfit: 'date_a' })

    await waitForCallCount(calls, 2)
    expect(calls[1]).toEqual({
      url: '/api/v1/commands/chats/chat-a/scriptstate',
      method: 'PATCH',
      authHeader: 'chat-command-token',
      body: {
        baseRevision: 10,
        patch: { $outfit: 'date_a' },
        deleteKeys: [],
      },
    })
  })

  it('creates scriptstate when setting a value on a chat without one', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    expect(getDatabase().characters[0].chats[1]).not.toHaveProperty('scriptstate')

    expect(setChatScriptstateValue('chat-b', '$enabled', true)).toBe(true)

    expect(getDatabase().characters[0].chats[1].scriptstate).toEqual({ $enabled: true })
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
    setResourceWriteGuardEnabled(true)
    const before = jsonClone(getDatabase().characters[0].chats[0].scriptstate)

    expect(setChatScriptstateValue(undefined, '$score', '2')).toBe(false)
    expect(setChatScriptstateValue('', '$score', '2')).toBe(false)
    expect(setChatScriptstateValue('missing-chat', '$score', '2')).toBe(false)
    expect(setChatScriptstateValue('chat-a', '', '2')).toBe(false)
    expect(setChatScriptstateValue('chat-a', '$object', { nested: true })).toBe(false)
    expect(setChatScriptstateValue('chat-a', '$nan', Number.NaN)).toBe(false)

    expect(getDatabase().characters[0].chats[0].scriptstate).toEqual(before)
    expect(calls).toEqual([])
  })

  it('appends DevTool Autopilot user messages through an awaited message command', async () => {
    const calls = stubCommandFetch()
    seedReadyActiveChatGenerationSettings()
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().characters[0].chats[0].message.push({ role: 'user', data: 'direct' })
    }).toThrow()

    const result = await appendCurrentChatUserMessageForSend('autopilot row')

    expect(result.status).toBe('ok')
    await waitForCallCount(calls, 2)
    const message = getDatabase().characters[0].chats[0].message[0]
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

  it('rejects a captured active-chat target after chatPage changes without mutating or dispatching', async () => {
    const calls = stubCommandFetch()
    seedReadyActiveChatGenerationSettings()
    setResourceWriteGuardEnabled(true)
    const target = captureActiveChatTarget()

    expect(target).toMatchObject({ characterId: 'char-a', chatId: 'chat-a' })
    expect(isActiveChatTargetFresh(target)).toBe(true)

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatPage = 1
    })

    expect(isActiveChatTargetFresh(target)).toBe(false)
    const result = await appendCurrentChatUserMessageForSend('stale autopilot row', {
      expectedTarget: target,
    })

    expect(result).toEqual({
      status: 'error',
      error: 'The active chat changed before the message could be appended.',
    })
    expect(calls).toEqual([])
    expect(getDatabase().characters[0].chats[0].message).toEqual([])
    expect(getDatabase().characters[0].chats[1].message).toEqual([])
  })

  it('rejects a captured active-chat target after selectedCharID changes without mutating or dispatching', async () => {
    const calls = stubCommandFetch()
    withTrustedResourceWrite(() => {
      getDatabase().characters.push({
        chaId: 'char-b',
        name: 'Character B',
        chatPage: 0,
        chats: [{ id: 'chat-c', name: 'Chat C', message: [] }],
      } as any)
    })
    setResourceWriteGuardEnabled(true)
    const target = captureActiveChatTarget()

    expect(target).toMatchObject({ characterId: 'char-a', chatId: 'chat-a' })
    selectedCharID.set(1)

    expect(isActiveChatTargetFresh(target)).toBe(false)
    const result = await appendCurrentChatUserMessageForSend('stale character row', {
      expectedTarget: target,
    })

    expect(result).toEqual({
      status: 'error',
      error: 'The active chat changed before the message could be appended.',
    })
    expect(calls).toEqual([])
    expect(getDatabase().characters[0].chats[0].message).toEqual([])
    expect(getDatabase().characters[1].chats[0].message).toEqual([])
  })

  it('blocks direct send appends when active-chat generation settings are incomplete', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    const result = await appendCurrentChatUserMessageForSend('autopilot row')

    expect(result).toEqual({
      status: 'error',
      error:
        'Chat generation settings are incomplete. Missing: Generation settings, Configuration confirmation, Persona, Model preset, Prompt preset, Jailbreak toggle.',
    })
    expect(calls).toEqual([])
    expect(getDatabase().characters[0].chats[0].message).toEqual([])
  })

  it('appends prepared plain-send user messages through one-message POST bodies', async () => {
    const calls = stubCommandFetch()
    seedReadyActiveChatGenerationSettings()
    setResourceWriteGuardEnabled(true)
    const prepared: Message = {
      role: 'user',
      data: 'prepared plain send',
      time: 123456,
      name: null,
    }

    const result = await appendCurrentChatUserMessageForSend(prepared)

    expect(result.status).toBe('ok')
    await waitForCallCount(calls, 2)
    const message = getDatabase().characters[0].chats[0].message[0]
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

  it('reports a retryable durable user append as queued and keeps its exact optimistic row', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-user-append',
      writerEpoch: 31,
      databaseLineage: 'lineage-chat-user-append',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    seedReadyActiveChatGenerationSettings()
    setResourceWriteGuardEnabled(true)
    let liveBody: Record<string, unknown> | undefined

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chats/chat-a/messages') {
          liveBody = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const result = await appendCurrentChatUserMessageForSend({
        role: 'user',
        data: 'keep this queued message',
        time: 444,
        name: null,
      })

      expect(result).toEqual({ status: 'queued', messageId: expect.any(String) })
      const projectedMessage = getDatabase().characters[0].chats[0].message.at(-1)
      expect(projectedMessage).toEqual({
        role: 'user',
        data: 'keep this queued message',
        time: 444,
        name: null,
        chatId: result.status === 'queued' ? result.messageId : undefined,
      })

      const pending = await listPendingMutations()
      expect(pending).toHaveLength(1)
      expect(pending[0]).toMatchObject({
        handle: { key: 'character-owner:char-a' },
        intent: {
          version: 1,
          requests: [
            {
              method: 'POST',
              path: '/chats/chat-a/messages',
              body: { message: projectedMessage },
            },
          ],
        },
      })
      const { baseRevision: _baseRevision, ...exactLiveBody } = liveBody ?? {}
      expect(exactLiveBody).toEqual(pending[0].intent.requests[0].body)
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('accepts a retained single-chat import without rolling back or inviting a duplicate retry', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-import',
      writerEpoch: 32,
      databaseLineage: 'lineage-chat-import',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const previous = currentChatStateSnapshot()
    const importedChat = {
      id: 'chat-imported',
      name: 'Imported chat',
      note: '',
      localLore: [],
      message: [{ role: 'user', data: 'imported row', chatId: 'message-imported' }],
    } as Chat
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(importedChat)
      getDatabase().characters[0].chatPage = 0
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/characters/char-a/chats') {
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(dispatchCreateChatForImport('char-a', importedChat, previous)).resolves.toEqual({ status: 'ok' })
      expect(getDatabase().characters[0].chats[0]).toEqual(importedChat)
      expect(await listPendingMutations()).toMatchObject([
        {
          handle: { key: 'character-owner:char-a' },
          intent: {
            version: 1,
            requests: [
              {
                method: 'POST',
                path: '/characters/char-a/chats',
                body: { chat: importedChat, select: true },
              },
            ],
          },
        },
      ])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('pre-stages every multi-chat import item and retains later rows without sending after a retryable failure', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-batch-import',
      writerEpoch: 34,
      databaseLineage: 'lineage-chat-batch-import',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const previous = currentChatStateSnapshot()
    const folder = { id: 'folder-imported', name: 'Imported folder', folded: false } as ChatFolder
    const chats = [
      {
        id: 'chat-imported-a',
        name: 'Imported A',
        note: '',
        localLore: [],
        folderId: 'folder-imported',
        message: [],
      },
      {
        id: 'chat-imported-b',
        name: 'Imported B',
        note: '',
        localLore: [],
        message: [{ role: 'user', data: 'batch row', chatId: 'message-batch' }],
      },
    ] as Chat[]
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders.push(folder)
      getDatabase().characters[0].chats.unshift(...chats)
    })

    const commandUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/characters/char-a/chat-folders') {
          commandUrls.push(url)
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(dispatchCreateImportedChats('char-a', [folder], chats, previous)).resolves.toEqual({
        status: 'ok',
      })
      expect(getDatabase().characters[0].chatFolders.at(-1)).toEqual(folder)
      expect(getDatabase().characters[0].chats.slice(0, 2)).toEqual(chats)
      expect(commandUrls).toEqual(['/api/v1/commands/characters/char-a/chat-folders'])
      const pending = await listPendingMutations()
      expect(pending).toHaveLength(3)
      expect(pending.map((entry) => entry.handle.key)).toEqual([
        'character-owner:char-a',
        'character-owner:char-a',
        'character-owner:char-a',
      ])
      expect(pending.map((entry) => entry.intent)).toEqual([
        {
          version: 1,
          requests: [
            {
              method: 'POST',
              path: '/characters/char-a/chat-folders',
              body: { folder },
            },
          ],
        },
        {
          version: 1,
          requests: [
            {
              method: 'POST',
              path: '/characters/char-a/chats',
              body: { chat: chats[0], select: false },
            },
          ],
        },
        {
          version: 1,
          requests: [
            {
              method: 'POST',
              path: '/characters/char-a/chats',
              body: { chat: chats[1], select: false },
            },
          ],
        },
      ])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('reserves every import queue slot before durable readiness so a later create cannot overtake', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-batch-order',
      writerEpoch: 37,
      databaseLineage: 'lineage-chat-batch-order',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const encryptionGate = createDeferred<void>()
    const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle)
    const encryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'encrypt')
      .mockImplementation(async (algorithm, key, data) => {
        await encryptionGate.promise
        return originalEncrypt(algorithm, key, data)
      })
    const previous = currentChatStateSnapshot()
    const folder = { id: 'folder-batch-order', name: 'Batch folder', folded: false } as ChatFolder
    const importedChat = {
      id: 'chat-batch-order',
      name: 'Batch chat',
      note: '',
      localLore: [],
      folderId: folder.id,
      message: [],
    } as Chat
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders.push(folder)
      getDatabase().characters[0].chats.unshift(importedChat)
    })

    let revision = 10
    const commandUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/characters/char-a/chat-folders') {
          commandUrls.push(url)
          revision += 1
          return jsonResponse({
            revision,
            event: {
              type: 'chatFolder.created',
              revision,
              resource: 'chatFolder',
              id: folder.id,
              parentId: 'char-a',
            },
            folderId: folder.id,
          })
        }
        if (url === '/api/v1/commands/characters/char-a/chats') {
          const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          const chatId = body.chat?.id as string
          commandUrls.push(`${url}:${chatId}`)
          revision += 1
          return jsonResponse({
            revision,
            event: {
              type: 'chat.created',
              revision,
              resource: 'chatTranscript',
              id: chatId,
              parentId: 'char-a',
            },
            chatId,
            selectedChatId: body.select === false ? 'chat-a' : chatId,
            generationSettings: null,
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const importPromise = dispatchCreateImportedChats('char-a', [folder], [importedChat], previous)
      const laterPrevious = currentChatStateSnapshot()
      const laterChat = {
        id: 'chat-created-after-batch',
        name: 'Later chat',
        note: '',
        localLore: [],
        message: [],
      } as Chat
      expect(applyOptimisticCreatedChat('char-a', laterChat, laterPrevious)).toBe(true)
      dispatchCreateChat('char-a', laterChat, laterPrevious)

      await Promise.resolve()
      expect(commandUrls).toEqual([])
      encryptionGate.resolve()

      await expect(importPromise).resolves.toEqual({ status: 'ok' })
      await vi.waitFor(() => expect(commandUrls).toHaveLength(3))
      expect(commandUrls).toEqual([
        '/api/v1/commands/characters/char-a/chat-folders',
        '/api/v1/commands/characters/char-a/chats:chat-batch-order',
        '/api/v1/commands/characters/char-a/chats:chat-created-after-batch',
      ])
      await vi.waitFor(async () => expect(await listPendingMutations()).toEqual([]))
    } finally {
      encryptionGate.resolve()
      encryptSpy.mockRestore()
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('durably pre-stages imports containing more than one hundred chats', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-large-batch-import',
      writerEpoch: 35,
      databaseLineage: 'lineage-chat-large-batch-import',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const previous = currentChatStateSnapshot()
    const chats = Array.from({ length: 101 }, (_, index) => ({
      id: `chat-large-import-${index}`,
      name: `Imported ${index}`,
      note: '',
      localLore: [],
      message: [],
    })) as Chat[]
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(...chats)
    })
    let createCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/characters/char-a/chats') {
          createCalls += 1
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(dispatchCreateImportedChats('char-a', [], chats, previous)).resolves.toEqual({ status: 'ok' })
      expect(createCalls).toBe(1)
      expect(getDatabase().characters[0].chats.slice(0, chats.length)).toEqual(chats)
      const pending = await listPendingMutations()
      expect(pending).toHaveLength(101)
      expect(pending.every((entry) => entry.handle.key === 'character-owner:char-a')).toBe(true)
      expect(pending.every((entry) => entry.intent.requests.length === 1)).toBe(true)
      expect(pending.at(-1)?.intent.requests[0]).toEqual({
        method: 'POST',
        path: '/characters/char-a/chats',
        body: { chat: chats.at(-1), select: false },
      })
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('chunks an oversized multi-message transcript into durable ordered tail rows', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-chunked-import',
      writerEpoch: 38,
      databaseLineage: 'lineage-chat-chunked-import',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const previous = currentChatStateSnapshot()
    const messageSize = Math.ceil(MAX_DURABLE_MUTATION_PAYLOAD_BYTES / 2)
    const chunkedChat = {
      id: 'chat-chunked-import',
      name: 'Chunked import',
      note: '',
      localLore: [],
      message: [
        { role: 'user', data: 'a'.repeat(messageSize), chatId: 'message-chunk-a' },
        { role: 'char', data: 'b'.repeat(messageSize), chatId: 'message-chunk-b' },
      ],
    } as Chat
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(chunkedChat)
    })

    const commandBodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/characters/char-a/chats') {
          commandBodies.push(typeof init.body === 'string' ? JSON.parse(init.body) : {})
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(dispatchCreateImportedChats('char-a', [], [chunkedChat], previous)).resolves.toEqual({
        status: 'ok',
      })
      expect(commandBodies).toHaveLength(1)
      expect(commandBodies[0]).toMatchObject({ chat: { id: chunkedChat.id, message: [] }, select: false })
      expect(getDatabase().characters[0].chats[0].message).toHaveLength(2)

      const pending = await listPendingMutations()
      expect(pending).toHaveLength(3)
      expect(pending.map((entry) => entry.handle.key)).toEqual([
        'character-owner:char-a',
        'character-owner:char-a',
        'character-owner:char-a',
      ])
      expect(pending[0].intent.requests[0]).toMatchObject({
        method: 'POST',
        path: '/characters/char-a/chats',
        body: { chat: { id: chunkedChat.id, message: [] }, select: false },
      })
      expect(pending[1].intent.requests[0]).toMatchObject({
        method: 'POST',
        path: '/chats/chat-chunked-import/messages/tail',
        body: { afterMessageId: null, messages: [{ chatId: 'message-chunk-a' }] },
      })
      expect(pending[2].intent.requests[0]).toMatchObject({
        method: 'POST',
        path: '/chats/chat-chunked-import/messages/tail',
        body: { afterMessageId: 'message-chunk-a', messages: [{ chatId: 'message-chunk-b' }] },
      })
      expect(
        pending.every(
          (entry) => pendingMutationIntentPayloadByteLength(entry.intent) <= MAX_DURABLE_MUTATION_PAYLOAD_BYTES,
        ),
      ).toBe(true)
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps an accepted chunked-import prefix when a later tail is terminally rejected', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-chunked-terminal',
      writerEpoch: 39,
      databaseLineage: 'lineage-chat-chunked-terminal',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const previous = currentChatStateSnapshot()
    const messageSize = Math.ceil(MAX_DURABLE_MUTATION_PAYLOAD_BYTES / 2)
    const chunkedChat = {
      id: 'chat-chunked-terminal',
      name: 'Chunked terminal import',
      note: '',
      localLore: [],
      message: [
        { role: 'user', data: 'a'.repeat(messageSize), chatId: 'message-terminal-a' },
        { role: 'char', data: 'b'.repeat(messageSize), chatId: 'message-terminal-b' },
      ],
    } as Chat
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(chunkedChat)
    })

    let revision = 10
    let tailCalls = 0
    const commandPaths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/characters/char-a/chats') {
          commandPaths.push('/characters/char-a/chats')
          revision += 1
          return jsonResponse({
            revision,
            event: {
              type: 'chat.created',
              revision,
              resource: 'chatTranscript',
              id: chunkedChat.id,
              parentId: 'char-a',
            },
            chatId: chunkedChat.id,
            selectedChatId: 'chat-a',
            generationSettings: null,
          })
        }
        if (url === '/api/v1/commands/chats/chat-chunked-terminal/messages/tail') {
          commandPaths.push('/chats/chat-chunked-terminal/messages/tail')
          tailCalls += 1
          if (tailCalls === 2) return jsonResponse({ error: 'invalid second tail' }, 400)
          const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          revision += 1
          return jsonResponse({
            revision,
            event: {
              type: 'messages.replaced',
              revision,
              resource: 'message',
              parentId: chunkedChat.id,
            },
            chatId: chunkedChat.id,
            afterMessageId: body.afterMessageId ?? null,
            replacedCount: body.messages?.length ?? 0,
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(dispatchCreateImportedChats('char-a', [], [chunkedChat], previous)).resolves.toEqual({
        status: 'error',
        error: 'invalid second tail',
        reason: 'invalid-request',
      })
      expect(commandPaths).toEqual([
        '/characters/char-a/chats',
        '/chats/chat-chunked-terminal/messages/tail',
        '/chats/chat-chunked-terminal/messages/tail',
      ])
      const imported = getDatabase().characters[0].chats.find((chat) => chat.id === chunkedChat.id)
      expect(imported?.message).toHaveLength(1)
      expect(imported?.message[0].chatId).toBe('message-terminal-a')
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('rejects an unchunkable oversized message before sending and rolls back the projection', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-oversized-import',
      writerEpoch: 36,
      databaseLineage: 'lineage-chat-oversized-import',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const previous = currentChatStateSnapshot()
    const oversizedChat = {
      id: 'chat-oversized-import',
      name: 'Oversized import',
      note: '',
      localLore: [],
      message: [
        {
          role: 'user',
          data: 'x'.repeat(MAX_DURABLE_MUTATION_PAYLOAD_BYTES + 1_024),
          chatId: 'message-oversized-import',
        },
      ],
    } as Chat
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats.unshift(oversizedChat)
    })
    let mutationIdHeader: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/characters/char-a/chats') {
          mutationIdHeader = (init.headers as Record<string, string> | undefined)?.['risu-mutation-id']
          return jsonResponse({ error: 'oversized import failed' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      await expect(dispatchCreateImportedChats('char-a', [], [oversizedChat], previous)).resolves.toEqual({
        status: 'error',
        error: 'chat_import_too_large',
      })
      expect(mutationIdHeader).toBeUndefined()
      expect(getDatabase().characters[0].chats.some((chat) => chat.id === oversizedChat.id)).toBe(false)
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('replays a retained chat create before a later append on the same explicit character owner', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-create-append',
      writerEpoch: 33,
      databaseLineage: 'lineage-chat-create-append',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    const previous = currentChatStateSnapshot()
    const createdChat = {
      id: 'chat-created-queued',
      name: 'Queued chat',
      note: '',
      localLore: [],
      message: [],
    } as Chat
    expect(applyOptimisticCreatedChat('char-a', createdChat, previous)).toBe(true)

    let recover = false
    let nextRevision = 10
    const commandCalls: Array<{
      method: string
      path: string
      body: Record<string, unknown>
      mutationId: string | null
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        const path = url.replace('/api/v1/commands', '')
        if (path === '/characters/char-a/chats' || path === '/chats/chat-created-queued/messages') {
          const headers = init.headers as Record<string, string> | undefined
          const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          commandCalls.push({
            method: init.method ?? 'GET',
            path,
            body,
            mutationId: headers?.['risu-mutation-id'] ?? null,
          })
          if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 503)
          nextRevision += 1
          if (path === '/characters/char-a/chats') {
            return jsonResponse({
              revision: nextRevision,
              event: {
                type: 'chat.created',
                revision: nextRevision,
                resource: 'chatTranscript',
                id: 'chat-created-queued',
                parentId: 'char-a',
              },
              chatId: 'chat-created-queued',
              selectedChatId: 'chat-created-queued',
              generationSettings: null,
            })
          }
          return jsonResponse({
            revision: nextRevision,
            event: {
              type: 'message.created',
              revision: nextRevision,
              resource: 'message',
              id: 'message-after-create',
              parentId: 'chat-created-queued',
            },
            chatId: 'chat-created-queued',
            messageId: 'message-after-create',
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      dispatchCreateChat('char-a', createdChat, previous)
      await vi.waitFor(() => expect(commandCalls).toHaveLength(1))

      const appendPrevious = currentChatStateSnapshot()
      const message = {
        role: 'user',
        data: 'after retained create',
        chatId: 'message-after-create',
        time: 555,
      } as Message
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].message.push(message)
      })
      dispatchAppendMessage('chat-created-queued', message, appendPrevious)

      await vi.waitFor(() => expect(commandCalls).toHaveLength(2))
      expect(commandCalls.map((call) => call.path)).toEqual(['/characters/char-a/chats', '/characters/char-a/chats'])
      expect(commandCalls[1].mutationId).toBe(commandCalls[0].mutationId)

      const pending = await listPendingMutations()
      expect(pending.map((entry) => entry.handle.key)).toEqual(['character-owner:char-a', 'character-owner:char-a'])
      expect(pending.map((entry) => entry.intent.requests[0])).toEqual([
        {
          method: 'POST',
          path: '/characters/char-a/chats',
          body: { chat: createdChat, select: true },
        },
        {
          method: 'POST',
          path: '/chats/chat-created-queued/messages',
          body: { message },
        },
      ])

      recover = true
      const replayStart = commandCalls.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2, retained: 0 })
      expect(commandCalls.slice(replayStart).map((call) => call.path)).toEqual([
        '/characters/char-a/chats',
        '/chats/chat-created-queued/messages',
      ])
      expect(await listPendingMutations()).toEqual([])
      expect(getDatabase().characters[0].chats[0].message).toEqual([message])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
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
          withTrustedResourceWrite(() => {
            getDatabase().characters[0].chats[0].message.push({
              role: 'char',
              data: 'concurrent same-chat message',
              chatId: 'msg-concurrent',
            })
            getDatabase().characters[0].chats[1].name = 'Concurrent sibling edit'
          })
          return jsonResponse({ error: 'nope' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    setResourceWriteGuardEnabled(true)

    expect(setChatScriptstateValue('chat-a', '$score', 'failed')).toBe(true)
    expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({ $score: 'failed', $old: 'gone' })

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({ $score: '1', $old: 'gone' })
    })
    expect(getDatabase().characters[0].chats[0].message).toEqual([
      {
        role: 'char',
        data: 'concurrent same-chat message',
        chatId: 'msg-concurrent',
      },
    ])
    expect(getDatabase().characters[0].chats[1].name).toBe('Concurrent sibling edit')
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
          withTrustedResourceWrite(() => {
            getDatabase().characters[0].chats[0].message.push({
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
    setResourceWriteGuardEnabled(true)
    seedReadyActiveChatGenerationSettings()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].message.push({
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
    expect(getDatabase().characters[0].chats[0].message).toEqual([
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
          withTrustedResourceWrite(() => {
            const character = getDatabase().characters[0]
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
    setResourceWriteGuardEnabled(true)
    seedReadyActiveChatGenerationSettings()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[1].message.push({
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
    expect(getDatabase().characters[0].chats).toHaveLength(1)
    expect(getDatabase().characters[0].chats[0]).toMatchObject({
      id: 'chat-b',
      message: [{ role: 'char', data: 'same id on active sibling', chatId: 'm-shared' }],
    })
  })
})

describe('Phase 0 chat-scoped snapshot kit', () => {
  it('captures only the active chat, never the whole characters array', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)

    const snapshot = currentChatScopedSnapshot()

    expect(snapshot.characterId).toBe('char-0')
    expect(snapshot.chatId).toBe('chat-0')
    expect(snapshot.selectedCharID).toBe(0)
    expect(snapshot.chat?.message).toHaveLength(40)
    expect(snapshot).not.toHaveProperty('characters')
    assertSnapshotOmitsCollections(snapshot)

    const charactersSize = JSON.stringify(getDatabase().characters).length
    const instrumented = withCloneInstrumentation(() => currentChatScopedSnapshot())
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
  })

  it('restores only the active chat, preserving concurrent edits to other chats', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => currentChatScopedSnapshot(),
      mutate: () => {
        getDatabase().characters[0].chats[0].message.push({
          role: 'char',
          data: 'optimistic',
          chatId: 'msg-extra',
        })
        // an unrelated, concurrent edit to a different character's chat
        getDatabase().characters[1].chats[0].note = 'sibling concurrent note'
      },
      expectMutated: () => {
        expect(getDatabase().characters[0].chats[0].message).toHaveLength(41)
      },
      restore: (snapshot) => restoreChatScopedState(snapshot),
      expectRestored: () => {
        expect(getDatabase().characters[0].chats[0].message).toHaveLength(40)
      },
      expectUntouched: () => {
        expect(getDatabase().characters[1].chats[0].note).toBe('sibling concurrent note')
      },
    })
  })

  it('restores the chat by stable id even when its character index has shifted', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)
    const snapshot = currentChatScopedSnapshot()

    getDatabase().characters[0].chats[0].message.push({
      role: 'char',
      data: 'optimistic',
      chatId: 'msg-extra',
    })
    getDatabase().characters.unshift({ chaId: 'char-new', name: 'Inserted', chats: [] } as any)

    restoreChatScopedState(snapshot)

    const restored = getDatabase().characters.find((c: any) => c.chaId === 'char-0')
    expect(restored.chats[0].message).toHaveLength(40)
  })
})

describe('Phase 0 chat-scriptstate snapshot kit', () => {
  it('captures only the scriptstate map and an optional note, never a chat or the collection', () => {
    setDatabaseLite(seedCloneCostDb() as any)
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
    getDatabase().characters[0].chats[0].scriptstate.$score = '99'
    expect(snapshot.scriptstate?.$score).toBe('0')
  })

  it('restores scriptstate and note only, preserving concurrent message edits on the same chat', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => currentChatScriptstateSnapshot(true),
      mutate: () => {
        getDatabase().characters[0].chats[0].scriptstate = { $score: 'optimistic' }
        getDatabase().characters[0].chats[0].note = 'optimistic note'
        // a concurrent, unrelated edit to the same chat's message history
        getDatabase().characters[0].chats[0].message.push({
          role: 'char',
          data: 'concurrent',
          chatId: 'msg-concurrent',
        })
      },
      expectMutated: () => {
        expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({ $score: 'optimistic' })
      },
      restore: (snapshot) => restoreChatScriptstate(snapshot),
      expectRestored: () => {
        expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({
          $score: '0',
          $old: 'gone',
        })
        expect(getDatabase().characters[0].chats[0].note).toBe('note-0')
      },
      expectUntouched: () => {
        // a whole-chat restore would have wiped this concurrent message
        expect(getDatabase().characters[0].chats[0].message).toHaveLength(41)
      },
    })
  })
})

// Chat selection rollback restores only `chatPage`, not the full character collection.
describe('H2 chat-selection snapshot', () => {
  it('captures only selection scalars and performs zero clone work', () => {
    setDatabaseLite(seedCloneCostDb() as any)
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
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => currentChatSelectionSnapshot(),
      mutate: () => {
        // the optimistic select write
        getDatabase().characters[0].chatPage = 1
        // concurrent, unrelated edits a whole-array restore would wipe
        getDatabase().characters[0].chats[0].message.push({
          role: 'char',
          data: 'concurrent',
          chatId: 'msg-concurrent',
        })
        getDatabase().characters[1].chats[0].note = 'sibling concurrent note'
        // a concurrent character switch the rollback must not undo
        selectedCharID.set(1)
      },
      expectMutated: () => {
        expect(getDatabase().characters[0].chatPage).toBe(1)
      },
      restore: (snapshot) => restoreChatSelection(snapshot),
      expectRestored: () => {
        expect(getDatabase().characters[0].chatPage).toBe(0)
      },
      expectUntouched: () => {
        expect(getDatabase().characters[0].chats[0].message).toHaveLength(41)
        expect(getDatabase().characters[1].chats[0].note).toBe('sibling concurrent note')
        // chat select never mutates the character selection; restore must not
        // re-write it either (it only locates the row by it)
        expect(get(selectedCharID)).toBe(1)
      },
    })
  })

  it('restores chatPage by stable chaId even when the character index shifted', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)
    const snapshot = currentChatSelectionSnapshot()

    getDatabase().characters[0].chatPage = 1
    getDatabase().characters.unshift({
      chaId: 'char-new',
      name: 'Inserted',
      chatPage: 9,
      chats: [],
    } as any)

    restoreChatSelection(snapshot)

    expect(getDatabase().characters.find((c: any) => c.chaId === 'char-0').chatPage).toBe(0)
    // the character now sitting at the stale index is untouched
    expect(getDatabase().characters[0].chatPage).toBe(9)
  })

  it('dispatchSelectChat sends the empty-patch select command', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

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

  it('dispatchUpdateChatAsync resolves a failure only after metadata rollback', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
    })
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].bindedPersona = 'persona-old'
    })

    const previous = currentChatStateSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].bindedPersona = ''
    })

    const resultPromise = dispatchUpdateChatAsync('chat-a', { bindedPersona: '' }, previous)
    expect(resultPromise).toBeTruthy()
    expect(getDatabase().characters[0].chats[0].bindedPersona).toBe('')

    const result = await resultPromise

    expect(calls).toHaveLength(2)
    expect(result?.status).toBe('error')
    expect(getDatabase().characters[0].chats[0].bindedPersona).toBe('persona-old')
  })

  it('dispatchSelectChat optimistically updates chatPage before the PATCH resolves', async () => {
    const calls = stubCommandFetch()
    setResourceWriteGuardEnabled(true)

    dispatchSelectChat('chat-b', currentChatSelectionSnapshot())

    expect(getDatabase().characters[0].chatPage).toBe(1)
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
    setResourceWriteGuardEnabled(true)

    dispatchSelectChat('chat-b', currentChatSelectionSnapshot())

    expect(getDatabase().characters[0].chatPage).toBe(1)
    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatPage).toBe(0)
    })
  })

  it('dispatchSelectChat does not roll a newer chat selection back to an older page', async () => {
    getDatabase().characters[0].chats.push({ id: 'chat-c', name: 'Chat C', message: [] } as any)
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-b' && init.method === 'PATCH',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chatPage = 2
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    dispatchSelectChat('chat-b', currentChatSelectionSnapshot())

    expect(getDatabase().characters[0].chatPage).toBe(1)
    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatPage).toBe(2)
    })
  })
})

describe('Phase 5 chat metadata dispatch rollback', () => {
  it('restores the original folder name when overlapping broad folder updates both fail', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chat-folders/folder-a' && init.method === 'PATCH',
    })
    setResourceWriteGuardEnabled(true)

    const firstPrevious = currentChatStateSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders[0].name = 'First folder rename'
    })
    dispatchUpdateChatFolder('folder-a', { name: 'First folder rename' }, firstPrevious)

    const secondPrevious = currentChatStateSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders[0].name = 'Second folder rename'
    })
    dispatchUpdateChatFolder('folder-a', { name: 'Second folder rename' }, secondPrevious)

    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatFolders[0].name).toBe('Folder')
    })
  })

  it('restores the original folder color when overlapping row folder updates both fail', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chat-folders/folder-a' && init.method === 'PATCH',
    })
    setResourceWriteGuardEnabled(true)

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders[0].color = 'blue'
    })
    dispatchUpdateChatFolderRow(
      'folder-a',
      { color: 'blue' },
      {
        selectedCharID: 0,
        characterId: 'char-a',
        folderId: 'folder-a',
        metadata: {},
      },
    )

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders[0].color = 'red'
    })
    dispatchUpdateChatFolderRow(
      'folder-a',
      { color: 'red' },
      {
        selectedCharID: 0,
        characterId: 'char-a',
        folderId: 'folder-a',
        metadata: { color: 'blue' },
      },
    )

    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatFolders[0].color).toBeUndefined()
    })
  })

  it('restores the original chat name when overlapping broad updates both fail', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
    })
    setResourceWriteGuardEnabled(true)

    const firstPrevious = currentChatStateSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].name = 'First rename'
    })
    dispatchUpdateChat('chat-a', { name: 'First rename' }, firstPrevious)

    const secondPrevious = currentChatStateSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].name = 'Second rename'
    })
    dispatchUpdateChat('chat-a', { name: 'Second rename' }, secondPrevious)

    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].name).toBe('Chat A')
    })
  })

  it('restores the original suggestions when overlapping row updates both fail', async () => {
    getDatabase().characters[0].chats[0].suggestMessages = ['Old suggestion']
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
    })
    setResourceWriteGuardEnabled(true)

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].suggestMessages = []
    })
    dispatchUpdateChatRow(
      'chat-a',
      { suggestMessages: [] },
      {
        selectedCharID: 0,
        characterId: 'char-a',
        chatId: 'chat-a',
        metadata: { suggestMessages: ['Old suggestion'] },
      },
    )

    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].suggestMessages = ['New suggestion']
    })
    dispatchUpdateChatRow(
      'chat-a',
      { suggestMessages: ['New suggestion'] },
      {
        selectedCharID: 0,
        characterId: 'char-a',
        chatId: 'chat-a',
        metadata: { suggestMessages: [] },
      },
    )

    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].suggestMessages).toEqual(['Old suggestion'])
    })
  })

  it('restores the original bookmark state when overlapping scoped updates both fail', async () => {
    getDatabase().characters[0].chats[0].bookmarks = []
    getDatabase().characters[0].chats[0].bookmarkNames = {}
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
    })
    setResourceWriteGuardEnabled(true)

    const firstPrevious = currentChatScopedSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].bookmarks = ['msg-one']
      getDatabase().characters[0].chats[0].bookmarkNames = { 'msg-one': 'One' }
    })
    dispatchUpdateChatScoped('chat-a', { bookmarks: ['msg-one'], bookmarkNames: { 'msg-one': 'One' } }, firstPrevious)

    const secondPrevious = currentChatScopedSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].bookmarks = ['msg-one', 'msg-two']
      getDatabase().characters[0].chats[0].bookmarkNames = { 'msg-one': 'One', 'msg-two': 'Two' }
    })
    dispatchUpdateChatScoped(
      'chat-a',
      {
        bookmarks: ['msg-one', 'msg-two'],
        bookmarkNames: { 'msg-one': 'One', 'msg-two': 'Two' },
      },
      secondPrevious,
    )

    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].bookmarks).toEqual([])
      expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({})
    })
  })

  it('failed scoped metadata updates roll back only attempted fields that have not changed again', async () => {
    getDatabase().characters[0].chats[0].bookmarks = ['msg-old']
    getDatabase().characters[0].chats[0].bookmarkNames = { 'msg-old': 'Old bookmark' }
    getDatabase().characters[0].chats[0].note = 'old note'
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          const chat = getDatabase().characters[0].chats[0]
          chat.bookmarkNames = { 'msg-newer': 'Newer bookmark' }
          chat.note = 'newer note'
          chat.message.push({ role: 'user', data: 'newer message', chatId: 'msg-newer' })
          getDatabase().characters[0].chats[1].name = 'newer sibling name'
        })
      },
    })
    setResourceWriteGuardEnabled(true)
    const previous = currentChatScopedSnapshot()
    const attemptedBookmarks = ['msg-attempted']
    const attemptedBookmarkNames = { 'msg-attempted': 'Attempted bookmark' }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].bookmarks = jsonClone(attemptedBookmarks)
      getDatabase().characters[0].chats[0].bookmarkNames = jsonClone(attemptedBookmarkNames)
    })

    const mutation = dispatchUpdateChatScopedWithOutcome(
      'chat-a',
      { bookmarks: attemptedBookmarks, bookmarkNames: attemptedBookmarkNames },
      previous,
    )

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['msg-old'])
    })
    await expect(mutation).resolves.toMatchObject({ status: 'failed' })
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'msg-newer': 'Newer bookmark' })
    expect(getDatabase().characters[0].chats[0].note).toBe('newer note')
    expect(getDatabase().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'newer message', chatId: 'msg-newer' },
    ])
    expect(getDatabase().characters[0].chats[1].name).toBe('newer sibling name')
  })

  it('failed chat rename restores only attempted name and preserves sibling edits, folders, and selection', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[1].name = 'Newer sibling name'
          getDatabase().characters[0].chatFolders[0].name = 'Newer folder name'
          getDatabase().characters[0].chatPage = 1
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].name = 'Attempted rename'
    })

    dispatchUpdateChat('chat-a', { name: 'Attempted rename' }, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].name).toBe('Chat A')
    })
    expect(getDatabase().characters[0].chats[1].name).toBe('Newer sibling name')
    expect(getDatabase().characters[0].chatFolders[0].name).toBe('Newer folder name')
    expect(getDatabase().characters[0].chatPage).toBe(1)
  })

  it('failed chat rename skips rollback when the live name changed after dispatch', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[0].name = 'Newer live rename'
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].name = 'Attempted rename'
    })

    dispatchUpdateChat('chat-a', { name: 'Attempted rename' }, previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].name).toBe('Newer live rename')
    })
  })

  it('failed multi-key metadata patch rolls back only keys still matching the attempted values', async () => {
    getDatabase().characters[0].chats[0].bookmarks = ['msg-old']
    getDatabase().characters[0].chats[0].bookmarkNames = { 'msg-old': 'Old bookmark' }

    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[0].bookmarkNames = { 'msg-newer': 'Newer bookmark' }
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    const attemptedBookmarks = ['msg-new']
    const attemptedBookmarkNames: Record<string, string> = { 'msg-new': 'New bookmark' }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].bookmarks = jsonClone(attemptedBookmarks)
      getDatabase().characters[0].chats[0].bookmarkNames = jsonClone(attemptedBookmarkNames)
    })

    dispatchUpdateChat(
      'chat-a',
      {
        bookmarks: attemptedBookmarks,
        bookmarkNames: attemptedBookmarkNames,
      },
      previous,
    )
    attemptedBookmarks.push('msg-mutated')
    attemptedBookmarkNames['msg-new'] = 'Mutated later'

    await waitForCallCount(calls, 2)
    expect(calls[1].body).toMatchObject({
      patch: {
        bookmarks: ['msg-new'],
        bookmarkNames: { 'msg-new': 'New bookmark' },
      },
    })
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['msg-old'])
    })
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'msg-newer': 'Newer bookmark' })
  })

  it('failed empty-patch select dispatch does not restore chat metadata or selection', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
      onCommand: () => {
        withTrustedResourceWrite(() => {
          getDatabase().characters[0].chats[1].name = 'Newer sibling name'
          getDatabase().characters[0].chatPage = 1
        })
      },
    })
    setResourceWriteGuardEnabled(true)

    const previous = currentChatStateSnapshot()
    dispatchUpdateChat('chat-a', {}, previous, true)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chatPage).toBe(1)
    })
    expect(getDatabase().characters[0].chats[1].name).toBe('Newer sibling name')
  })
})

describe('Phase 2 chat-metadata-row rollback', () => {
  function scalarMetadata(chatIndex: number): ChatSnapshot {
    const chat = getDatabase().characters[0].chats[chatIndex] as unknown as Record<string, unknown>
    const metadata: Record<string, unknown> = {}
    // mirror the watcher's allowed scalar metadata keys for the seeded fields
    for (const key of ['name', 'note', 'folderId', 'bindedPersona'] as const) {
      if (chat[key] !== undefined) metadata[key] = chat[key]
    }
    return metadata as ChatSnapshot
  }

  it('restores only the one chat row, preserving message history and unrelated chats', () => {
    setDatabaseLite(seedCloneCostDb() as any)
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
        getDatabase().characters[0].chats[0].name = 'Optimistic Name'
        // unrelated concurrent edits a whole-array restore would have clobbered
        getDatabase().characters[0].chats[0].message.push({
          role: 'char',
          data: 'concurrent',
          chatId: 'msg-concurrent',
        })
        getDatabase().characters[1].chats[0].note = 'sibling concurrent note'
      },
      expectMutated: () => {
        expect(getDatabase().characters[0].chats[0].name).toBe('Optimistic Name')
      },
      restore: (snapshot) => restoreChatRowMetadata(snapshot),
      expectRestored: () => {
        expect(getDatabase().characters[0].chats[0].name).toBe('Chat 0')
      },
      expectUntouched: () => {
        expect(getDatabase().characters[0].chats[0].message).toHaveLength(41)
        expect(getDatabase().characters[1].chats[0].note).toBe('sibling concurrent note')
      },
    })
  })

  it('drops an allowed key the optimistic change added but the baseline lacked', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)
    // baseline has no bindedPersona
    const snapshot = {
      selectedCharID: 0,
      characterId: 'char-0',
      chatId: 'chat-0',
      metadata: scalarMetadata(0),
    }
    expect(snapshot.metadata).not.toHaveProperty('bindedPersona')

    getDatabase().characters[0].chats[0].bindedPersona = 'persona-x'
    restoreChatRowMetadata(snapshot)

    expect(getDatabase().characters[0].chats[0].bindedPersona).toBeUndefined()
  })

  it('does not restore attempted chat metadata after a newer same-row edit', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)
    const snapshot = {
      selectedCharID: 0,
      characterId: 'char-0',
      chatId: 'chat-0',
      metadata: scalarMetadata(0),
      attempted: { name: 'Optimistic Name' },
    }

    getDatabase().characters[0].chats[0].name = 'Newer local name'
    restoreChatRowMetadata(snapshot)

    expect(getDatabase().characters[0].chats[0].name).toBe('Newer local name')
  })

  it('drops attempted metadata missing from the baseline without clobbering newer fields', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    selectedCharID.set(0)
    const snapshot = {
      selectedCharID: 0,
      characterId: 'char-0',
      chatId: 'chat-0',
      metadata: scalarMetadata(0),
      attempted: { name: 'Optimistic Name', bindedPersona: 'persona-x' },
    }
    expect(snapshot.metadata).not.toHaveProperty('bindedPersona')

    getDatabase().characters[0].chats[0].name = 'Newer local name'
    getDatabase().characters[0].chats[0].bindedPersona = 'persona-x'
    restoreChatRowMetadata(snapshot)

    expect(getDatabase().characters[0].chats[0].name).toBe('Newer local name')
    expect(getDatabase().characters[0].chats[0].bindedPersona).toBeUndefined()
  })

  it('restores only the one folder row by stable id', () => {
    setDatabaseLite(seedCloneCostDb() as any)
    getDatabase().characters[0].chatFolders = [{ id: 'folder-0', name: 'Folder Zero', color: '#111', folded: false }]
    getDatabase().characters[1].chatFolders = [{ id: 'folder-1', name: 'Folder One', color: '#222', folded: false }]
    selectedCharID.set(0)

    assertRollbackRestoresOnly({
      capture: () => ({
        selectedCharID: 0,
        characterId: 'char-0',
        folderId: 'folder-0',
        metadata: { name: 'Folder Zero', color: '#111', folded: false } as ChatFolderSnapshot,
      }),
      mutate: () => {
        getDatabase().characters[0].chatFolders[0].folded = true
        getDatabase().characters[0].chatFolders[0].name = 'Optimistic Folder'
        getDatabase().characters[1].chatFolders[0].name = 'Sibling Folder Edit'
      },
      expectMutated: () => {
        expect(getDatabase().characters[0].chatFolders[0].folded).toBe(true)
      },
      restore: (snapshot) => restoreChatFolderRowMetadata(snapshot),
      expectRestored: () => {
        expect(getDatabase().characters[0].chatFolders[0]).toMatchObject({
          name: 'Folder Zero',
          color: '#111',
          folded: false,
        })
      },
      expectUntouched: () => {
        expect(getDatabase().characters[1].chatFolders[0].name).toBe('Sibling Folder Edit')
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
    getDatabase().characters.push({
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
    getDatabase().characters[0].chats[0].message = jsonClone(attemptedMessages)
    getDatabase().characters[0].chats[0].note = 'same chat concurrent note'
    getDatabase().characters[0].chats[0].localLore = [
      {
        id: 'lore-live',
        key: 'live',
        content: 'keep me',
      },
    ] as any
    getDatabase().characters[0].chats[0].scriptstate = {
      $score: 'newer',
    }
    getDatabase().characters[0].chats[1].message.push({
      role: 'char',
      data: 'same character sibling',
      chatId: 'm-sibling',
    })
    getDatabase().characters[1].chats[0].note = 'sibling concurrent'

    dispatchReplaceMessagesScoped('chat-a', attemptedMessages, scoped)
    await waitForCallCount(calls, 2)

    // only the active chat's message array is restored
    expect(getDatabase().characters[0].chats[0].message).toEqual([])
    expect(getDatabase().characters[0].chats[0].note).toBe('same chat concurrent note')
    expect(getDatabase().characters[0].chats[0].localLore).toEqual([
      {
        id: 'lore-live',
        key: 'live',
        content: 'keep me',
      },
    ])
    expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({ $score: 'newer' })
    expect(getDatabase().characters[0].chats[1].message).toEqual([
      {
        role: 'char',
        data: 'same character sibling',
        chatId: 'm-sibling',
      },
    ])
    expect(getDatabase().characters[1].chats[0].note).toBe('sibling concurrent')
  })

  it('persists a fully hydrated user append with appendMessageCommand', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousChat: Chat = {
      ...jsonClone(getDatabase().characters[0].chats[0]),
      message: [{ role: 'user', data: 'before', chatId: 'm-before' }],
    }
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat = jsonClone(previousChat)
    nextChat.message.push({ role: 'char', data: 'new reply', time: 123 })
    getDatabase().characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(1)
    prepared.dispatch()

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/messages',
      method: 'POST',
      body: {
        baseRevision: 10,
        message: {
          role: 'char',
          data: 'new reply',
          time: 123,
          chatId: expect.any(String),
        },
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/messages' && call.method === 'PUT')).toBe(
      false,
    )
  })

  it('persists a fully hydrated single message edit with updateMessageCommand', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousChat: Chat = {
      ...jsonClone(getDatabase().characters[0].chats[0]),
      message: [
        { role: 'user', data: 'before', chatId: 'm-before', time: 1 },
        { role: 'char', data: 'unchanged', chatId: 'm-unchanged', time: 2 },
      ],
    }
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat = jsonClone(previousChat)
    nextChat.message[0].data = 'after'
    nextChat.message[0].translation = { display: 'translated' } as any
    getDatabase().characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(1)
    prepared.dispatch()

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/messages/m-before',
      method: 'PATCH',
      body: {
        baseRevision: 10,
        patch: {
          data: 'after',
          translation: { display: 'translated' },
        },
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/messages' && call.method === 'PUT')).toBe(
      false,
    )
  })

  it('persists a fully hydrated middle delete with deleteMessageCommand', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousChat: Chat = {
      ...jsonClone(getDatabase().characters[0].chats[0]),
      message: [
        { role: 'user', data: 'one', chatId: 'm-1' },
        { role: 'char', data: 'two', chatId: 'm-2' },
        { role: 'user', data: 'three', chatId: 'm-3' },
      ],
    }
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat = {
      ...jsonClone(previousChat),
      message: [jsonClone(previousChat.message[0]), jsonClone(previousChat.message[2])],
    }
    getDatabase().characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(1)
    prepared.dispatch()

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/messages/m-2',
      method: 'DELETE',
      body: {
        baseRevision: 10,
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/messages' && call.method === 'PUT')).toBe(
      false,
    )
  })

  it('persists a fully hydrated suffix delete with truncateMessagesCommand', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousChat: Chat = {
      ...jsonClone(getDatabase().characters[0].chats[0]),
      message: [
        { role: 'user', data: 'one', chatId: 'm-1' },
        { role: 'char', data: 'two', chatId: 'm-2' },
        { role: 'user', data: 'three', chatId: 'm-3' },
      ],
    }
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat = {
      ...jsonClone(previousChat),
      message: [jsonClone(previousChat.message[0])],
    }
    getDatabase().characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(1)
    prepared.dispatch()

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/messages/truncate',
      method: 'POST',
      body: {
        baseRevision: 10,
        afterMessageId: 'm-1',
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/messages' && call.method === 'PUT')).toBe(
      false,
    )
  })

  it('persists a fully hydrated tail rewrite with replaceTailMessagesCommand', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousChat: Chat = {
      ...jsonClone(getDatabase().characters[0].chats[0]),
      message: [
        { role: 'user', data: 'anchor', chatId: 'm-anchor' },
        { role: 'char', data: 'old one', chatId: 'm-old-1' },
        { role: 'user', data: 'old two', chatId: 'm-old-2' },
      ],
    }
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat: Chat = {
      ...jsonClone(previousChat),
      message: [
        { role: 'user', data: 'anchor', chatId: 'm-anchor' },
        { role: 'char', data: 'replacement' },
      ],
    }
    getDatabase().characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(1)
    prepared.dispatch()

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/messages/tail',
      method: 'POST',
      body: {
        baseRevision: 10,
        afterMessageId: 'm-anchor',
        messages: [
          {
            role: 'char',
            data: 'replacement',
            chatId: expect.any(String),
          },
        ],
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/messages' && call.method === 'PUT')).toBe(
      false,
    )
  })

  it('persists a placeholder-prefix AOS-style user append with appendMessageCommand', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousChat: Chat = {
      ...jsonClone(getDatabase().characters[0].chats[0]),
      message: [
        serverMessagePlaceholder(),
        serverMessagePlaceholder(),
        { role: 'user', data: 'known user tail', chatId: 'm-tail-user' },
        { role: 'char', data: 'known char tail', chatId: 'm-tail-char' },
      ],
    }
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat = jsonClone(previousChat)
    nextChat.message.push({
      role: 'user',
      data: 'Selected AOS choice',
      time: 123,
    })
    getDatabase().characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(1)
    prepared.dispatch()

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/messages',
      method: 'POST',
      body: {
        baseRevision: 10,
        message: {
          role: 'user',
          data: 'Selected AOS choice',
          time: 123,
          chatId: expect.any(String),
        },
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/messages' && call.method === 'PUT')).toBe(
      false,
    )
  })

  it('persists a placeholder-prefix tail suffix replacement after a known message anchor', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousChat: Chat = {
      ...jsonClone(getDatabase().characters[0].chats[0]),
      message: [
        serverMessagePlaceholder(),
        serverMessagePlaceholder(),
        { role: 'user', data: 'known anchor', chatId: 'm-anchor' },
        { role: 'char', data: 'old tail', chatId: 'm-old-tail' },
      ],
    }
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat: Chat = {
      ...jsonClone(previousChat),
      message: [
        serverMessagePlaceholder(),
        serverMessagePlaceholder(),
        { role: 'user', data: 'known anchor', chatId: 'm-anchor' },
        { role: 'char', data: 'replacement tail' },
      ],
    }
    getDatabase().characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)
    expect(prepared.commandCount).toBe(1)
    prepared.dispatch()

    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/messages/tail',
      method: 'POST',
      body: {
        baseRevision: 10,
        afterMessageId: 'm-anchor',
        messages: [
          {
            role: 'char',
            data: 'replacement tail',
            chatId: expect.any(String),
          },
        ],
      },
    })
    expect(calls.some((call) => call.url === '/api/v1/commands/chats/chat-a/messages' && call.method === 'PUT')).toBe(
      false,
    )
  })

  it('rolls back unsafe placeholder-containing message edits instead of leaving an unpersisted projection', () => {
    const previousChat: Chat = {
      ...jsonClone(getDatabase().characters[0].chats[0]),
      message: [
        serverMessagePlaceholder(),
        { role: 'user', data: 'known anchor', chatId: 'm-anchor' },
        { role: 'char', data: 'known tail', chatId: 'm-tail' },
      ],
    }
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat = jsonClone(previousChat)
    nextChat.message[0] = {
      ...serverMessagePlaceholder(),
      data: 'unsafe local placeholder edit',
    }
    getDatabase().characters[0].chats[0] = nextChat

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)

    expect(prepared.commandCount).toBe(0)
    prepared.dispatch()
    expect(getDatabase().characters[0].chats[0].message).toEqual(previousChat.message)
  })

  it('P5: scoped compatible chat preparation preserves accepted metadata when message persistence fails', async () => {
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
        if (url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH') {
          return jsonResponse({
            revision: 11,
            event: { type: 'chat.updated', revision: 11, resource: 'chat', id: 'chat-a' },
            selectedChatId: 'chat-a',
          })
        }
        if (url === '/api/v1/commands/chats/chat-a/messages' && init.method === 'PUT') {
          return jsonResponse({ error: 'message replace failed' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    const previousChat = jsonClone(getDatabase().characters[0].chats[0])
    previousChat.message = [{ role: 'user', data: 'before', chatId: 'm-before' }]
    getDatabase().characters[0].chats[0] = jsonClone(previousChat)
    const previous = currentChatScopedSnapshot()
    const nextChat: Chat = {
      ...jsonClone(previousChat),
      name: 'Accepted name',
      message: [{ role: 'char', data: 'attempted', chatId: 'm-attempted' }],
    }

    getDatabase().characters[0].chats[0] = jsonClone(nextChat)

    const prepared = prepareCompatibleChatUpdateScoped(previousChat, nextChat, previous)
    prepared.dispatch()
    await waitForCallCount(calls, 3)

    expect(getDatabase().characters[0].chats[0].name).toBe('Accepted name')
    expect(getDatabase().characters[0].chats[0].message).toEqual([{ role: 'user', data: 'before', chatId: 'm-before' }])
  })
})

describe('Phase 4 chat-scoped message attempt rollback', () => {
  function seedActiveMessages(messages: Message[]): void {
    getDatabase().characters[0].chats[0].message = jsonClone(messages)
  }

  it('restores the original message field when overlapping scoped updates both fail', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/messages/m-1' && init.method === 'PATCH',
    })
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    setResourceWriteGuardEnabled(true)

    const firstPrevious = currentChatScopedSnapshot()
    dispatchUpdateMessageScoped('m-1', { data: 'first edit' }, firstPrevious)
    const secondPrevious = currentChatScopedSnapshot()
    dispatchUpdateMessageScoped('m-1', { data: 'second edit' }, secondPrevious)

    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('second edit')
    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message[0].data).toBe('before')
    })
  })

  it('keeps a duplicate stale-snapshot patch when the first request succeeds and the second fails', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledMessagePatchFetch()
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    setResourceWriteGuardEnabled(true)

    const stalePrevious = currentChatScopedSnapshot()
    dispatchUpdateMessageScoped('m-1', { data: 'same' }, stalePrevious)
    dispatchUpdateMessageScoped('m-1', { data: 'same' }, stalePrevious)

    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('same')
    await waitForCallCount(calls, 2)
    firstResponse.resolve(successfulMessagePatchResponse(11))
    await waitForCallCount(calls, 3)
    secondResponse.resolve(jsonResponse({ error: 'second patch failed' }, 500))

    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message[0].data).toBe('same')
    })
    expect(calls.slice(1).map((call) => call.body)).toEqual([
      expect.objectContaining({ patch: { data: 'same' } }),
      expect.objectContaining({ patch: { data: 'same' } }),
    ])
  })

  it('repaints a duplicate stale-snapshot patch when the first request fails and the second succeeds', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledMessagePatchFetch()
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    setResourceWriteGuardEnabled(true)

    const stalePrevious = currentChatScopedSnapshot()
    dispatchUpdateMessageScoped('m-1', { data: 'same' }, stalePrevious)
    dispatchUpdateMessageScoped('m-1', { data: 'same' }, stalePrevious)

    await waitForCallCount(calls, 2)
    firstResponse.resolve(jsonResponse({ error: 'first patch failed' }, 500))
    await waitForCallCount(calls, 3)
    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('same')
    secondResponse.resolve(successfulMessagePatchResponse(11))

    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message[0].data).toBe('same')
    })
  })

  it('retains an optimistic edit while its transport is still queued', async () => {
    const { calls, firstResponse, secondResponse } = stubControlledMessagePatchFetch()
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    setResourceWriteGuardEnabled(true)

    dispatchUpdateMessageScoped('m-1', { data: 'first edit' }, currentChatScopedSnapshot())
    await waitForCallCount(calls, 2)
    dispatchUpdateMessageScoped('m-1', { data: 'queued edit' }, currentChatScopedSnapshot())

    expect(calls).toHaveLength(2)
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].message = [{ role: 'char', data: 'before', chatId: 'm-1' }]
    })
    reapplyRetainedChatBodyProjections('chat-a')

    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('queued edit')

    firstResponse.resolve(successfulMessagePatchResponse(11))
    await waitForCallCount(calls, 3)
    secondResponse.resolve(successfulMessagePatchResponse(12))
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message[0].data).toBe('queued edit')
    })
  })

  it('rolls back a caller-owned pre-applied scoped message patch', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/messages/m-1' && init.method === 'PATCH',
    })
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()
    setResourceWriteGuardEnabled(true)
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].message[0].data = 'pre-applied'
    })

    dispatchUpdateMessageScoped('m-1', { data: 'pre-applied' }, previous, {
      optimisticPatchAlreadyApplied: true,
    })

    await waitForCallCount(calls, 2)
    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('before')
  })

  it('restores the original transcript when overlapping scoped deletes both fail', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url.startsWith('/api/v1/commands/messages/') && init.method === 'DELETE',
    })
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
      { role: 'user', data: 'three', chatId: 'm-3' },
    ]
    seedActiveMessages(previousMessages)
    setResourceWriteGuardEnabled(true)

    const firstPrevious = currentChatScopedSnapshot()
    dispatchDeleteMessageScoped('m-1', firstPrevious)
    const secondPrevious = currentChatScopedSnapshot()
    dispatchDeleteMessageScoped('m-2', secondPrevious)

    expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[2]])
    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message).toEqual(previousMessages)
    })
  })

  it('restores a patched message when a later scoped delete also fails', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) =>
        url === '/api/v1/commands/messages/m-1' && (init.method === 'PATCH' || init.method === 'DELETE'),
    })
    const previousMessages: Message[] = [{ role: 'char', data: 'before', chatId: 'm-1' }]
    seedActiveMessages(previousMessages)
    setResourceWriteGuardEnabled(true)

    dispatchUpdateMessageScoped('m-1', { data: 'after' }, currentChatScopedSnapshot())
    dispatchDeleteMessageScoped('m-1', currentChatScopedSnapshot())

    expect(getDatabase().characters[0].chats[0].message).toEqual([])
    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message).toEqual(previousMessages)
    })
  })

  it('restores a deleted message when a later scoped patch also fails', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) =>
        url.startsWith('/api/v1/commands/messages/') && (init.method === 'PATCH' || init.method === 'DELETE'),
    })
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
    ]
    seedActiveMessages(previousMessages)
    setResourceWriteGuardEnabled(true)

    dispatchDeleteMessageScoped('m-1', currentChatScopedSnapshot())
    dispatchUpdateMessageScoped('m-2', { data: 'changed' }, currentChatScopedSnapshot())

    expect(getDatabase().characters[0].chats[0].message).toEqual([{ role: 'char', data: 'changed', chatId: 'm-2' }])
    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message).toEqual(previousMessages)
    })
  })

  it('preserves a newer unpatched field when a safe patch and later delete both fail', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) =>
        url.startsWith('/api/v1/commands/messages/') && (init.method === 'PATCH' || init.method === 'DELETE'),
    })
    const initialMessages: Message[] = [
      { role: 'user', data: 'before', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
    ]
    seedActiveMessages(initialMessages)
    setResourceWriteGuardEnabled(true)

    const stalePatchSnapshot = currentChatScopedSnapshot()
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].message[0].data = 'newer'
    })
    dispatchUpdateMessageScoped('m-1', { disabled: true }, stalePatchSnapshot)
    dispatchDeleteMessageScoped('m-2', currentChatScopedSnapshot())

    await waitForCallCount(calls, 3)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message).toEqual([
        { role: 'user', data: 'newer', chatId: 'm-1' },
        initialMessages[1],
      ])
    })
  })

  it('keeps an accepted scoped delete optimistically applied under the resource guard', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
    ]
    seedActiveMessages(previousMessages)
    getDatabase().characters[0].chats[0].bookmarks = ['m-1', 'm-2']
    getDatabase().characters[0].chats[0].bookmarkNames = { 'm-1': 'One', 'm-2': 'Two' }
    const previous = currentChatScopedSnapshot()
    setResourceWriteGuardEnabled(true)

    const deletion = dispatchDeleteMessageScoped('m-1', previous)

    expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[1]])
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['m-2'])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'm-2': 'Two' })
    await waitForCallCount(calls, 2)
    await expect(deletion).resolves.toEqual({ status: 'accepted' })
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[1]])
    })
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['m-2'])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'm-2': 'Two' })
  })

  it('treats an exact missing-message delete as accepted without restoring a ghost row', async () => {
    const calls: CapturedFetch[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        calls.push({
          url,
          method: init.method ?? 'GET',
          authHeader: null,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        })
        if (url === '/api/v1/bootstrap') return jsonResponse({ revision: 10 })
        if (url === '/api/v1/commands/messages/m-1' && init.method === 'DELETE') {
          return jsonResponse({ error: 'Message not found: m-1', reason: 'not-found' }, 404)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    const previousMessages: Message[] = [
      { role: 'user', data: 'translated', chatId: 'm-1' },
      { role: 'char', data: 'reply', chatId: 'm-2' },
    ]
    seedActiveMessages(previousMessages)
    setResourceWriteGuardEnabled(true)

    const deletion = dispatchDeleteMessageScoped('m-1', currentChatScopedSnapshot())
    expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[1]])

    await expect(deletion).resolves.toEqual({ status: 'accepted' })
    await waitForCallCount(calls, 2)
    expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[1]])
  })

  it('keeps a retained scoped delete projected and accepts a later not-found replay idempotently', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-retained-message-delete',
      writerEpoch: 4,
      databaseLineage: 'lineage-retained-message-delete',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    let replaying = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/messages/m-1' && init.method === 'DELETE') {
          return replaying
            ? jsonResponse({ error: 'Message not found: m-1', reason: 'not-found' }, 404)
            : jsonResponse({ error: 'temporarily unavailable' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    const previousMessages: Message[] = [
      { role: 'user', data: 'translated', chatId: 'm-1' },
      { role: 'char', data: 'reply', chatId: 'm-2' },
    ]
    seedActiveMessages(previousMessages)
    setResourceWriteGuardEnabled(true)

    try {
      const queued = await dispatchDeleteMessageScoped('m-1', currentChatScopedSnapshot())
      expect(queued).toMatchObject({ status: 'queued', mutationId: expect.any(String) })
      expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[1]])
      const pending = await listPendingMutations()
      expect(pending).toHaveLength(1)
      expect(queued.status === 'queued' ? queued.mutationId : '').toBe(pending[0].handle.mutationId)

      replaying = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ discarded: 1 })
      if (queued.status !== 'queued') throw new Error('Expected a queued delete')
      await expect(queued.settlement).resolves.toEqual({ status: 'accepted' })
      expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[1]])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('rolls back a retained scoped delete when replay is terminally discarded', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-discarded-message-delete',
      writerEpoch: 5,
      databaseLineage: 'lineage-discarded-message-delete',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    let replaying = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requestInput: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(requestInput)
        if (url === '/api/v1/commands/messages/m-1' && init.method === 'DELETE') {
          return replaying
            ? jsonResponse({ error: 'Writer session is stale', reason: 'stale-writer' }, 423)
            : jsonResponse({ error: 'temporarily unavailable' }, 500)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )
    const previousMessages: Message[] = [
      { role: 'user', data: 'translated', chatId: 'm-1' },
      { role: 'char', data: 'reply', chatId: 'm-2' },
    ]
    seedActiveMessages(previousMessages)
    setResourceWriteGuardEnabled(true)

    try {
      const queued = await dispatchDeleteMessageScoped('m-1', currentChatScopedSnapshot())
      expect(queued.status).toBe('queued')
      expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[1]])

      replaying = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ discarded: 1 })
      if (queued.status !== 'queued') throw new Error('Expected a queued delete')
      await expect(queued.settlement).resolves.toEqual({ status: 'failed', error: 'Writer session is stale' })
      expect(getDatabase().characters[0].chats[0].message).toEqual(previousMessages)
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('keeps an accepted scoped message update optimistically applied under the resource guard', async () => {
    const calls = stubMessagePersistenceFetch()
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()
    setResourceWriteGuardEnabled(true)

    dispatchUpdateMessageScoped('m-1', { role: 'user', data: 'after', disabled: true }, previous)

    expect(getDatabase().characters[0].chats[0].message).toEqual([
      { role: 'user', data: 'after', disabled: true, chatId: 'm-1' },
    ])
    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].message).toEqual([
        { role: 'user', data: 'after', disabled: true, chatId: 'm-1' },
      ])
    })
  })

  it('failed empty char append command rolls back the appended message by id', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages' && init.method === 'POST',
    })
    const previousMessages: Message[] = [{ role: 'user', data: 'before', chatId: 'm-1' }]
    seedActiveMessages(previousMessages)

    appendCurrentChatEmptyCharMessage()
    await waitForCallCount(calls, 2)

    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/chats/chat-a/messages',
      method: 'POST',
      body: {
        baseRevision: 10,
        message: { role: 'char', data: '', chatId: expect.any(String) },
      },
    })
    expect(getDatabase().characters[0].chats[0].message).toEqual(previousMessages)
  })

  it('failed scoped message update restores attempted fields and preserves newer same-chat metadata', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/messages/m-1' && init.method === 'PATCH',
    })
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()

    getDatabase().characters[0].chats[0].name = 'newer metadata'

    dispatchUpdateMessageScoped('m-1', { data: 'attempted' }, previous)
    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('attempted')
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual([{ role: 'char', data: 'before', chatId: 'm-1' }])
    expect(getDatabase().characters[0].chats[0].name).toBe('newer metadata')
  })

  it('failed scoped message update skips rollback when the message changed again after the attempt', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/messages/m-1' && init.method === 'PATCH',
      onCommand: () => {
        getDatabase().characters[0].chats[0].message[0].data = 'newer edit'
      },
    })
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()

    dispatchUpdateMessageScoped('m-1', { data: 'attempted' }, previous)
    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('attempted')
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual([{ role: 'char', data: 'newer edit', chatId: 'm-1' }])
  })

  it('scoped message update does not overwrite a field that diverged after its snapshot', async () => {
    const calls = stubMessagePersistenceFetch()
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()
    getDatabase().characters[0].chats[0].message[0].data = 'newer edit'

    dispatchUpdateMessageScoped('m-1', { data: 'attempted' }, previous)

    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('newer edit')
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual([])
    expect(getDatabase().characters[0].chats[0].message[0].data).toBe('newer edit')
  })

  it('scoped message update sends only fields that are still safe to apply', async () => {
    const calls = stubMessagePersistenceFetch()
    seedActiveMessages([{ role: 'char', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()
    getDatabase().characters[0].chats[0].message[0].data = 'newer edit'

    dispatchUpdateMessageScoped('m-1', { data: 'attempted', disabled: true }, previous)

    expect(getDatabase().characters[0].chats[0].message[0]).toEqual({
      role: 'char',
      data: 'newer edit',
      disabled: true,
      chatId: 'm-1',
    })
    await waitForCallCount(calls, 2)
    expect(calls[1]).toMatchObject({
      url: '/api/v1/commands/messages/m-1',
      method: 'PATCH',
      body: {
        patch: { disabled: true },
      },
    })
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
    getDatabase().characters[0].chats[0].bookmarks = ['m-1', 'm-2']
    getDatabase().characters[0].chats[0].bookmarkNames = { 'm-1': 'One', 'm-2': 'Two' }
    const previous = currentChatScopedSnapshot()

    const deletion = dispatchDeleteMessageScoped('m-1', previous)
    expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[1]])
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['m-2'])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'm-2': 'Two' })
    await waitForCallCount(calls, 2)
    await expect(deletion).resolves.toEqual({ status: 'failed', error: 'nope' })

    expect(getDatabase().characters[0].chats[0].message).toEqual(previousMessages)
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['m-1', 'm-2'])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'm-1': 'One', 'm-2': 'Two' })
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
        getDatabase().characters[0].chats[0].message = jsonClone(newerMessages)
      },
    })
    seedActiveMessages(previousMessages)
    const previous = currentChatScopedSnapshot()

    getDatabase().characters[0].chats[0].message = [jsonClone(previousMessages[1])]

    dispatchDeleteMessageScoped('m-1', previous)
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual(newerMessages)
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
    getDatabase().characters[0].chats[0].bookmarks = ['m-1', 'm-2', 'm-3']
    getDatabase().characters[0].chats[0].bookmarkNames = { 'm-1': 'One', 'm-2': 'Two', 'm-3': 'Three' }
    const previous = currentChatScopedSnapshot()

    const command = dispatchTruncateMessagesScoped('chat-a', 'm-1', previous)
    expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[0]])
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['m-1'])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'm-1': 'One' })
    await command
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual(previousMessages)
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['m-1', 'm-2', 'm-3'])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({
      'm-1': 'One',
      'm-2': 'Two',
      'm-3': 'Three',
    })
  })

  it('keeps only retained bookmarks after an accepted scoped truncation', async () => {
    const calls = stubMessagePersistenceFetch()
    const previousMessages: Message[] = [
      { role: 'user', data: 'one', chatId: 'm-1' },
      { role: 'char', data: 'two', chatId: 'm-2' },
      { role: 'user', data: 'three', chatId: 'm-3' },
    ]
    seedActiveMessages(previousMessages)
    getDatabase().characters[0].chats[0].bookmarks = ['m-1', 'm-2', 'm-3']
    getDatabase().characters[0].chats[0].bookmarkNames = { 'm-1': 'One', 'm-2': 'Two', 'm-3': 'Three' }

    await dispatchTruncateMessagesScoped('chat-a', 'm-1', currentChatScopedSnapshot())
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual([previousMessages[0]])
    expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['m-1'])
    expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'm-1': 'One' })
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

    getDatabase().characters[0].chats[0].message = [
      jsonClone(previousMessages[0]),
      { role: 'char', data: 'newer after truncate', chatId: 'm-newer' },
    ]

    await dispatchTruncateMessagesScoped('chat-a', 'm-1', previous)
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual([
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

    getDatabase().characters[0].chats[0].message = [jsonClone(previousMessages[0]), jsonClone(replacementTail[0])]
    getDatabase().characters[0].chats[0].name = 'newer metadata'

    dispatchReplaceTailMessagesScoped('chat-a', 'm-1', replacementTail, previous)
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual(previousMessages)
    expect(getDatabase().characters[0].chats[0].name).toBe('newer metadata')
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
        getDatabase().characters[0].chats[0].message = jsonClone(newerMessages)
        getDatabase().characters[0].chats[0].name = 'newer metadata'
      },
    })
    seedActiveMessages(previousMessages)
    const previous = currentChatScopedSnapshot()

    getDatabase().characters[0].chats[0].message = [jsonClone(previousMessages[0]), jsonClone(replacementTail[0])]

    dispatchReplaceTailMessagesScoped('chat-a', 'm-1', replacementTail, previous)
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual(newerMessages)
    expect(getDatabase().characters[0].chats[0].name).toBe('newer metadata')
  })

  it('failed scoped replace-all skips rollback when live messages diverge from the attempted replacement', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/messages' && init.method === 'PUT',
    })
    seedActiveMessages([{ role: 'user', data: 'before', chatId: 'm-1' }])
    const previous = currentChatScopedSnapshot()
    const replacementMessages: Message[] = [{ role: 'char', data: 'replacement', chatId: 'm-r' }]

    getDatabase().characters[0].chats[0].message = [
      jsonClone(replacementMessages[0]),
      { role: 'user', data: 'newer follow-up', chatId: 'm-newer' },
    ]
    getDatabase().characters[0].chats[0].name = 'newer metadata'

    dispatchReplaceMessagesScoped('chat-a', replacementMessages, previous)
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].message).toEqual([
      { role: 'char', data: 'replacement', chatId: 'm-r' },
      { role: 'user', data: 'newer follow-up', chatId: 'm-newer' },
    ])
    expect(getDatabase().characters[0].chats[0].name).toBe('newer metadata')
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
    getDatabase().characters[0].chats[0].scriptstate!.$score = 'optimistic'
    getDatabase().characters[0].chats[0].message.push({ role: 'user', data: 'keep', chatId: 'm-keep' })

    dispatchPatchChatScriptstateScoped('chat-a', { $score: 'optimistic' }, [], previous)
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({ $score: '1', $old: 'gone' })
    expect(getDatabase().characters[0].chats[0].message).toHaveLength(1)
  })

  it('dispatchPatchChatScriptstateScoped preserves newer values for attempted patch and delete keys', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a/scriptstate' && init.method === 'PATCH',
      onCommand: () => {
        getDatabase().characters[0].chats[0].scriptstate = {
          $score: 'newer score',
          $old: 'newer recreated value',
        }
      },
    })
    const previous = currentChatScriptstateSnapshot()
    getDatabase().characters[0].chats[0].scriptstate = { $score: 'optimistic score' }

    dispatchPatchChatScriptstateScoped('chat-a', { $score: 'optimistic score' }, ['$old'], previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({
        $score: 'newer score',
        $old: 'newer recreated value',
      })
    })
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
    getDatabase().characters[0].chats[0].note = 'original note'

    const previous = currentChatScriptstateSnapshot(true)
    expect(previous.note).toBe('original note')

    getDatabase().characters[0].chats[0].note = 'optimistic note'
    getDatabase().characters[0].chats[0].scriptstate!.$score = 'keep'

    dispatchUpdateChatNoteScoped('chat-a', 'optimistic note', previous)
    await waitForCallCount(calls, 2)

    expect(getDatabase().characters[0].chats[0].note).toBe('original note')
    expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({ $score: 'keep', $old: 'gone' })
  })

  it('dispatchUpdateChatNoteScoped preserves a newer note and sibling scriptstate edit', async () => {
    const calls = stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH',
      onCommand: () => {
        getDatabase().characters[0].chats[0].note = 'newer note'
        getDatabase().characters[0].chats[0].scriptstate!.$score = 'newer score'
      },
    })
    getDatabase().characters[0].chats[0].note = 'original note'
    const previous = currentChatScriptstateSnapshot(true)
    getDatabase().characters[0].chats[0].note = 'optimistic note'

    dispatchUpdateChatNoteScoped('chat-a', 'optimistic note', previous)

    await waitForCallCount(calls, 2)
    await vi.waitFor(() => {
      expect(getDatabase().characters[0].chats[0].note).toBe('newer note')
    })
    expect(getDatabase().characters[0].chats[0].scriptstate!.$score).toBe('newer score')
  })

  it('setChatNoteValue applies the author note under the resource guard and rolls back on failure', async () => {
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
    delete (getDatabase().characters[0].chats[0] as { note?: string }).note
    setResourceWriteGuardEnabled(true)

    expect(() => {
      getDatabase().characters[0].chats[0].note = 'direct note'
    }).toThrow()

    expect(setChatNoteValue('chat-a', 'draft note')).toBe(true)
    expect(getDatabase().characters[0].chats[0].note).toBe('draft note')

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
    expect(getDatabase().characters[0].chats[0].note).toBe('')
  })

  it('sends lifecycle author-note saves with keepalive', async () => {
    setCachedServerCommandRevision(10)
    let commandInit: RequestInit | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chats/chat-a') {
          commandInit = init
          return jsonResponse({
            revision: 11,
            event: { type: 'chat.updated', revision: 11, resource: 'chat', id: 'chat-a' },
            chatId: 'chat-a',
            selectedChatId: 'chat-a',
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    expect(setChatNoteValue('chat-a', 'draft before pagehide', { keepalive: true })).toBe(true)
    await vi.waitFor(() => expect(commandInit).toBeDefined())

    expect(commandInit).toMatchObject({ keepalive: true })
    expect(JSON.parse(String(commandInit?.body))).toMatchObject({ patch: { note: 'draft before pagehide' } })
  })

  it('persists and immediately dispatches an absolute note correction after a remote marker wins', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-author-note-revert',
      writerEpoch: 3,
      databaseLineage: 'lineage-author-note-revert',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0].note = 'initial note'
    })

    try {
      const first = stageChatNoteMutation({
        chatId: 'chat-a',
        characterId: 'char-a',
        note: 'draft note',
      })
      await expect(first.outbox.ready).resolves.toBe('persisted')
      const remoteHandle = (await listPendingMutations())[0]!.handle
      await expect(beginPendingMutationDispatch(remoteHandle)).resolves.toBe('persisted')

      const correction = stageChatNoteMutation({
        chatId: 'chat-a',
        characterId: 'char-a',
        note: 'initial note',
        previous: first.outbox,
      })
      await expect(correction.outbox.ready).resolves.toBe('persisted')
      expect(
        (await listPendingMutations()).map((entry) => ({ key: entry.handle.key, body: entry.intent.requests[0].body })),
      ).toEqual([
        {
          key: 'character-owner:char-a',
          body: { patch: { note: 'draft note' }, select: false },
        },
        {
          key: 'character-owner:char-a',
          body: { patch: { note: 'initial note' }, select: false },
        },
      ])

      let revision = 10
      const commandBodies: Array<Record<string, unknown>> = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const url = String(input)
          if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
          if (url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH') {
            commandBodies.push(typeof init.body === 'string' ? JSON.parse(init.body) : {})
            revision += 1
            return jsonResponse({
              revision,
              event: { type: 'chat.updated', revision, resource: 'chat', id: 'chat-a' },
              chatId: 'chat-a',
              selectedChatId: 'chat-a',
            })
          }
          return jsonResponse({ error: `unexpected ${url}` }, 404)
        }) as unknown as typeof fetch,
      )

      const rollback = currentChatScriptstateSnapshot(true)
      await expect(dispatchStagedChatNoteMutation(correction, rollback)).resolves.toMatchObject({ status: 'ok' })

      expect(commandBodies.map((body) => body.patch)).toEqual([{ note: 'draft note' }, { note: 'initial note' }])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('holds chat DELETE behind a transient note PATCH, then replays both without a late note request', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: 'writer-chat-delete',
      writerEpoch: 4,
      databaseLineage: 'lineage-chat-delete',
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(20)

    try {
      const noteRollback = applyChatNoteValueLocally('chat-a', 'latest optimistic note')
      expect(noteRollback).toMatchObject({ note: '' })
      const noteMutation = stageChatNoteMutation({
        chatId: 'chat-a',
        characterId: 'char-a',
        note: 'latest optimistic note',
      })
      const previous = currentChatStateSnapshot()
      expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toMatchObject({ applied: true })

      let recover = false
      let revision = 20
      const commands: Array<{ method: string; body: Record<string, unknown> }> = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const url = String(input)
          if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
          if (url === '/api/v1/commands/chats/chat-a') {
            const method = init.method ?? 'GET'
            const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
            commands.push({ method, body })
            if (!recover && method === 'PATCH') return jsonResponse({ error: 'note temporarily unavailable' }, 500)
            if (!recover) throw new Error('DELETE overtook its note predecessor')
            revision += 1
            if (method === 'PATCH') {
              return jsonResponse({
                revision,
                event: { type: 'chat.updated', revision, resource: 'chat', id: 'chat-a' },
                chatId: 'chat-a',
                selectedChatId: 'chat-b',
              })
            }
            return jsonResponse({
              revision,
              event: { type: 'chat.deleted', revision, resource: 'chat', id: 'chat-a' },
              chatId: 'chat-a',
              selectedChatId: 'chat-b',
            })
          }
          return jsonResponse({ error: `unexpected ${url}` }, 404)
        }) as unknown as typeof fetch,
      )

      dispatchDeleteChat('chat-a', previous)
      await vi.waitFor(() => expect(commands).toEqual([expect.objectContaining({ method: 'PATCH' })]))
      expect(
        (await listPendingMutations()).map((entry) => ({
          key: entry.handle.key,
          method: entry.intent.requests[0].method,
        })),
      ).toEqual([
        { key: 'character-owner:char-a', method: 'PATCH' },
        { key: 'character-owner:char-a', method: 'DELETE' },
      ])

      recover = true
      const recoveryStart = commands.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2 })
      expect(commands.slice(recoveryStart).map((command) => command.method)).toEqual(['PATCH', 'DELETE'])
      expect(await listPendingMutations()).toEqual([])

      const commandCount = commands.length
      await expect(dispatchStagedChatNoteMutation(noteMutation, noteRollback!)).resolves.toEqual({
        status: 'unavailable',
      })
      expect(commands).toHaveLength(commandCount)
      // The blocked DELETE remained durable, so its optimistic projection
      // stayed visible while replay later committed the same deletion.
      expect(getDatabase().characters[0].chats.some((chat) => chat.id === 'chat-a')).toBe(false)
    } finally {
      await clearPendingMutationOutbox()
      resetPendingMutationOutboxForTests()
    }
  })

  it('flushes note and chat metadata PATCHes before DELETE when durable storage is unavailable', async () => {
    resetPendingMutationOutboxForTests()
    setCachedServerCommandRevision(30)
    setResourceWriteGuardEnabled(true)
    const stopWatcher = watchServerBackedChatMetadata({ delayMs: 60_000 })
    flushSync()

    const noteRollback = applyChatNoteValueLocally('chat-a', 'fallback note')
    expect(noteRollback).not.toBeNull()
    syncServerBackedChatMetadataBaselines()
    const noteMutation = stageChatNoteMutation({
      chatId: 'chat-a',
      characterId: 'char-a',
      note: 'fallback note',
    })
    let pendingNote = true
    const unregisterNoteFlusher = registerPendingBridgePatchFlusher('test-author-note-fallback', (options) => {
      if (!pendingNote) return
      pendingNote = false
      void dispatchStagedChatNoteMutation(noteMutation, noteRollback!, options)
    })

    try {
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].name = 'Fallback rename'
      })
      flushSync()
      const previous = currentChatStateSnapshot()
      expect(applyOptimisticDeletedChat('char-a', 'chat-a', previous)).toMatchObject({ applied: true })

      let revision = 30
      const commands: Array<{ method: string; patch?: Record<string, unknown> }> = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const url = String(input)
          if (url !== '/api/v1/commands/chats/chat-a') {
            return jsonResponse({ error: `unexpected ${url}` }, 404)
          }
          const method = init.method ?? 'GET'
          const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          commands.push({ method, patch: body.patch })
          revision += 1
          return jsonResponse({
            revision,
            event: {
              type: method === 'DELETE' ? 'chat.deleted' : 'chat.updated',
              revision,
              resource: 'chat',
              id: 'chat-a',
            },
            chatId: 'chat-a',
            selectedChatId: 'chat-b',
          })
        }) as unknown as typeof fetch,
      )

      dispatchDeleteChat('chat-a', previous)
      await vi.waitFor(() => expect(commands).toHaveLength(3))

      expect(commands).toEqual([
        { method: 'PATCH', patch: { name: 'Fallback rename' } },
        { method: 'PATCH', patch: { note: 'fallback note' } },
        { method: 'DELETE', patch: undefined },
      ])
    } finally {
      unregisterNoteFlusher()
      stopWatcher()
      resetPendingMutationOutboxForTests()
    }
  })
})

describe('Phase 3 runner rejection rollback (L36)', () => {
  it('reconciles all successful optimistic sequence steps once through the async wrapper', async () => {
    setCachedServerCommandRevision(70)
    const bases: number[] = []
    const reconciliations: number[][] = []
    setServerCommandSuccessReconciler((_event, events) => {
      reconciliations.push(events.map((event) => event.revision))
    })
    const success = (revision: number): ServerCommandResult => ({
      status: 'ok',
      revision,
      event: { type: 'chat.updated', revision, resource: 'characterRow' },
    })

    const result = await runOptimisticCommandSequenceAsync(
      [
        async (baseRevision) => {
          bases.push(baseRevision)
          return success(baseRevision + 1)
        },
        async (baseRevision) => {
          bases.push(baseRevision)
          return success(baseRevision + 1)
        },
      ],
      vi.fn(),
    )

    expect(result).toBeNull()
    expect(bases).toEqual([70, 71])
    expect(reconciliations).toEqual([[71, 72]])
  })

  it('skips sequence rollback when a destructive refresh lands before failure', async () => {
    stubCommandFetch()
    const rollback = vi.fn()
    const command = vi.fn(async () => {
      createDestructiveRefreshToken('test-sequence-full-resync')
      return { status: 'error' as const, error: 'forced failure' }
    })

    runOptimisticCommandSequence([command], rollback)

    await vi.waitFor(() => {
      expect(command).toHaveBeenCalledTimes(1)
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(rollback).not.toHaveBeenCalled()
  })

  it('skips async sequence rollback when a destructive refresh lands before failure', async () => {
    stubCommandFetch()
    const rollback = vi.fn()

    const result = await runOptimisticCommandSequenceAsync(
      [
        async () => {
          createDestructiveRefreshToken('test-async-sequence-full-resync')
          return { status: 'error' as const, error: 'forced failure' }
        },
      ],
      rollback,
    )

    expect(result).toEqual({ status: 'error', error: 'forced failure' })
    expect(rollback).not.toHaveBeenCalled()
  })

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
    setDatabaseLite(seedCloneCostDb() as any) // char-0 large (40 messages), siblings small
    selectedCharID.set(1)
    const charactersSize = JSON.stringify(getDatabase().characters).length
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ revision: 10 })) as unknown as typeof fetch)

    const nextChat = JSON.parse(JSON.stringify(getDatabase().characters[1].chats[0]))
    nextChat.name = 'Renamed chat'

    // The scoped capture + the compatible-update diff stay bounded to the one
    // active chat; the large sibling (char-0) transcript is never serialized.
    const instrumented = withCloneInstrumentation(() => {
      setCurrentChat(nextChat as any)
    })
    expect(instrumented.maxClonedSize).toBeLessThan(charactersSize)
    expect(getDatabase().characters[1].chats[0].name).toBe('Renamed chat')

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

    const nextChat = JSON.parse(JSON.stringify(getDatabase().characters[0].chats[0]))
    nextChat.name = 'Optimistic rename'

    setCurrentChat(nextChat as any)
    // a concurrent, unrelated edit to ANOTHER chat row a whole-array restore would wipe
    getDatabase().characters[0].chats[1].name = 'Concurrent sibling edit'

    await waitForCallCount(calls, 2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getDatabase().characters[0].chats[0].name).toBe('Chat A')
    expect(getDatabase().characters[0].chats[1].name).toBe('Concurrent sibling edit')
  })
})

describe('durable chat and folder structure dispatch', () => {
  async function prepareDurableOutbox(suffix: string): Promise<void> {
    vi.stubGlobal('indexedDB', new IDBFactory())
    resetPendingMutationOutboxForTests()
    await preparePendingMutationOutbox({
      writerSessionId: `writer-chat-structure-${suffix}`,
      writerEpoch: 51,
      databaseLineage: `lineage-chat-structure-${suffix}`,
      requestedWriterWasActive: true,
    })
    setCachedServerCommandRevision(10)
  }

  async function clearDurableOutbox(): Promise<void> {
    await clearPendingMutationOutbox()
    resetPendingMutationOutboxForTests()
  }

  it('classifies a terminal structural create as failed after narrow rollback', async () => {
    resetPendingMutationOutboxForTests()
    stubFailingCommandFetch({
      matches: (url, init) => url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST',
    })
    setResourceWriteGuardEnabled(true)
    const previous = currentChatStateSnapshot()
    const attemptedChat = {
      id: 'chat-created',
      name: 'Attempted Chat',
      note: '',
      folderId: null,
      message: [],
      localLore: [],
      fmIndex: -1,
    } as Chat
    expect(applyOptimisticCreatedChat('char-a', attemptedChat, previous)).toBe(true)

    await expect(dispatchCreateChatWithOutcome('char-a', attemptedChat, previous)).resolves.toMatchObject({
      status: 'failed',
    })
    expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
  })

  it('settles a retained structural create after its exact replay is accepted', async () => {
    await prepareDurableOutbox('create-outcome')
    let recover = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST') {
          if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 503)
          return jsonResponse({
            revision: 11,
            event: { type: 'chat.created', revision: 11, resource: 'chatTranscript', parentId: 'char-a' },
            chatId: 'chat-created',
            selectedChatId: 'chat-created',
            generationSettings: null,
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const previous = currentChatStateSnapshot()
      const attemptedChat = {
        id: 'chat-created',
        name: 'Queued Chat',
        note: '',
        folderId: null,
        message: [],
        localLore: [],
        fmIndex: -1,
      } as Chat
      expect(applyOptimisticCreatedChat('char-a', attemptedChat, previous)).toBe(true)

      const mutation = await dispatchCreateChatWithOutcome('char-a', attemptedChat, previous)
      expect(mutation).toMatchObject({ status: 'queued', mutationIds: [expect.any(String)] })
      expect(getDatabase().characters[0].chats[0].id).toBe('chat-created')
      expect(await listPendingMutations()).toHaveLength(1)

      recover = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 1, retained: 0 })
      if (mutation.status !== 'queued') throw new Error('Expected a queued create')
      await expect(mutation.settlement).resolves.toEqual({ status: 'accepted' })
    } finally {
      await clearDurableOutbox()
    }
  })

  it('reports a terminal final replay and rolls the retained structural create back', async () => {
    await prepareDurableOutbox('create-final-failure')
    let rejectReplay = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/characters/char-a/chats' && init.method === 'POST') {
          return rejectReplay
            ? jsonResponse({ error: 'invalid queued chat' }, 400)
            : jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const previous = currentChatStateSnapshot()
      const attemptedChat = {
        id: 'chat-rejected-finally',
        name: 'Rejected Queued Chat',
        note: '',
        folderId: null,
        message: [],
        localLore: [],
        fmIndex: -1,
      } as Chat
      expect(applyOptimisticCreatedChat('char-a', attemptedChat, previous)).toBe(true)
      const mutation = await dispatchCreateChatWithOutcome('char-a', attemptedChat, previous)
      if (mutation.status !== 'queued') throw new Error('Expected a queued create')

      rejectReplay = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ discarded: 1, retained: 0 })
      await expect(mutation.settlement).resolves.toMatchObject({
        status: 'failed',
        result: { status: 'error', error: 'invalid queued chat' },
      })
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
    } finally {
      await clearDurableOutbox()
    }
  })

  it('classifies a retained scoped bookmark update as queued while preserving its projection', async () => {
    await prepareDurableOutbox('bookmark-outcome')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH') {
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const previous = currentChatScopedSnapshot()
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].bookmarks = ['message-a']
        getDatabase().characters[0].chats[0].bookmarkNames = { 'message-a': 'Queued bookmark' }
      })
      const mutation = dispatchUpdateChatScopedWithOutcome(
        'chat-a',
        { bookmarks: ['message-a'], bookmarkNames: { 'message-a': 'Queued bookmark' } },
        previous,
      )

      await expect(mutation).resolves.toMatchObject({ status: 'queued' })
      expect(getDatabase().characters[0].chats[0].bookmarks).toEqual(['message-a'])
      expect(getDatabase().characters[0].chats[0].bookmarkNames).toEqual({ 'message-a': 'Queued bookmark' })
      expect(await listPendingMutations()).toHaveLength(1)
    } finally {
      await clearDurableOutbox()
    }
  })

  it('waits for every batch row to persist and reapplies only the latest retained projection', async () => {
    await prepareDurableOutbox('batch-readiness')
    const encryptionGate = createDeferred<void>()
    const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle)
    let encryptCalls = 0
    const encryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'encrypt')
      .mockImplementation(async (algorithm, key, data) => {
        encryptCalls += 1
        if (encryptCalls === 2) await encryptionGate.promise
        return originalEncrypt(algorithm, key, data)
      })
    const commandCalls: string[] = []
    const reapplyFences: boolean[] = []
    const rollback = vi.fn()
    const target = pendingMutationModuleEnabledProjectionTarget('module-a')

    try {
      const batch = dispatchCharacterOwnedDurableBatch('char-a', [
        {
          method: 'PATCH',
          path: '/chats/chat-a',
          body: { patch: { name: 'first' }, select: false },
          projectionTargets: [target],
          command: async () => {
            commandCalls.push('first')
            return { status: 'unavailable' }
          },
          rollback,
          reapply: (isCurrent) => reapplyFences.push(isCurrent(target)),
        },
        {
          method: 'PATCH',
          path: '/chats/chat-a',
          body: { patch: { name: 'second' }, select: false },
          projectionTargets: [target],
          command: async () => {
            commandCalls.push('second')
            return { status: 'unavailable' }
          },
          rollback,
          reapply: (isCurrent) => reapplyFences.push(isCurrent(target)),
        },
      ])

      await vi.waitFor(() => expect(encryptCalls).toBe(2))
      expect(commandCalls).toEqual([])
      encryptionGate.resolve()
      await expect(batch).resolves.toMatchObject({ status: 'retained', acceptedCount: 0 })
      expect(commandCalls).toEqual(['first'])
      expect(reapplyFences).toEqual([false, true])
      expect(rollback).not.toHaveBeenCalled()
    } finally {
      encryptionGate.resolve()
      encryptSpy.mockRestore()
      await clearDurableOutbox()
    }
  })

  it('waits for every exact retained batch handle and fails the aggregate when one is discarded', async () => {
    await prepareDurableOutbox('batch-final-settlement')
    const secondReplayGate = createDeferred<void>()
    const replayPaths: string[] = []
    const firstRollback = vi.fn()
    const secondRollback = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        const path = url.replace('/api/v1/commands', '')
        if (path === '/chats/chat-a') {
          replayPaths.push(path)
          return jsonResponse({
            revision: 11,
            event: { type: 'chat.updated', revision: 11, resource: 'chat', id: 'chat-a' },
          })
        }
        if (path === '/chats/chat-b') {
          replayPaths.push(path)
          await secondReplayGate.promise
          return jsonResponse({ error: 'invalid retained suffix' }, 400)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const batch = await dispatchCharacterOwnedDurableBatch('char-a', [
        {
          method: 'PATCH',
          path: '/chats/chat-a',
          body: { patch: { name: 'first' }, select: false },
          command: async () => ({ status: 'unavailable' }),
          rollback: firstRollback,
        },
        {
          method: 'PATCH',
          path: '/chats/chat-b',
          body: { patch: { name: 'second' }, select: false },
          command: async () => ({ status: 'unavailable' }),
          rollback: secondRollback,
        },
      ])
      expect(batch).toMatchObject({
        status: 'retained',
        mutationIds: [expect.any(String), expect.any(String)],
      })
      if (batch.status !== 'retained' || !batch.settlement) throw new Error('Expected a retained batch')

      let aggregateSettled = false
      void batch.settlement.then(() => {
        aggregateSettled = true
      })
      const replay = replayPendingMutations()
      await vi.waitFor(() => expect(replayPaths).toEqual(['/chats/chat-a', '/chats/chat-b']))
      await Promise.resolve()
      expect(aggregateSettled).toBe(false)

      secondReplayGate.resolve()
      await expect(replay).resolves.toMatchObject({ succeeded: 1, discarded: 1, retained: 0 })
      await expect(batch.settlement).resolves.toMatchObject({
        status: 'failed',
        result: { status: 'error', error: 'invalid retained suffix' },
      })
      expect(firstRollback).not.toHaveBeenCalled()
      expect(secondRollback).toHaveBeenCalledOnce()
    } finally {
      secondReplayGate.resolve()
      await clearDurableOutbox()
    }
  })

  it('sends no batch request and rolls back every row when one durable row cannot persist', async () => {
    await prepareDurableOutbox('batch-persistence-failure')
    const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle)
    let encryptCalls = 0
    const encryptSpy = vi
      .spyOn(globalThis.crypto.subtle, 'encrypt')
      .mockImplementation(async (algorithm, key, data) => {
        encryptCalls += 1
        if (encryptCalls === 2) throw new Error('simulated suffix persistence failure')
        return originalEncrypt(algorithm, key, data)
      })
    const command = vi.fn(async () => ({ status: 'unavailable' as const }))
    const rollback = vi.fn()

    try {
      await expect(
        dispatchCharacterOwnedDurableBatch('char-a', [
          {
            method: 'PATCH',
            path: '/chats/chat-a',
            body: { patch: { name: 'first' }, select: false },
            command,
            rollback,
          },
          {
            method: 'PATCH',
            path: '/chats/chat-b',
            body: { patch: { name: 'second' }, select: false },
            command,
            rollback,
          },
        ]),
      ).resolves.toMatchObject({
        status: 'failure',
        acceptedCount: 0,
        failure: { status: 'error', reason: 'invalid-request' },
      })
      expect(command).not.toHaveBeenCalled()
      expect(rollback).toHaveBeenCalledTimes(2)
      expect(await listPendingMutations()).toEqual([])
    } finally {
      encryptSpy.mockRestore()
      await clearDurableOutbox()
    }
  })

  it('retains an optimistic chat patch with the exact frozen live body on the character owner', async () => {
    await prepareDurableOutbox('chat-patch')
    let liveBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH') {
          liveBody = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const previous = currentChatStateSnapshot()
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].name = 'Durable rename'
      })
      const mutation = dispatchUpdateChatWithOutcome('chat-a', { name: 'Durable rename' }, previous)

      await vi.waitFor(() => expect(liveBody).toBeDefined())
      await expect(mutation).resolves.toMatchObject({ status: 'queued' })
      expect(getDatabase().characters[0].chats[0].name).toBe('Durable rename')
      const pending = await listPendingMutations()
      expect(pending).toMatchObject([
        {
          handle: { key: 'character-owner:char-a' },
          intent: {
            version: 1,
            requests: [
              {
                method: 'PATCH',
                path: '/chats/chat-a',
                body: { patch: { name: 'Durable rename' }, select: false },
              },
            ],
          },
        },
      ])
      const { baseRevision: _baseRevision, ...sentBody } = liveBody ?? {}
      expect(sentBody).toEqual(pending[0].intent.requests[0].body)

      const authoritativeCharacter = jsonClone(getDatabase().characters[0])
      authoritativeCharacter.chats[0].name = 'Chat A'
      expect(applyCharacterResource({ revision: 11, character: authoritativeCharacter })).toBe(true)
      expect(getDatabase().characters[0].chats[0].name).toBe('Durable rename')

      expect(
        applyCharactersResource({
          revision: 12,
          characters: [authoritativeCharacter],
          characterOrder: ['char-a'],
          currentChar: 0,
        }),
      ).toBe(true)
      expect(getDatabase().characters[0].chats[0].name).toBe('Durable rename')
    } finally {
      await clearDurableOutbox()
    }
  })

  it('reapplies retained message edits in owner order after transcript hydration', async () => {
    await prepareDurableOutbox('message-patch-refresh')
    let commandCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/messages/message-a' && init.method === 'PATCH') {
          commandCalls += 1
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].message = [
          { role: 'char', data: 'persisted', chatId: 'message-a' } as Message,
        ]
      })
      dispatchUpdateMessageScoped('message-a', { data: 'first retained edit' }, currentChatScopedSnapshot())
      await vi.waitFor(() => expect(commandCalls).toBe(1))
      dispatchUpdateMessageScoped('message-a', { data: 'newest retained edit' }, currentChatScopedSnapshot())
      await vi.waitFor(() => expect(commandCalls).toBe(2))

      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].message = [
          { role: 'char', data: 'persisted', chatId: 'message-a' } as Message,
        ]
      })
      reapplyRetainedChatBodyProjections('chat-a')

      expect(getDatabase().characters[0].chats[0].message[0].data).toBe('newest retained edit')
      expect(await listPendingMutations()).toHaveLength(2)
    } finally {
      await clearDurableOutbox()
    }
  })

  it('rolls a retained chat projection back when replay finally rejects it', async () => {
    await prepareDurableOutbox('chat-patch-discard')
    let rejectReplay = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH') {
          return rejectReplay
            ? jsonResponse({ error: 'invalid retained rename' }, 400)
            : jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const previous = currentChatStateSnapshot()
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].name = 'Rejected rename'
      })
      const result = dispatchUpdateChatAsync('chat-a', { name: 'Rejected rename' }, previous)
      await expect(result).resolves.toMatchObject({ status: 'error' })
      expect(getDatabase().characters[0].chats[0].name).toBe('Rejected rename')

      rejectReplay = true
      await expect(replayPendingMutations()).resolves.toMatchObject({ discarded: 1, retained: 0 })

      expect(getDatabase().characters[0].chats[0].name).toBe('Chat A')
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearDurableOutbox()
    }
  })

  it('retains optimistic chat selection and folder metadata edits on retryable failures', async () => {
    await prepareDurableOutbox('selection')
    let liveBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chats/chat-b' && init.method === 'PATCH') {
          liveBody = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      dispatchSelectChat('chat-b', currentChatSelectionSnapshot())
      await vi.waitFor(() => expect(liveBody).toBeDefined())

      expect(getDatabase().characters[0].chatPage).toBe(1)
      const pending = await listPendingMutations()
      expect(pending).toMatchObject([
        {
          handle: { key: 'character-owner:char-a' },
          intent: {
            requests: [
              {
                method: 'PATCH',
                path: '/chats/chat-b',
                body: { patch: {}, select: true },
              },
            ],
          },
        },
      ])
      const { baseRevision: _baseRevision, ...sentBody } = liveBody ?? {}
      expect(sentBody).toEqual(pending[0].intent.requests[0].body)
    } finally {
      await clearDurableOutbox()
    }

    await prepareDurableOutbox('folder-patch')
    liveBody = undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chat-folders/folder-a' && init.method === 'PATCH') {
          liveBody = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const previous = currentChatStateSnapshot()
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chatFolders[0].name = 'Durable folder rename'
      })
      const mutation = dispatchUpdateChatFolderWithOutcome('folder-a', { name: 'Durable folder rename' }, previous)
      await vi.waitFor(() => expect(liveBody).toBeDefined())
      await expect(mutation).resolves.toMatchObject({ status: 'queued' })

      expect(getDatabase().characters[0].chatFolders[0].name).toBe('Durable folder rename')
      const pending = await listPendingMutations()
      expect(pending).toMatchObject([
        {
          handle: { key: 'character-owner:char-a' },
          intent: {
            requests: [
              {
                method: 'PATCH',
                path: '/chat-folders/folder-a',
                body: { patch: { name: 'Durable folder rename' } },
              },
            ],
          },
        },
      ])
      const { baseRevision: _baseRevision, ...sentBody } = liveBody ?? {}
      expect(sentBody).toEqual(pending[0].intent.requests[0].body)
    } finally {
      await clearDurableOutbox()
    }
  })

  it('retains direct scriptstate and author-note projections with explicit character ownership', async () => {
    await prepareDurableOutbox('scriptstate')
    let liveBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chats/chat-a/scriptstate' && init.method === 'PATCH') {
          liveBody = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const previous = currentChatScriptstateSnapshot()
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].scriptstate = { $score: 'durable' }
      })
      dispatchPatchChatScriptstateScoped('chat-a', { $score: 'durable' }, ['$old'], previous)
      await vi.waitFor(() => expect(liveBody).toBeDefined())

      expect(getDatabase().characters[0].chats[0].scriptstate).toEqual({ $score: 'durable' })
      const pending = await listPendingMutations()
      expect(pending).toMatchObject([
        {
          handle: { key: 'character-owner:char-a' },
          intent: {
            requests: [
              {
                method: 'PATCH',
                path: '/chats/chat-a/scriptstate',
                body: { patch: { $score: 'durable' }, deleteKeys: ['$old'] },
              },
            ],
          },
        },
      ])
      const { baseRevision: _baseRevision, ...sentBody } = liveBody ?? {}
      expect(sentBody).toEqual(pending[0].intent.requests[0].body)
    } finally {
      await clearDurableOutbox()
    }

    await prepareDurableOutbox('direct-note')
    liveBody = undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH') {
          liveBody = typeof init.body === 'string' ? JSON.parse(init.body) : {}
          return jsonResponse({ error: 'temporarily unavailable' }, 503)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const previous = currentChatScriptstateSnapshot(true)
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].note = 'Durable trigger note'
      })
      const result = dispatchUpdateChatNoteScoped('chat-a', 'Durable trigger note', previous)
      await expect(result).resolves.toMatchObject({ status: expect.any(String) })

      expect(getDatabase().characters[0].chats[0].note).toBe('Durable trigger note')
      const pending = await listPendingMutations()
      expect(pending).toMatchObject([
        {
          handle: { key: 'character-owner:char-a' },
          intent: {
            requests: [
              {
                method: 'PATCH',
                path: '/chats/chat-a',
                body: { patch: { note: 'Durable trigger note' }, select: false },
              },
            ],
          },
        },
      ])
      const { baseRevision: _baseRevision, ...sentBody } = liveBody ?? {}
      expect(sentBody).toEqual(pending[0].intent.requests[0].body)
    } finally {
      await clearDurableOutbox()
    }
  })

  it('does not nest a chat-row mutation that already carries durable transport', async () => {
    await prepareDurableOutbox('existing-transport')
    const intent = {
      version: 1 as const,
      requests: [
        {
          method: 'PATCH' as const,
          path: '/chats/chat-a',
          body: { patch: { suggestMessages: ['durable suggestion'] }, select: false },
        },
      ],
    }
    const outer = stagePendingMutation('character-owner:char-a', intent)
    const commandMutationIds: Array<string | null> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        if (url === '/api/v1/commands/chats/chat-a' && init.method === 'PATCH') {
          const headers = init.headers as Record<string, string> | undefined
          commandMutationIds.push(headers?.['risu-mutation-id'] ?? null)
          return jsonResponse({
            revision: 11,
            event: {
              type: 'chat.updated',
              revision: 11,
              resource: 'characterRow',
              id: 'chat-a',
              parentId: 'char-a',
            },
            chatId: 'chat-a',
            selectedChatId: 'chat-a',
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      withTrustedResourceWrite(() => {
        getDatabase().characters[0].chats[0].suggestMessages = ['durable suggestion']
      })
      const rollback = {
        selectedCharID: 0,
        characterId: 'char-a',
        chatId: 'chat-a',
        metadata: {},
      }
      await expect(
        dispatchDurableMutation(outer, intent, (transport) => {
          return (
            dispatchUpdateChatRow('chat-a', { suggestMessages: ['durable suggestion'] }, rollback, transport) ??
            Promise.resolve({ status: 'unavailable' as const })
          )
        }),
      ).resolves.toMatchObject({ status: 'ok' })

      expect(commandMutationIds).toEqual([outer.mutationId])
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearDurableOutbox()
    }
  })

  it('pre-stages combined folder and chat reorders and replays them in owner order', async () => {
    await prepareDurableOutbox('combined-reorder')
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders.push({ id: 'folder-b', name: 'Folder B', folded: false })
    })
    const previous = currentChatStateSnapshot()
    let recover = false
    let revision = 10
    const commandPaths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        const path = url.replace('/api/v1/commands', '')
        if (path === '/characters/char-a/chat-folders/reorder' || path === '/characters/char-a/chats/reorder') {
          commandPaths.push(path)
          if (!recover) return jsonResponse({ error: 'temporarily unavailable' }, 503)
          revision += 1
          return jsonResponse({
            revision,
            event: {
              type: path.includes('/chat-folders/') ? 'chatFolder.reordered' : 'chat.reordered',
              revision,
              resource: 'characterRow',
              parentId: 'char-a',
            },
            selectedChatId: 'chat-b',
          })
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const mutation = dispatchReorderChatFoldersAndChatsByIdsWithOutcome(
        'char-a',
        ['folder-b', 'folder-a'],
        ['chat-b', 'chat-a'],
        { 'chat-b': 'folder-b', 'chat-a': null },
        previous,
        'chat-b',
      )
      await vi.waitFor(() => expect(commandPaths).toEqual(['/characters/char-a/chat-folders/reorder']))
      const queuedOutcome = await mutation
      expect(queuedOutcome).toMatchObject({
        status: 'queued',
        mutationIds: [expect.any(String), expect.any(String)],
      })

      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-b', 'folder-a'])
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-b', 'chat-a'])
      const pending = await listPendingMutations()
      expect(pending.map((entry) => entry.handle.key)).toEqual(['character-owner:char-a', 'character-owner:char-a'])
      expect(pending.map((entry) => entry.intent.requests[0])).toEqual([
        {
          method: 'POST',
          path: '/characters/char-a/chat-folders/reorder',
          body: { folderIds: ['folder-b', 'folder-a'], selectedChatId: 'chat-b' },
        },
        {
          method: 'POST',
          path: '/characters/char-a/chats/reorder',
          body: {
            chatIds: ['chat-b', 'chat-a'],
            folderByChatId: { 'chat-b': 'folder-b' },
            selectedChatId: 'chat-b',
          },
        },
      ])

      recover = true
      const replayStart = commandPaths.length
      await expect(replayPendingMutations()).resolves.toMatchObject({ succeeded: 2, retained: 0 })
      expect(commandPaths.slice(replayStart)).toEqual([
        '/characters/char-a/chat-folders/reorder',
        '/characters/char-a/chats/reorder',
      ])
      if (queuedOutcome.status !== 'queued') throw new Error('Expected a queued reorder batch')
      await expect(queuedOutcome.settlement).resolves.toEqual({ status: 'accepted' })
      expect(await listPendingMutations()).toEqual([])
    } finally {
      await clearDurableOutbox()
    }
  })

  it('keeps an accepted folder reorder when the later chat reorder is terminally rejected', async () => {
    await prepareDurableOutbox('combined-terminal')
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chatFolders.push({ id: 'folder-b', name: 'Folder B', folded: false })
    })
    const previous = currentChatStateSnapshot()
    const commandPaths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        const path = url.replace('/api/v1/commands', '')
        if (path === '/characters/char-a/chat-folders/reorder') {
          commandPaths.push(path)
          return jsonResponse({
            revision: 11,
            event: {
              type: 'chatFolder.reordered',
              revision: 11,
              resource: 'characterRow',
              parentId: 'char-a',
            },
            selectedChatId: 'chat-b',
          })
        }
        if (path === '/characters/char-a/chats/reorder') {
          commandPaths.push(path)
          return jsonResponse({ error: 'invalid chat reorder' }, 400)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      const mutation = dispatchReorderChatFoldersAndChatsByIdsWithOutcome(
        'char-a',
        ['folder-b', 'folder-a'],
        ['chat-b', 'chat-a'],
        { 'chat-b': 'folder-b', 'chat-a': null },
        previous,
        'chat-b',
      )
      await vi.waitFor(() => {
        expect(commandPaths).toEqual(['/characters/char-a/chat-folders/reorder', '/characters/char-a/chats/reorder'])
      })
      await expect(mutation).resolves.toMatchObject({ status: 'failed' })
      await vi.waitFor(async () => expect(await listPendingMutations()).toEqual([]))

      expect(getDatabase().characters[0].chatFolders.map((folder) => folder.id)).toEqual(['folder-b', 'folder-a'])
      expect(getDatabase().characters[0].chats.map((chat) => chat.id)).toEqual(['chat-a', 'chat-b'])
      expect(getDatabase().characters[0].chats.map((chat) => chat.folderId ?? null)).toEqual([null, 'folder-a'])
    } finally {
      await clearDurableOutbox()
    }
  })

  it('retains every compatibility sub-write after the first retryable failure', async () => {
    await prepareDurableOutbox('compatibility')
    const previous = currentChatScopedSnapshot()
    const previousChat = jsonClone(previous.chat!)
    const nextChat = jsonClone(previousChat)
    nextChat.name = 'Compatible durable rename'
    nextChat.message = [{ role: 'user', data: 'compatible append', chatId: 'message-compatible' }]
    nextChat.scriptstate = { $score: 'compatible', $old: 'gone' }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0] = jsonClone(nextChat)
    })

    const commandPaths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const path = url.replace('/api/v1/commands', '')
        commandPaths.push(path)
        return jsonResponse({ error: 'temporarily unavailable' }, 503)
      }) as unknown as typeof fetch,
    )

    try {
      dispatchCompatibleChatUpdateScoped(previousChat, nextChat, previous)
      await vi.waitFor(() => expect(commandPaths).toEqual(['/chats/chat-a']))

      expect(getDatabase().characters[0].chats[0]).toMatchObject({
        name: 'Compatible durable rename',
        message: [{ role: 'user', data: 'compatible append', chatId: 'message-compatible' }],
        scriptstate: { $score: 'compatible', $old: 'gone' },
      })
      const pending = await listPendingMutations()
      expect(pending.map((entry) => entry.handle.key)).toEqual([
        'character-owner:char-a',
        'character-owner:char-a',
        'character-owner:char-a',
      ])
      expect(pending.map((entry) => entry.intent.requests[0])).toEqual([
        {
          method: 'PATCH',
          path: '/chats/chat-a',
          body: { patch: { name: 'Compatible durable rename' }, select: false },
        },
        {
          method: 'POST',
          path: '/chats/chat-a/messages',
          body: {
            message: { role: 'user', data: 'compatible append', chatId: 'message-compatible' },
          },
        },
        {
          method: 'PATCH',
          path: '/chats/chat-a/scriptstate',
          body: { patch: { $score: 'compatible' }, deleteKeys: [] },
        },
      ])
    } finally {
      await clearDurableOutbox()
    }
  })

  it('keeps an accepted compatibility prefix and rolls back only unaccepted sub-writes', async () => {
    await prepareDurableOutbox('compatibility-terminal')
    const previous = currentChatScopedSnapshot()
    const previousChat = jsonClone(previous.chat!)
    const nextChat = jsonClone(previousChat)
    nextChat.name = 'Accepted compatible rename'
    nextChat.message = [{ role: 'user', data: 'rejected append', chatId: 'message-rejected' }]
    nextChat.scriptstate = { $score: 'unaccepted scriptstate', $old: 'gone' }
    withTrustedResourceWrite(() => {
      getDatabase().characters[0].chats[0] = jsonClone(nextChat)
    })

    const commandPaths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/commands/mutation-receipts/ack') return jsonResponse({ acknowledged: true })
        const path = url.replace('/api/v1/commands', '')
        if (path === '/chats/chat-a') {
          commandPaths.push(path)
          return jsonResponse({
            revision: 11,
            event: {
              type: 'chat.updated',
              revision: 11,
              resource: 'characterRow',
              id: 'chat-a',
              parentId: 'char-a',
            },
            chatId: 'chat-a',
            selectedChatId: 'chat-a',
          })
        }
        if (path === '/chats/chat-a/messages') {
          commandPaths.push(path)
          return jsonResponse({ error: 'invalid message append' }, 400)
        }
        return jsonResponse({ error: `unexpected ${url}` }, 404)
      }) as unknown as typeof fetch,
    )

    try {
      dispatchCompatibleChatUpdateScoped(previousChat, nextChat, previous)
      await vi.waitFor(() => expect(commandPaths).toEqual(['/chats/chat-a', '/chats/chat-a/messages']))
      await vi.waitFor(async () => expect(await listPendingMutations()).toEqual([]))

      expect(getDatabase().characters[0].chats[0]).toMatchObject({
        name: 'Accepted compatible rename',
        message: [],
        scriptstate: { $score: '1', $old: 'gone' },
      })
    } finally {
      await clearDurableOutbox()
    }
  })
})
