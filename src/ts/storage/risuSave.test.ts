import { beforeEach, describe, expect, it, vi } from 'vitest'

const localForageState = vi.hoisted(() => ({
  setItem: vi.fn(async () => undefined),
  getItem: vi.fn(async () => undefined),
}))

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => localForageState),
  },
}))

vi.mock('./database.svelte', () => ({
  getDatabase: vi.fn(() => ({ enableRemoteSaving: false })),
  presetTemplate: {},
}))

vi.mock('../globalApi.svelte', () => ({
  forageStorage: {
    getItem: vi.fn(async () => {
      throw new Error('forageStorage should not be read')
    }),
    keys: vi.fn(async () => {
      throw new Error('forageStorage should not be listed')
    }),
    setItem: vi.fn(async () => {
      throw new Error('forageStorage should not be written')
    }),
  },
}))

import { RisuSaveEncoder } from './risuSave'

beforeEach(() => {
  localForageState.setItem.mockClear()
  localForageState.getItem.mockClear()
})

describe('Fastify RisuSave cache gate', () => {
  it('does not write RISUSAVE block cache entries in server-backed web mode', async () => {
    const encoder = new RisuSaveEncoder()

    const block = await encoder.encodeBlock({
      compression: false,
      data: '{"ok":true}',
      type: 1 as any,
      name: 'root',
    })

    expect(block).toBeInstanceOf(Uint8Array)
    expect(localForageState.setItem).not.toHaveBeenCalled()
  })
})
