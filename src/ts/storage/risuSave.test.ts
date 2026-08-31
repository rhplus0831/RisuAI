import { describe, expect, it, vi } from 'vitest'

vi.mock('./database.svelte', () => ({
  presetTemplate: {},
}))

import { RisuSaveEncoder } from './risuSave'

describe('Fastify RisuSave block encoding', () => {
  it('encodes blocks inline without legacy remote storage', async () => {
    const encoder = new RisuSaveEncoder()

    const block = await encoder.encodeBlock({
      compression: false,
      data: '{"ok":true}',
      type: 1 as any,
      name: 'root',
    })

    expect(block).toBeInstanceOf(Uint8Array)
    expect(block[0]).toBe(1)
  })
})
