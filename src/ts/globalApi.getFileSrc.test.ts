import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform', async (importActual) => {
  const actual = await importActual<typeof import('./platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('./storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'proxy-auth-token',
}))

vi.mock('./process/modules', async (importActual) => {
  const actual = await importActual<typeof import('./process/modules')>()
  return { ...actual, moduleUpdate: vi.fn() }
})

import { testDatabaseState } from './__tests__/resourceDatabaseState'
import { getFileSrc } from './globalApi.svelte'

beforeEach(() => {
  // Seed the minimal Database shape so the module-load $effect chain in
  // `stores.svelte → modules.ts → getDatabase()` does not throw before the
  // tests run. The test does not exercise these fields.
  testDatabaseState.db = {
    usePlainFetch: false,
    requestLocation: '',
    modules: [],
    enabledModules: [],
    characters: [],
  }
})

describe('getFileSrc Fastify-mode shape gate', () => {
  it('returns absolute /api/v1/assets URLs unchanged', async () => {
    const url = '/api/v1/assets/' + 'a'.repeat(64)
    expect(await getFileSrc(url)).toBe(url)
  })

  it('returns data: URLs unchanged', async () => {
    const url = 'data:image/png;base64,iVBORw0KGgo='
    expect(await getFileSrc(url)).toBe(url)
  })

  it('returns blob: URLs unchanged', async () => {
    const url = 'blob:http://localhost/abc-123'
    expect(await getFileSrc(url)).toBe(url)
  })

  it('resolves a raw 64-char asset id to /api/v1/assets/<id>', async () => {
    const id = 'b'.repeat(64)
    expect(await getFileSrc(id)).toBe(`/api/v1/assets/${id}`)
  })

  it('resolves a legacy assets/<sha>.<ext> path to /api/v1/assets/<id>', async () => {
    const id = 'c'.repeat(64)
    expect(await getFileSrc(`assets/${id}.png`)).toBe(`/api/v1/assets/${id}`)
  })

  it('rejects arbitrary http URLs with empty string (no fingerprint fetch)', async () => {
    expect(await getFileSrc('http://attacker.invalid/poisoned.png')).toBe('')
  })

  it('rejects arbitrary https URLs with empty string', async () => {
    expect(await getFileSrc('https://attacker.invalid/poisoned.png')).toBe('')
  })

  it('rejects empty or garbage strings with empty string', async () => {
    expect(await getFileSrc('')).toBe('')
    expect(await getFileSrc('definitely-not-an-asset')).toBe('')
  })
})
