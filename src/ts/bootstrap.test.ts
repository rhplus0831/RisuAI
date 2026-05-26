import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const serverBootstrapState = vi.hoisted(() => ({
  fetch: vi.fn(),
  response: {
    status: 'ok' as const,
    projection: {
      revision: 5,
      database: {
        characters: [],
        modules: [],
        personas: [],
        language: 'en',
      },
    },
  },
}))
const serverEventsState = vi.hoisted(() => ({
  subscriptions: [] as Array<{
    onCommandEvent: (event: {
      type: string
      revision: number
      resource: string
      id?: string
      parentId?: string
    }) => void
    onError?: (error: string) => void
  }>,
  unsubscribe: vi.fn(),
  subscribe: vi.fn(
    async (input: {
      onCommandEvent: (event: {
        type: string
        revision: number
        resource: string
        id?: string
        parentId?: string
      }) => void
      onError?: (error: string) => void
    }) => {
      serverEventsState.subscriptions.push(input)
      return { status: 'ok' as const, unsubscribe: serverEventsState.unsubscribe }
    },
  ),
}))
const forageSpies = vi.hoisted(() => ({
  Init: vi.fn(async () => undefined),
  getItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
}))
const persistenceSpies = vi.hoisted(() => ({
  saveDb: vi.fn(async () => undefined),
  makeColdData: vi.fn(async () => undefined),
}))

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isTauri: false,
    isNodeServer: false,
    get isFastifyServer() {
      return platformState.isFastifyServer
    },
  }
})

vi.mock('./server/bootstrap', () => ({
  fetchServerBootstrapProjection: serverBootstrapState.fetch,
}))

vi.mock('./server/events', () => ({
  subscribeServerCommandEvents: serverEventsState.subscribe,
}))

vi.mock('./globalApi.svelte', () => ({
  forageStorage: forageSpies,
  saveDb: persistenceSpies.saveDb,
  getDbBackups: vi.fn(async () => []),
  getUncleanables: vi.fn(() => []),
  getBasename: vi.fn((value: string) => value.split('/').pop() ?? value),
  setUsingSw: vi.fn(),
  checkCharOrder: vi.fn(),
  downloadFile: vi.fn(),
  saveAsset: vi.fn(),
}))

vi.mock('./storage/risuSave', () => ({
  decodeRisuSave: vi.fn(async () => ({ characters: [], language: 'en' })),
  encodeRisuSaveLegacy: vi.fn(() => new Uint8Array([1, 2, 3])),
}))

vi.mock('./update', () => ({ checkRisuUpdate: vi.fn(async () => undefined) }))
vi.mock('./plugins/plugins.svelte', () => ({ loadPlugins: vi.fn(async () => undefined) }))
vi.mock('./alert', () => ({
  alertError: vi.fn(),
  alertMd: vi.fn(),
  alertTOS: vi.fn(async () => true),
  waitAlert: vi.fn(async () => undefined),
  alertConfirm: vi.fn(async () => false),
  alertInput: vi.fn(async () => ''),
  alertNormal: vi.fn(),
}))
vi.mock('./characterCards', () => ({ characterURLImport: vi.fn() }))
vi.mock('./gui/animation', () => ({ updateAnimationSpeed: vi.fn() }))
vi.mock('./gui/colorscheme', () => ({
  updateColorScheme: vi.fn(),
  updateTextThemeAndCSS: vi.fn(),
  defaultColorScheme: {},
}))
vi.mock('./gui/guisize', () => ({ updateGuisize: vi.fn() }))
vi.mock('./observer.svelte', () => ({ startObserveDom: vi.fn() }))
vi.mock('./hotkey', () => ({ initMobileGesture: vi.fn() }))
vi.mock('./process/modules', () => ({
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))
vi.mock('./process/coldstorage.svelte', () => ({ makeColdData: persistenceSpies.makeColdData }))
vi.mock('./characters', () => ({ updateLorebooks: vi.fn((entries) => entries) }))
vi.mock('./model/modellist', async (importActual) => {
  const actual = await importActual<typeof import('./model/modellist')>()
  return {
    ...actual,
    getModelInfo: vi.fn(() => ({ type: 'chat' })),
    registerModelDynamic: vi.fn(),
  }
})

import { loadData, loadWebInitialDatabase } from './bootstrap'
import {
  isServerProjectionWriteGuardEnabled,
  setServerProjectionWriteGuardEnabled,
  withTrustedServerProjectionWrite,
} from './storage/database.svelte'
import { DBState, LoadingStatusState, loadedStore } from './stores.svelte'

beforeEach(() => {
  platformState.isFastifyServer = true
  serverBootstrapState.fetch.mockImplementation(async () => serverBootstrapState.response)
  serverBootstrapState.response = {
    status: 'ok',
    projection: {
      revision: 5,
      database: {
        characters: [],
        modules: [],
        personas: [],
        language: 'en',
      },
    },
  }
  serverBootstrapState.fetch.mockClear()
  serverEventsState.subscriptions = []
  serverEventsState.unsubscribe.mockClear()
  serverEventsState.subscribe.mockClear()
  forageSpies.Init.mockClear()
  forageSpies.getItem.mockClear()
  forageSpies.setItem.mockClear()
  persistenceSpies.saveDb.mockClear()
  persistenceSpies.makeColdData.mockClear()
  setServerProjectionWriteGuardEnabled(false)
  DBState.db = {} as any
  LoadingStatusState.text = ''
  loadedStore.set(false)
})

describe('web bootstrap startup source', () => {
  it('loads the Fastify bootstrap projection without entering localForage', async () => {
    await loadWebInitialDatabase()

    expect(DBState.db.language).toBe('en')
    expect(DBState.db.characters).toEqual([])
    expect(LoadingStatusState.text).toBe('Loading Server Projection...')
    expect(forageSpies.Init).not.toHaveBeenCalled()
    expect(forageSpies.getItem).not.toHaveBeenCalled()
    expect(forageSpies.setItem).not.toHaveBeenCalled()
    expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)
  })

  it('debounces command events into one bootstrap projection refresh', async () => {
    vi.useFakeTimers()
    try {
      await loadWebInitialDatabase()
      expect(DBState.db.language).toBe('en')

      serverBootstrapState.response = {
        status: 'ok',
        projection: {
          revision: 6,
          database: {
            characters: [{ chaId: 'char-a', name: 'Ada', chats: [] }],
            modules: [],
            personas: [],
            language: 'ko',
          },
        },
      }

      const subscription = serverEventsState.subscriptions[0]
      subscription.onCommandEvent({ type: 'settings.updated', revision: 6, resource: 'settings' })
      subscription.onCommandEvent({ type: 'chat.updated', revision: 7, resource: 'chat' })

      await vi.advanceTimersByTimeAsync(99)
      expect(serverBootstrapState.fetch).toHaveBeenCalledTimes(1)
      expect(DBState.db.language).toBe('en')

      await vi.advanceTimersByTimeAsync(1)
      expect(serverBootstrapState.fetch).toHaveBeenCalledTimes(2)
      expect(DBState.db.language).toBe('ko')
      expect(DBState.db.characters).toEqual([{ chaId: 'char-a', name: 'Ada', chats: [] }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks direct Fastify projection writes after the guard is enabled', async () => {
    vi.useFakeTimers()
    try {
      await loadWebInitialDatabase()
      setServerProjectionWriteGuardEnabled(true)

      expect(isServerProjectionWriteGuardEnabled()).toBe(true)
      expect(() => {
        DBState.db.language = 'ja'
      }).toThrow()

      serverBootstrapState.response = {
        status: 'ok',
        projection: {
          revision: 6,
          database: {
            characters: [{ chaId: 'char-a', name: 'Ada', chats: [] }],
            modules: [],
            personas: [],
            language: 'ko',
          },
        },
      }

      const subscription = serverEventsState.subscriptions[0]
      subscription.onCommandEvent({ type: 'settings.updated', revision: 6, resource: 'settings' })

      await vi.advanceTimersByTimeAsync(100)
      expect(DBState.db.language).toBe('ko')
      expect(DBState.db.characters).toEqual([{ chaId: 'char-a', name: 'Ada', chats: [] }])
      expect(() => {
        DBState.db.characters.push({ chaId: 'char-b', name: 'Babbage', chats: [] } as any)
      }).toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows command-owned trusted projection writes and re-freezes afterward', async () => {
    await loadWebInitialDatabase()
    setServerProjectionWriteGuardEnabled(true)

    withTrustedServerProjectionWrite(() => {
      DBState.db.language = 'ja'
      DBState.db.characters.push({ chaId: 'char-command', name: 'Command', chats: [] } as any)
    })

    expect(DBState.db.language).toBe('ja')
    expect(DBState.db.characters).toEqual([
      { chaId: 'char-command', name: 'Command', chats: [] },
    ])
    expect(() => {
      DBState.db.language = 'ko'
    }).toThrow()
    expect(() => {
      DBState.db.characters.push({ chaId: 'char-direct', name: 'Direct', chats: [] } as any)
    }).toThrow()
  })

  it('leaves local web database writes unguarded', async () => {
    platformState.isFastifyServer = false

    await loadWebInitialDatabase()
    setServerProjectionWriteGuardEnabled(true)

    expect(isServerProjectionWriteGuardEnabled()).toBe(false)
    DBState.db.language = 'ja'
    expect(DBState.db.language).toBe('ja')
  })

  it('does not subscribe to server events outside Fastify mode', async () => {
    platformState.isFastifyServer = false

    await loadWebInitialDatabase()

    expect(serverEventsState.subscribe).not.toHaveBeenCalled()
    expect(forageSpies.Init).toHaveBeenCalledTimes(1)
  })

  it('skips local persistence maintenance during Fastify-served startup', async () => {
    serverBootstrapState.response = {
      status: 'ok',
      projection: {
        revision: 5,
        database: {
          characters: [],
          modules: [],
          personas: [],
          language: 'en',
          formatversion: 5,
          characterOrder: [],
          mainPrompt: '',
          loreBookToken: 8000,
        } as any,
      },
    }

    await loadData()

    expect(forageSpies.Init).not.toHaveBeenCalled()
    expect(forageSpies.getItem).not.toHaveBeenCalled()
    expect(forageSpies.setItem).not.toHaveBeenCalled()
    expect(persistenceSpies.makeColdData).not.toHaveBeenCalled()
    expect(persistenceSpies.saveDb).not.toHaveBeenCalled()
    expect(serverEventsState.subscribe).toHaveBeenCalledTimes(1)
  })
})
