import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => ({
  db: {
    characters: [] as any[],
    characterOrder: [] as any[],
    goCharacterOnImport: false,
  },
}))

const alertState = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertProgress: vi.fn(),
  alertStoreSet: vi.fn(),
  alertTOS: vi.fn(),
  alertWait: vi.fn(),
}))

const characterState = vi.hoisted(() => ({
  changeChar: vi.fn(),
}))

const globalApiState = vi.hoisted(() => ({
  checkCharOrder: vi.fn(),
}))

const realmImportState = vi.hoisted(() => ({
  importRealmCharacterFromServer: vi.fn(),
}))

const resourceRefreshState = vi.hoisted(() => ({
  forceServerResourceRefresh: vi.fn(),
}))

const commandsState = vi.hoisted(() => ({
  setCachedServerCommandRevision: vi.fn(),
}))

const chatHydrationState = vi.hoisted(() => ({
  resetChatHydration: vi.fn(),
}))

const lorebookHydrationState = vi.hoisted(() => ({
  recordHydratedCharacterLorebooks: vi.fn(),
  resetLorebookHydration: vi.fn(),
}))

vi.mock('./alert', () => ({
  alertCardExport: vi.fn(),
  alertConfirm: alertState.alertConfirm,
  alertError: alertState.alertError,
  alertInput: vi.fn(async () => ''),
  alertNormal: alertState.alertNormal,
  alertProgress: alertState.alertProgress,
  alertStore: {
    set: alertState.alertStoreSet,
  },
  alertTOS: alertState.alertTOS,
  alertWait: alertState.alertWait,
}))

vi.mock('./storage/database.svelte', () => ({
  appVer: 'test',
  defaultSdDataFunc: vi.fn(() => []),
  getDatabase: vi.fn(() => dbState.db),
  importPreset: vi.fn(),
  setDatabase: vi.fn(),
  setDatabaseLite: vi.fn(),
}))

vi.mock('./util', () => ({
  checkNullish: (data: unknown) => data === undefined || data === null,
  decryptBuffer: vi.fn(),
  isKnownUri: vi.fn(() => false),
  selectFileByDom: vi.fn(),
  sleep: vi.fn(),
}))

vi.mock('src/lang', () => ({
  language: {
    errors: {
      noData: 'No data',
      wrongPassword: 'Wrong password',
    },
    importedCharacter: 'Imported character',
    inputCardPassword: 'Card password',
    lowLevelAccessConfirm: 'Low-level access?',
    successExport: 'Exported',
    successImport: 'Imported',
  },
}))

vi.mock('./characters', () => ({
  changeChar: characterState.changeChar,
  characterFormatUpdate: vi.fn(),
}))

vi.mock('./globalApi.svelte', () => {
  class TestAppendableBuffer {
    append() {}
    deappend() {}
    slice() {
      return new Uint8Array()
    }
    length() {
      return 0
    }
    clear() {}
  }

  class TestWriter {
    async init() {}
    async write() {}
    close() {}
  }

  return {
    AppendableBuffer: TestAppendableBuffer,
    BlankWriter: TestWriter,
    checkCharOrder: globalApiState.checkCharOrder,
    downloadFile: vi.fn(),
    loadAsset: vi.fn(),
    LocalWriter: TestWriter,
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    saveAssets: vi.fn(),
    VirtualWriter: TestWriter,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: vi.fn(async () => 'test-token'),
}))

vi.mock('./media', () => ({
  compressImage: vi.fn(async (data: Uint8Array) => data),
  getImageType: vi.fn(() => 'PNG'),
}))

vi.mock('./stores.svelte', () => {
  const store = () => ({
    set: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  })
  return {
    DBState: {
      get db() {
        return dbState.db
      },
      set db(value) {
        dbState.db = value
      },
    },
    selectedCharID: store(),
    SettingsMenuIndex: store(),
    settingsOpen: store(),
  }
})

vi.mock('./parser/parser.svelte', () => ({
  hasher: vi.fn(async () => 'hash'),
}))

vi.mock('./process/files/inlays', () => ({
  reencodeImage: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock('./process/processzip', () => ({
  CharXImporter: class {},
  CharXWriter: class {},
}))

vi.mock('./process/modules', () => ({
  exportModule: vi.fn(),
  readModule: vi.fn(),
}))

vi.mock('./characterCommands', () => ({
  currentCharacterStateSnapshot: vi.fn(() => ({
    characters: [],
    characterOrder: [],
    selectedCharID: -1,
  })),
  dispatchCreateCharacter: vi.fn(),
}))

vi.mock('./moduleCommands', () => ({
  createGlobalModule: vi.fn(),
}))

vi.mock('./server/realmImport', () => ({
  importRealmCharacterFromServer: realmImportState.importRealmCharacterFromServer,
}))

vi.mock('./server/resourceRefresh', () => ({
  forceServerResourceRefresh: resourceRefreshState.forceServerResourceRefresh,
}))

vi.mock('./server/commands', () => ({
  setCachedServerCommandRevision: commandsState.setCachedServerCommandRevision,
}))

vi.mock('./server/chatMessageHydration.svelte', () => ({
  resetChatHydration: chatHydrationState.resetChatHydration,
}))

vi.mock('./server/lorebookBridge.svelte', () => ({
  recordHydratedCharacterLorebooks: lorebookHydrationState.recordHydratedCharacterLorebooks,
  resetLorebookHydration: lorebookHydrationState.resetLorebookHydration,
}))

import { downloadRisuHub } from './characterCards'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function okRealmImport(characterId: string, revision = 10) {
  return {
    status: 'ok',
    revision,
    event: {
      type: 'character.created',
      resource: 'character',
      revision,
    },
    characterId,
  }
}

function fallbackRealmCard(name: string) {
  return {
    spec: 'chara_card_v3',
    data: {
      name,
      description: 'desc',
      first_mes: 'hello',
      mes_example: '',
      personality: '',
      scenario: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '1',
      extensions: {
        risuai: {},
      },
      assets: [],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbState.db = {
    characters: [],
    characterOrder: [],
    goCharacterOnImport: false,
  }
  alertState.alertConfirm.mockResolvedValue(true)
  alertState.alertTOS.mockResolvedValue(true)
  globalApiState.checkCharOrder.mockImplementation(() => undefined)
  realmImportState.importRealmCharacterFromServer.mockResolvedValue(okRealmImport('char-imported'))
  resourceRefreshState.forceServerResourceRefresh.mockResolvedValue({ status: 'ok', revision: 20 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Realm character import finish refresh', () => {
  it('passes the pending charx token when retrying after low-level confirmation', async () => {
    realmImportState.importRealmCharacterFromServer
      .mockResolvedValueOnce({ status: 'low-level-access', pendingImportToken: 'pending-token' })
      .mockResolvedValueOnce(okRealmImport('char-imported', 21))

    await downloadRisuHub('realm-id', { forceRedirect: true })

    expect(alertState.alertConfirm).toHaveBeenCalledWith('Low-level access?')
    expect(realmImportState.importRealmCharacterFromServer).toHaveBeenCalledTimes(2)
    expect(realmImportState.importRealmCharacterFromServer.mock.calls[1]).toEqual([
      'realm-id',
      {
        allowLowLevelAccess: true,
        pendingImportToken: 'pending-token',
        onProgress: expect.any(Function),
      },
    ])
  })

  it('uses the fenced full resource refresh and navigates by imported character id', async () => {
    realmImportState.importRealmCharacterFromServer.mockImplementation(async (_id, options) => {
      options.onProgress?.({
        phase: 'download',
        message: 'Downloading Realm character',
        percent: 25,
      })
      return okRealmImport('char-imported', 21)
    })
    resourceRefreshState.forceServerResourceRefresh.mockImplementation(async () => {
      dbState.db = {
        characters: [{ chaId: 'other-char' }, { chaId: 'char-imported' }],
        characterOrder: [],
        goCharacterOnImport: false,
      }
      return { status: 'ok', revision: 21 }
    })

    await downloadRisuHub('realm-id', { forceRedirect: true })

    expect(resourceRefreshState.forceServerResourceRefresh).toHaveBeenCalledTimes(1)
    expect(resourceRefreshState.forceServerResourceRefresh).toHaveBeenCalledWith('realm-import')
    expect(characterState.changeChar).toHaveBeenCalledTimes(1)
    expect(characterState.changeChar.mock.calls[0][0]).toBe(1)
    expect(characterState.changeChar.mock.calls[0][1]).toEqual({ isFresh: expect.any(Function) })
    expect(characterState.changeChar.mock.calls[0][1].isFresh()).toBe(true)
    expect(alertState.alertStoreSet).toHaveBeenCalledWith({ type: 'none', msg: '' })
    expect(alertState.alertProgress).toHaveBeenCalledWith('Downloading Realm character', 25)
    expect(alertState.alertProgress).toHaveBeenCalledWith('Realm import complete', 100)
    expect(commandsState.setCachedServerCommandRevision).not.toHaveBeenCalled()
    expect(chatHydrationState.resetChatHydration).not.toHaveBeenCalled()
    expect(lorebookHydrationState.resetLorebookHydration).not.toHaveBeenCalled()
    expect(lorebookHydrationState.recordHydratedCharacterLorebooks).not.toHaveBeenCalled()
  })

  it('uses the returned character id for unsupported Realm fallback navigation after local reorder', async () => {
    realmImportState.importRealmCharacterFromServer.mockResolvedValue({ status: 'unsupported' })
    dbState.db = {
      characters: [{ chaId: 'existing-char', name: 'Existing' }],
      characterOrder: [],
      goCharacterOnImport: true,
    }
    globalApiState.checkCharOrder.mockImplementation(() => {
      const imported = dbState.db.characters.find((character) => character.name === 'Fallback Imported')
      dbState.db.characters = [imported, { chaId: 'tail-char', name: 'Tail Character' }].filter(Boolean)
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('https://realm.risuai.net/api/v1/download/dynamic/')) {
          return new Response(
            JSON.stringify({
              card: fallbackRealmCard('Fallback Imported'),
              img: 'fallback-img',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        if (url === '/api/v1/hub/resource/fallback-img') {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
        }
        return new Response(`unexpected ${url}`, { status: 404 })
      }) as unknown as typeof fetch,
    )

    await downloadRisuHub('realm-id', { forceRedirect: true })

    expect(globalApiState.checkCharOrder).toHaveBeenCalledTimes(1)
    expect(dbState.db.characters.map((character) => character.chaId)).toEqual([expect.any(String), 'tail-char'])
    expect(dbState.db.characters[0].name).toBe('Fallback Imported')
    expect(characterState.changeChar).toHaveBeenCalledTimes(1)
    expect(characterState.changeChar.mock.calls[0][0]).toBe(0)
    expect(characterState.changeChar.mock.calls[0][1]).toEqual({ isFresh: expect.any(Function) })
    expect(alertState.alertStoreSet).toHaveBeenCalledWith({ type: 'none', msg: '' })
  })

  it('keeps stale Realm completions from overwriting newer progress, errors, or navigation', async () => {
    const imports: Array<{
      options: { onProgress?: (progress: any) => void }
      result: Deferred<any>
    }> = []
    realmImportState.importRealmCharacterFromServer.mockImplementation((_id, options) => {
      const result = deferred<any>()
      imports.push({ options, result })
      return result.promise
    })
    let resyncCount = 0
    resourceRefreshState.forceServerResourceRefresh.mockImplementation(async () => {
      resyncCount += 1
      if (resyncCount === 1) {
        dbState.db = {
          characters: [{ chaId: 'new-char' }],
          characterOrder: [],
          goCharacterOnImport: true,
        }
        return { status: 'ok', revision: 31 }
      }
      dbState.db = {
        characters: [{ chaId: 'old-char' }],
        characterOrder: [],
        goCharacterOnImport: true,
      }
      throw new Error('stale refresh failed')
    })

    const older = downloadRisuHub('older-realm', { forceRedirect: true })
    const newer = downloadRisuHub('newer-realm', { forceRedirect: true })

    expect(imports).toHaveLength(2)
    imports[0].options.onProgress?.({
      phase: 'download',
      message: 'old import progress',
      percent: 10,
    })
    imports[1].options.onProgress?.({
      phase: 'download',
      message: 'new import progress',
      percent: 20,
    })

    imports[1].result.resolve(okRealmImport('new-char', 31))
    await newer
    imports[0].result.resolve(okRealmImport('old-char', 30))
    await older

    expect(resourceRefreshState.forceServerResourceRefresh).toHaveBeenCalledTimes(1)
    expect(dbState.db.characters.map((character) => character.chaId)).toEqual(['new-char'])
    expect(characterState.changeChar).toHaveBeenCalledTimes(1)
    expect(characterState.changeChar.mock.calls[0][0]).toBe(0)
    expect(characterState.changeChar.mock.calls[0][1]).toEqual({ isFresh: expect.any(Function) })
    expect(alertState.alertError).not.toHaveBeenCalled()
    expect(alertState.alertNormal).not.toHaveBeenCalled()
    expect(alertState.alertStoreSet).toHaveBeenCalledTimes(1)
    expect(alertState.alertStoreSet).toHaveBeenCalledWith({ type: 'none', msg: '' })

    const progressMessages = alertState.alertProgress.mock.calls.map(([message]) => message)
    expect(progressMessages).toContain('new import progress')
    expect(progressMessages).not.toContain('old import progress')
    expect(progressMessages.filter((message) => message === 'Refreshing imported character')).toHaveLength(1)
    expect(progressMessages.filter((message) => message === 'Realm import complete')).toHaveLength(1)
  })

  it('reports latest-operation resync failures and skips navigation', async () => {
    realmImportState.importRealmCharacterFromServer.mockResolvedValue(okRealmImport('char-failed', 40))
    resourceRefreshState.forceServerResourceRefresh.mockResolvedValue({
      status: 'error',
      error: 'refresh failed',
    })
    dbState.db = {
      characters: [{ chaId: 'char-failed' }],
      characterOrder: [],
      goCharacterOnImport: true,
    }

    await downloadRisuHub('realm-id', { forceRedirect: true })

    expect(resourceRefreshState.forceServerResourceRefresh).toHaveBeenCalledWith('realm-import')
    expect(alertState.alertError).toHaveBeenCalledTimes(1)
    expect(alertState.alertError).toHaveBeenCalledWith('refresh failed')
    expect(characterState.changeChar).not.toHaveBeenCalled()
    expect(alertState.alertStoreSet).not.toHaveBeenCalledWith({ type: 'none', msg: '' })

    const progressMessages = alertState.alertProgress.mock.calls.map(([message]) => message)
    expect(progressMessages).toContain('Refreshing imported character')
    expect(progressMessages).not.toContain('Realm import complete')
  })
})
