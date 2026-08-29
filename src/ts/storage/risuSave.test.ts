import { beforeEach, describe, expect, it, vi } from 'vitest'

const databaseState = vi.hoisted(() => ({
  getDatabase: vi.fn(() => ({ enableRemoteSaving: true })),
}))

vi.mock('src/ts/platform', () => ({ isFastifyServer: true }))

vi.mock('./database.svelte', () => ({
  getDatabase: databaseState.getDatabase,
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
  databaseState.getDatabase.mockClear()
})

describe('Fastify RisuSave remote-saving gate', () => {
  it.each(['prefer', 'force'] as const)(
    'encodes %s blocks inline without consulting remote-saving state or device-local storage',
    async (remote) => {
      const encoder = new RisuSaveEncoder()

      const block = await encoder.encodeBlock(
        {
          compression: false,
          data: '{"ok":true}',
          type: 1 as any,
          name: 'root',
        },
        { remote },
      )

      expect(block).toBeInstanceOf(Uint8Array)
      expect(block[0]).toBe(1)
      expect(databaseState.getDatabase).not.toHaveBeenCalled()
    },
  )
})
