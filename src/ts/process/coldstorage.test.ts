import { beforeEach, describe, expect, it, vi } from 'vitest'

const alertState = vi.hoisted(() => ({
  alertError: vi.fn(),
}))
const storeState = vi.hoisted(() => ({
  DBState: {
    db: {
      characters: [],
    },
  },
}))

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../alert', () => ({
  alertClear: vi.fn(),
  alertError: alertState.alertError,
  alertWait: vi.fn(),
}))

vi.mock('../globalApi.svelte', () => ({
  forageStorage: {
    realStorage: {
      getItem: vi.fn(async () => {
        throw new Error('node cold storage should not be read')
      }),
      keys: vi.fn(async () => {
        throw new Error('node cold storage should not be listed')
      }),
      removeItem: vi.fn(async () => {
        throw new Error('node cold storage should not be removed')
      }),
      setItem: vi.fn(async () => {
        throw new Error('node cold storage should not be written')
      }),
    },
  },
}))

vi.mock('../stores.svelte', () => storeState)

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => storeState.DBState.db,
}))

import {
  cleanColdStorage,
  coldStorageHeader,
  getColdStorageItem,
  listColdStorageItems,
  preLoadChat,
  setColdStorageItem,
} from './coldstorage.svelte'

beforeEach(() => {
  alertState.alertError.mockClear()
  storeState.DBState.db = {
    characters: [],
  } as any
  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: vi.fn(async () => {
        throw new Error('OPFS should not be opened')
      }),
    },
  })
})

describe('Fastify cold-storage gates', () => {
  it('returns before local cold-storage helper access in server-backed web mode', async () => {
    await expect(getColdStorageItem('cold-a')).resolves.toBeNull()
    await expect(setColdStorageItem('cold-a', { value: true })).resolves.toBe(false)
    await expect(listColdStorageItems()).resolves.toEqual({ items: [] })
    await expect(cleanColdStorage()).resolves.toBeUndefined()

    expect(navigator.storage.getDirectory).not.toHaveBeenCalled()
  })

  it('does not hydrate cold-storage chat pointers in server-backed web mode', async () => {
    storeState.DBState.db = {
      characters: [
        {
          chats: [
            {
              message: [
                {
                  role: 'char',
                  data: `${coldStorageHeader}cold-a`,
                  time: 1,
                },
              ],
            },
          ],
        },
      ],
    } as any

    await preLoadChat(0, 0)

    expect(alertState.alertError).toHaveBeenCalledWith(
      'Cold-storage chat hydration is not supported in server-backed web mode',
    )
    expect(navigator.storage.getDirectory).not.toHaveBeenCalled()
  })
})
