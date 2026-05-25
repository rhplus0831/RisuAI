import { beforeEach, describe, expect, it, vi } from 'vitest'

const platformState = vi.hoisted(() => ({ isFastifyServer: true }))
const serverBootstrapState = vi.hoisted(() => ({
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
const forageSpies = vi.hoisted(() => ({
  Init: vi.fn(async () => undefined),
  getItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
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
  fetchServerBootstrapProjection: vi.fn(async () => serverBootstrapState.response),
}))

vi.mock('./globalApi.svelte', () => ({
  forageStorage: forageSpies,
  saveDb: vi.fn(async () => undefined),
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
vi.mock('./process/coldstorage.svelte', () => ({ makeColdData: vi.fn(async () => undefined) }))
vi.mock('./characters', () => ({ updateLorebooks: vi.fn((entries) => entries) }))
vi.mock('./model/modellist', async (importActual) => {
  const actual = await importActual<typeof import('./model/modellist')>()
  return {
    ...actual,
    getModelInfo: vi.fn(() => ({ type: 'chat' })),
    registerModelDynamic: vi.fn(),
  }
})

import { loadWebInitialDatabase } from './bootstrap'
import { DBState, LoadingStatusState } from './stores.svelte'

beforeEach(() => {
  platformState.isFastifyServer = true
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
  forageSpies.Init.mockClear()
  forageSpies.getItem.mockClear()
  forageSpies.setItem.mockClear()
  DBState.db = {} as any
  LoadingStatusState.text = ''
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
  })
})
