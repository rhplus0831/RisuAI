import { beforeEach, describe, expect, it, vi } from 'vitest'

const fastifyStorageState = vi.hoisted(() => ({
  instances: [] as Array<{
    setItem: ReturnType<typeof vi.fn>
    getItem: ReturnType<typeof vi.fn>
    keys: ReturnType<typeof vi.fn>
    removeItem: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('./fastifyStorage', () => ({
  FastifyStorage: class {
    setItem = vi.fn(async () => undefined)
    getItem = vi.fn(async () => Buffer.from('server-data'))
    keys = vi.fn(async () => ['database/database.bin'])
    removeItem = vi.fn(async () => undefined)

    constructor() {
      fastifyStorageState.instances.push(this)
    }
  },
}))

import { AutoStorage } from './autoStorage'

describe('AutoStorage Fastify app persistence', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    fastifyStorageState.instances = []
  })

  it('always selects Fastify-backed FastifyStorage for app data', async () => {
    const getDirectory = vi.fn(async () => {
      throw new Error('OPFS should not be opened')
    })
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory,
      },
    })
    vi.stubGlobal('FileSystemFileHandle', {
      prototype: {
        createWritable: vi.fn(),
      },
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'able'),
    })

    const storage = new AutoStorage()

    await expect(storage.getItem('database/database.bin')).resolves.toEqual(Buffer.from('server-data'))

    expect(fastifyStorageState.instances).toHaveLength(1)
    expect(fastifyStorageState.instances[0].getItem).toHaveBeenCalledWith('database/database.bin')
    expect(getDirectory).not.toHaveBeenCalled()
    expect(localStorage.getItem).not.toHaveBeenCalled()
  })

  it('delegates writes, lists, and removals to one FastifyStorage instance', async () => {
    const storage = new AutoStorage()

    await storage.setItem('database/database.bin', new Uint8Array([1, 2, 3]))
    await expect(storage.keys()).resolves.toEqual(['database/database.bin'])
    await storage.removeItem(['assets/a.png', 'assets/b.png'])

    expect(fastifyStorageState.instances).toHaveLength(1)
    const instance = fastifyStorageState.instances[0]
    expect(instance.setItem).toHaveBeenCalledWith('database/database.bin', new Uint8Array([1, 2, 3]))
    expect(instance.keys).toHaveBeenCalledTimes(1)
    expect(instance.removeItem).toHaveBeenCalledWith(['assets/a.png', 'assets/b.png'])
  })
})
